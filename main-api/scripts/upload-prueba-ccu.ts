/**
 * SUBIDA DE PRUEBA REAL al bucket productivo de CCU.
 * Sube un Parquet de ejemplo a _PRUEBA_EMELTEC/ y confirma con la metadata
 * que GCS devuelve. NO toca datos productivos (prefijo de prueba aparte).
 *
 * Correr: corepack pnpm exec tsx scripts/upload-prueba-ccu.ts
 */
import { Storage } from '@google-cloud/storage';
import { ParquetReader } from '@dsnp/parquetjs';
import {
  buildParquetRows,
  buildParquetBuffer,
  sanitizeName,
  type ExportableSend,
} from '../src/modules/dga/gcs-parquet-builder';

const KEY = '.secrets/gcs-sa.prod.json';
const BUCKET = 'raw-reg-ind-tc-ext-emeltec-prod';

const send: ExportableSend = {
  audit_id: 999999,
  site_id: 'PRUEBA',
  ts: '2026-06-24T12:00:00.000Z',
  sent_at: '2026-06-24T12:05:30.000Z',
  dga_status_code: '00',
  comprobante: '1W1Rq9joTE6AUpgDVuCIWEfWK2VK71Yn',
  dga_message: 'PRUEBA INTEGRACION EMELTEC',
  planta: 'CCU Quilín',
  centro_de_obra: 'OB-0601-292',
  nombre_sensor: '863071059218472',
  caudal_instantaneo: '12.50',
  flujo_acumulado: '348190',
  nivel_freatico: '8.30',
};

function ts(d: Date): string {
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`;
}

async function main(): Promise<void> {
  const now = new Date();
  const fecha = now.toISOString().slice(0, 10);
  const path = `_PRUEBA_EMELTEC/${sanitizeName(send.planta)}/fecha_carga=${fecha}/${sanitizeName(send.nombre_sensor)}_${ts(now)}.parquet`;

  console.log(`destino: gs://${BUCKET}/${path}\n`);

  const rows = buildParquetRows(send, { proveedor: 'EMELTEC', fechaHoraCarga: now.toISOString() });
  const buf = await buildParquetBuffer(rows);

  const storage = new Storage({ keyFilename: KEY });
  const file = storage.bucket(BUCKET).file(path);

  console.log(`subiendo ${buf.length} bytes...`);
  await file.save(buf, { resumable: false, contentType: 'application/vnd.apache.parquet' });
  console.log('✓ .save() resolvió sin error (GCS aceptó la escritura)\n');

  // Respuesta de éxito: metadata que devuelve GCS.
  const [md] = await file.getMetadata();
  console.log('=== RESPUESTA GCS (metadata del objeto) ===');
  console.log('name:        ', md.name);
  console.log('bucket:      ', md.bucket);
  console.log('size:        ', md.size, 'bytes');
  console.log('contentType: ', md.contentType);
  console.log('md5Hash:     ', md.md5Hash);
  console.log('crc32c:      ', md.crc32c);
  console.log('generation:  ', md.generation);
  console.log('timeCreated: ', md.timeCreated);
  console.log('mediaLink:   ', md.mediaLink);

  // Verificación extra: descargar y releer.
  const [dl] = await file.download();
  const reader = await ParquetReader.openBuffer(dl);
  const cursor = reader.getCursor();
  let n = 0;
  while (await cursor.next()) n++;
  await reader.close();
  console.log(`\n✓ descargado ${dl.length} bytes, releído ${n} filas`);
  console.log(`\n✓✓ SUBIDA REAL OK → gs://${BUCKET}/${path}`);
}

void main().catch((err) => {
  console.error('\n✗ FALLÓ:', (err as Error).message);
  process.exitCode = 1;
});
