/**
 * Verificación local del exporter DGA→GCS (NO sube a GCS real).
 * Uso: ver comando en el chat. Genera un .parquet de ejemplo, lo relee y
 * confirma que el cliente GCS instancia con el service account simulado.
 */
import { writeFileSync } from 'node:fs';
import { ParquetReader } from '@dsnp/parquetjs';
import { Storage } from '@google-cloud/storage';
import {
  buildParquetRows,
  buildParquetBuffer,
  type ExportableSend,
} from '../src/modules/dga/gcs-parquet-builder';
import { buildGcsPath } from '../src/modules/dga/gcs-exporter';

const SA_PATH = '.secrets/gcs-sa.simulated.json';
const OUT = '.secrets/sample.parquet';
const NOW = new Date('2026-06-24T13:00:00.000Z');

const send: ExportableSend = {
  audit_id: 101,
  site_id: 'S042',
  ts: '2026-06-24T12:00:00.000Z',
  sent_at: '2026-06-24T12:05:30.000Z',
  dga_status_code: '00',
  comprobante: '1W1Rq9joTE6AUpgDVuCIWEfWK2VK71Yn',
  dga_message: 'Medición ingresada', // verbatim de SNIA (placeholder)
  planta: 'CCU Quilín',
  centro_de_obra: 'OB-0601-292',
  nombre_sensor: '863071059218472', // sitio.id_serial
  caudal_instantaneo: '12.50',
  flujo_acumulado: '348190',
  nivel_freatico: '8.30',
};

async function main(): Promise<void> {
  // 1) Path (byte-idéntico a columnas PLANTA / NOMBRE_SENSOR).
  const path = buildGcsPath(send.planta, send.nombre_sensor, NOW);
  console.log('\n=== PATH GCS ===');
  console.log(path);

  // 2) Build Parquet real.
  const rows = buildParquetRows(send, { proveedor: 'EMELTEC', fechaHoraCarga: NOW.toISOString() });
  const buf = await buildParquetBuffer(rows);
  writeFileSync(OUT, buf);
  console.log(`\n=== PARQUET ===\nbytes: ${buf.length}  →  ${OUT}`);

  // 3) Re-leer y volcar filas (prueba que es Parquet válido + esquema).
  const reader = await ParquetReader.openBuffer(buf);
  const cursor = reader.getCursor();
  const out: Record<string, unknown>[] = [];
  let rec: unknown;
  while ((rec = await cursor.next())) out.push(rec as Record<string, unknown>);
  await reader.close();
  console.log(`\n=== FILAS LEÍDAS (${out.length}) ===`);
  console.table(
    out.map((r) => ({
      PLANTA: r['PLANTA'],
      NOMBRE_SENSOR: r['NOMBRE_SENSOR'],
      CENTRO_DE_OBRA: r['CENTRO_DE_OBRA'],
      VARIABLE: r['VARIABLE'],
      VALOR: r['VALOR'],
      STATUS_DGA: r['STATUS_DGA'],
      COMPROBANTE: r['COMPROBANTE'],
    })),
  );

  // 4) Concordancia byte-idéntica columna ↔ path.
  const folder = path.split('/')[0];
  const fileStem = (path.split('/').pop() ?? '').replace(/_\d{14}\.parquet$/, '');
  const okPlanta = folder === out[0]?.['PLANTA'];
  const okSensor = fileStem === out[0]?.['NOMBRE_SENSOR'];
  console.log('\n=== CONCORDANCIA ===');
  console.log(`carpeta "${folder}" === PLANTA "${out[0]?.['PLANTA']}"  → ${okPlanta}`);
  console.log(
    `archivo "${fileStem}" === NOMBRE_SENSOR "${out[0]?.['NOMBRE_SENSOR']}"  → ${okSensor}`,
  );

  // 5) Instanciar cliente GCS con el SA simulado (NO sube nada).
  const storage = new Storage({ keyFilename: SA_PATH });
  const file = storage.bucket('raw-reg-ind-tc-ext-emeltec-prod').file(path);
  console.log('\n=== GCS CLIENT ===');
  console.log(
    'service account:',
    (storage.authClient as never as { jsonContent?: { client_email?: string } })?.['jsonContent']
      ?.client_email ?? '(lazy)',
  );
  console.log('destino simulado:', `gs://${file.bucket.name}/${file.name}`);
  console.log('\n✓ wiring OK (subida real requiere creds reales de CCU)');

  if (!okPlanta || !okSensor) process.exitCode = 1;
}

void main();
