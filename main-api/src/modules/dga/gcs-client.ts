/**
 * Wrapper fino sobre @google-cloud/storage para el export DGA.
 *
 * El cliente se instancia perezosamente (no al importar) para que los tests y
 * el arranque del proceso no exijan credenciales si el worker está apagado.
 * Credenciales: keyFile explícito (DGA_GCS_KEY_FILE) o ADC del entorno
 * (GOOGLE_APPLICATION_CREDENTIALS).
 */
import { Storage } from '@google-cloud/storage';
import { config } from '../../config/appConfig';

let storage: Storage | null = null;

function getStorage(): Storage {
  if (!storage) {
    storage = config.dga.gcs.keyFile
      ? new Storage({ keyFilename: config.dga.gcs.keyFile })
      : new Storage();
  }
  return storage;
}

/** Acuse de GCS tras subir: version del objeto + checksum MD5. */
export interface GcsUploadResult {
  generation: string | null;
  md5: string | null;
}

/**
 * Sube un Buffer como objeto en GCS. `resumable:false` — archivos chicos.
 * Devuelve el acuse (generation + md5Hash) que GCS asigna al objeto, como
 * prueba de entrega para el ledger.
 */
export async function uploadBufferToGcs(
  bucket: string,
  path: string,
  buf: Buffer,
): Promise<GcsUploadResult> {
  const file = getStorage().bucket(bucket).file(path);
  await file.save(buf, {
    resumable: false,
    contentType: 'application/vnd.apache.parquet',
  });
  const [md] = await file.getMetadata();
  return {
    generation: md.generation != null ? String(md.generation) : null,
    md5: md.md5Hash ?? null,
  };
}
