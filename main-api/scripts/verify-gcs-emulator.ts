/**
 * Prueba de subida REAL contra fake-gcs-server (emulador local).
 * Requiere el emulador corriendo en STORAGE_EMULATOR_HOST (default :4443).
 *   docker run -d --name fake-gcs -p 4443:4443 fsouza/fake-gcs-server \
 *     -scheme http -public-host localhost:4443
 *
 * Ejecuta el MISMO .save() que usa el worker (uploadBufferToGcs), descarga el
 * objeto, lo relee como Parquet y verifica las filas. Valida la subida de red.
 */
import { Storage } from '@google-cloud/storage';
import { ParquetReader } from '@dsnp/parquetjs';
import {
  buildParquetRows,
  buildParquetBuffer,
  type ExportableSend,
} from '../src/modules/dga/gcs-parquet-builder';
import { buildGcsPath } from '../src/modules/dga/gcs-exporter';

const HOST = process.env['STORAGE_EMULATOR_HOST'] ?? 'http://localhost:4443';
const BUCKET = 'raw-reg-ind-tc-ext-emeltec-prod';
const NOW = new Date('2026-06-24T13:00:00.000Z');

const send: ExportableSend = {
  audit_id: 101,
  site_id: 'S042',
  ts: '2026-06-24T12:00:00.000Z',
  sent_at: '2026-06-24T12:05:30.000Z',
  dga_status_code: '00',
  comprobante: '1W1Rq9joTE6AUpgDVuCIWEfWK2VK71Yn',
  dga_message: 'Medición ingresada',
  planta: 'CCU Quilín',
  centro_de_obra: 'OB-0601-292',
  nombre_sensor: '863071059218472',
  caudal_instantaneo: '12.50',
  flujo_acumulado: '348190',
  nivel_freatico: '8.30',
};

async function main(): Promise<void> {
  console.log(`emulador: ${HOST}`);
  const storage = new Storage({ apiEndpoint: HOST, projectId: 'ccu-datalake-sim' });

  // 1) Asegurar bucket.
  try {
    await storage.createBucket(BUCKET);
    console.log(`bucket creado: ${BUCKET}`);
  } catch (err) {
    console.log(`bucket ya existe o aviso: ${(err as Error).message}`);
  }

  // 2) Build + subida REAL (mismo .save() del worker).
  const path = buildGcsPath(send.planta, send.nombre_sensor, NOW);
  const rows = buildParquetRows(send, { proveedor: 'EMELTEC', fechaHoraCarga: NOW.toISOString() });
  const buf = await buildParquetBuffer(rows);
  await storage
    .bucket(BUCKET)
    .file(path)
    .save(buf, { resumable: false, contentType: 'application/vnd.apache.parquet' });
  console.log(`\n✓ SUBIDO: gs://${BUCKET}/${path} (${buf.length} bytes)`);

  // 3) Listar.
  const [files] = await storage.bucket(BUCKET).getFiles();
  console.log('\n=== OBJETOS EN BUCKET ===');
  for (const f of files) console.log(' -', f.name);

  // 4) Descargar + releer Parquet.
  const [dl] = await storage.bucket(BUCKET).file(path).download();
  const reader = await ParquetReader.openBuffer(dl);
  const cursor = reader.getCursor();
  const out: Record<string, unknown>[] = [];
  let rec: unknown;
  while ((rec = await cursor.next())) out.push(rec as Record<string, unknown>);
  await reader.close();

  console.log(`\n=== DESCARGADO Y RELEÍDO (${out.length} filas) ===`);
  console.table(
    out.map((r) => ({
      NOMBRE_SENSOR: r['NOMBRE_SENSOR'],
      VARIABLE: r['VARIABLE'],
      VALOR: r['VALOR'],
      STATUS_DGA: r['STATUS_DGA'],
      COMPROBANTE: r['COMPROBANTE'],
    })),
  );

  const ok = out.length === 3 && dl.length === buf.length;
  console.log(`\n${ok ? '✓' : '✗'} round-trip subida↔descarga ${ok ? 'OK' : 'FALLÓ'}`);
  if (!ok) process.exitCode = 1;
}

void main().catch((err) => {
  console.error('ERROR:', (err as Error).message);
  process.exitCode = 1;
});
