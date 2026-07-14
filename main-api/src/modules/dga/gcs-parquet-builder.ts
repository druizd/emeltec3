/**
 * Builder Parquet para el export DGA → GCS (solicitado por CCU_Central).
 *
 * Cada envío DGA respondido por SNIA se descompone en 3 filas (una por
 * variable: CAUDAL, TOTALIZADOR, NIVEL_FREATICO) en formato long, según el
 * esquema acordado con CCU_Central. STATUS_DGA conserva el código respondido
 * por la API (incluye rechazos), porque el requisito es exportar TODO lo que
 * tuvo respuesta de DGA, no solo lo aceptado.
 *
 * Sin dependencias nativas: parquetjs usa compresión UNCOMPRESSED por defecto
 * (no requiere snappy/lzo), por lo que corre en el Docker Linux sin node-gyp.
 */
import { Writable } from 'node:stream';
import { ParquetSchema, ParquetWriter } from '@dsnp/parquetjs';

/** Fila enriquecida que el repo entrega al builder (un envío respondido). */
export interface ExportableSend {
  /** dga_send_audit.id — ancla de dedup en dga_gcs_export_log. */
  audit_id: number;
  site_id: string;
  /** ts de la medición (ISO 8601). */
  ts: string;
  /** dga_send_audit.sent_at — cuándo respondió DGA (ISO 8601). */
  sent_at: string;
  /** Código respondido por DGA: '00' = aceptado, otro = rechazado. */
  dga_status_code: string | null;
  /** api_n_comprobante; null en rechazos. */
  comprobante: string | null;
  dga_message: string | null;
  /** sub_empresa.nombre (se sanitiza al construir la fila). */
  planta: string;
  /** pozo_config.obra_dga (código DGA oficial). */
  centro_de_obra: string | null;
  /** Nombre del punto de medición (sitio.descripcion o site_id de respaldo). */
  nombre_sensor: string;
  caudal_instantaneo: string | null;
  flujo_acumulado: string | null;
  nivel_freatico: string | null;
}

export interface BuildRowsOptions {
  /** Valor de NOMBRE_PROVEEDOR (constante de negocio, ej. 'EMELTEC'). */
  proveedor: string;
  /** Timestamp del ciclo de carga (ISO 8601) — igual para todas las filas. */
  fechaHoraCarga: string;
}

export type DgaVariable = 'CAUDAL' | 'TOTALIZADOR' | 'NIVEL_FREATICO';

export interface ParquetRow {
  NOMBRE_PROVEEDOR: string;
  PLANTA: string;
  NOMBRE_SENSOR: string;
  CENTRO_DE_OBRA: string | null;
  FECHA_MEDICION_SENSOR: string;
  VARIABLE: DgaVariable;
  VALOR: string | null;
  FECHA_REPORTE_DGA: string;
  STATUS_DGA: string | null;
  COMPROBANTE: string | null;
  MENSAJE_DGA: string | null;
  FECHA_HORA_CARGA: string;
}

/**
 * Normaliza un texto (planta, nombre_sensor) para uso en columna y en path
 * GCS: quita tildes, ñ→n, colapsa espacios y recorta. CONSERVA mayúsculas y
 * espacios a propósito — la spec de CCU exige que el valor de la columna sea
 * byte-idéntico al usado en la ruta/nombre del archivo, así que ambos pasan
 * por esta misma función.
 */
export function sanitizeName(raw: string): string {
  return raw
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // diacríticos combinantes
    .replace(/ñ/g, 'n')
    .replace(/Ñ/g, 'N')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Orden fijo de variables → columna fuente del valor. */
const VARIABLE_SOURCES: ReadonlyArray<{ variable: DgaVariable; key: keyof ExportableSend }> = [
  { variable: 'CAUDAL', key: 'caudal_instantaneo' },
  { variable: 'TOTALIZADOR', key: 'flujo_acumulado' },
  { variable: 'NIVEL_FREATICO', key: 'nivel_freatico' },
];

/** Descompone un envío en sus 3 filas Parquet (formato long). */
export function buildParquetRows(send: ExportableSend, opts: BuildRowsOptions): ParquetRow[] {
  const planta = sanitizeName(send.planta);
  const nombreSensor = sanitizeName(send.nombre_sensor);
  return VARIABLE_SOURCES.map(({ variable, key }) => ({
    NOMBRE_PROVEEDOR: opts.proveedor,
    PLANTA: planta,
    NOMBRE_SENSOR: nombreSensor,
    CENTRO_DE_OBRA: send.centro_de_obra,
    FECHA_MEDICION_SENSOR: send.ts,
    VARIABLE: variable,
    VALOR: (send[key] as string | null) ?? null,
    FECHA_REPORTE_DGA: send.sent_at,
    STATUS_DGA: send.dga_status_code,
    COMPROBANTE: send.comprobante,
    MENSAJE_DGA: send.dga_message,
    FECHA_HORA_CARGA: opts.fechaHoraCarga,
  }));
}

/** Esquema Parquet. Campos opcionales = pueden ser null. */
const PARQUET_SCHEMA = new ParquetSchema({
  NOMBRE_PROVEEDOR: { type: 'UTF8' },
  PLANTA: { type: 'UTF8' },
  NOMBRE_SENSOR: { type: 'UTF8' },
  CENTRO_DE_OBRA: { type: 'UTF8', optional: true },
  FECHA_MEDICION_SENSOR: { type: 'UTF8' },
  VARIABLE: { type: 'UTF8' },
  VALOR: { type: 'UTF8', optional: true },
  FECHA_REPORTE_DGA: { type: 'UTF8' },
  STATUS_DGA: { type: 'UTF8', optional: true },
  COMPROBANTE: { type: 'UTF8', optional: true },
  MENSAJE_DGA: { type: 'UTF8', optional: true },
  FECHA_HORA_CARGA: { type: 'UTF8' },
});

/**
 * Serializa filas a un Buffer Parquet en memoria. parquetjs escribe a un
 * stream; acá lo recolectamos en chunks y concatenamos. Útil para subir el
 * resultado a GCS sin tocar disco.
 */
export async function buildParquetBuffer(rows: ParquetRow[]): Promise<Buffer> {
  const chunks: Buffer[] = [];
  const sink = new Writable({
    write(chunk: Buffer, _enc, cb): void {
      chunks.push(Buffer.from(chunk));
      cb();
    },
  });

  const writer = await ParquetWriter.openStream(PARQUET_SCHEMA, sink as never);
  for (const row of rows) {
    await writer.appendRow(row as unknown as Record<string, unknown>);
  }
  await writer.close();

  return Buffer.concat(chunks);
}
