import { describe, it, expect } from 'vitest';
import { ParquetReader } from '@dsnp/parquetjs';
import {
  sanitizeName,
  buildParquetRows,
  buildParquetBuffer,
  type ExportableSend,
  type ParquetRow,
} from '../gcs-parquet-builder';

const baseSend: ExportableSend = {
  audit_id: 101,
  site_id: 'S042',
  ts: '2026-06-24T12:00:00.000Z',
  sent_at: '2026-06-24T12:05:30.000Z',
  dga_status_code: '00',
  comprobante: 'C-99887',
  dga_message: 'Recepción conforme',
  planta: 'Planta Ñuñoa Río Maipú',
  centro_de_obra: 'OB-0601-292',
  nombre_sensor: 'Pozo Norte',
  caudal_instantaneo: '12.50',
  flujo_acumulado: '348190',
  nivel_freatico: '8.30',
};

const OPTS = { proveedor: 'EMELTEC', fechaHoraCarga: '2026-06-24T13:00:00.000Z' };

describe('sanitizeName', () => {
  it('elimina tildes y reemplaza ñ→n, conserva mayúsculas y espacios', () => {
    expect(sanitizeName('Planta Ñuñoa Río Maipú')).toBe('Planta Nunoa Rio Maipu');
  });

  it('colapsa espacios y recorta', () => {
    expect(sanitizeName('  Aguas   Andinas  ')).toBe('Aguas Andinas');
  });
});

describe('buildParquetRows', () => {
  it('genera 3 filas por medición: CAUDAL, TOTALIZADOR, NIVEL_FREATICO', () => {
    const rows = buildParquetRows(baseSend, OPTS);
    expect(rows.map((r) => r.VARIABLE)).toEqual(['CAUDAL', 'TOTALIZADOR', 'NIVEL_FREATICO']);
  });

  it('mapea cada VALOR a su columna fuente', () => {
    const rows = buildParquetRows(baseSend, OPTS);
    const byVar = Object.fromEntries(rows.map((r) => [r.VARIABLE, r.VALOR]));
    expect(byVar['CAUDAL']).toBe('12.50');
    expect(byVar['TOTALIZADOR']).toBe('348190');
    expect(byVar['NIVEL_FREATICO']).toBe('8.30');
  });

  it('propaga metadatos comunes y sanitiza PLANTA', () => {
    const [row] = buildParquetRows(baseSend, OPTS) as [ParquetRow];
    expect(row.NOMBRE_PROVEEDOR).toBe('EMELTEC');
    expect(row.PLANTA).toBe('Planta Nunoa Rio Maipu');
    expect(row.NOMBRE_SENSOR).toBe('Pozo Norte');
    expect(row.CENTRO_DE_OBRA).toBe('OB-0601-292');
    expect(row.FECHA_MEDICION_SENSOR).toBe('2026-06-24T12:00:00.000Z');
    expect(row.FECHA_REPORTE_DGA).toBe('2026-06-24T12:05:30.000Z');
    expect(row.STATUS_DGA).toBe('00');
    expect(row.COMPROBANTE).toBe('C-99887');
    expect(row.MENSAJE_DGA).toBe('Recepción conforme');
    expect(row.FECHA_HORA_CARGA).toBe('2026-06-24T13:00:00.000Z');
  });

  it('sanitiza NOMBRE_SENSOR igual que sanitizeName (base de la concordancia con el path)', () => {
    const conTilde: ExportableSend = { ...baseSend, nombre_sensor: 'Pozo Ñuñoa Río' };
    const [row] = buildParquetRows(conTilde, OPTS) as [ParquetRow];
    expect(row.NOMBRE_SENSOR).toBe('Pozo Nunoa Rio');
    expect(row.NOMBRE_SENSOR).toBe(sanitizeName(conTilde.nombre_sensor));
    expect(row.PLANTA).toBe(sanitizeName(conTilde.planta));
  });

  it('exporta rechazados: STATUS_DGA conserva el código de rechazo', () => {
    const rechazado: ExportableSend = {
      ...baseSend,
      dga_status_code: '07',
      comprobante: null,
      dga_message: 'Caudal fuera de rango',
    };
    const rows = buildParquetRows(rechazado, OPTS);
    expect(rows.every((r) => r.STATUS_DGA === '07')).toBe(true);
    expect(rows.every((r) => r.COMPROBANTE === null)).toBe(true);
  });

  it('preserva VALOR null cuando la variable no tiene dato', () => {
    const sinNivel: ExportableSend = { ...baseSend, nivel_freatico: null };
    const rows = buildParquetRows(sinNivel, OPTS);
    const nivel = rows.find((r) => r.VARIABLE === 'NIVEL_FREATICO');
    expect(nivel?.VALOR).toBeNull();
  });
});

describe('buildParquetBuffer', () => {
  it('produce un Parquet legible que round-trips las filas', async () => {
    const rows = buildParquetRows(baseSend, OPTS);
    const buf = await buildParquetBuffer(rows);
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.length).toBeGreaterThan(0);

    const reader = await ParquetReader.openBuffer(buf);
    const cursor = reader.getCursor();
    const out: ParquetRow[] = [];
    let rec: unknown;
    while ((rec = await cursor.next())) {
      out.push(rec as ParquetRow);
    }
    await reader.close();

    expect(out).toHaveLength(3);
    expect(out.map((r) => r.VARIABLE)).toEqual(['CAUDAL', 'TOTALIZADOR', 'NIVEL_FREATICO']);
    expect(out[0]?.NOMBRE_PROVEEDOR).toBe('EMELTEC');
    expect(out[0]?.PLANTA).toBe('Planta Nunoa Rio Maipu');
  });
});
