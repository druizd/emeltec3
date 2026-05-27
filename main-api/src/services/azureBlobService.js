/**
 * Cliente Azure Blob Storage para el container de bitácora-documentos.
 *
 * Inicialización perezosa: si AZURE_STORAGE_CONNECTION_STRING no está
 * presente al arrancar, se loguea warning y los handlers que llamen
 * getContainerClient() fallarán con 503. Esto permite levantar la API en
 * dev sin Azure configurado.
 *
 * Para descargar archivos se generan SAS URLs temporales (15 min) en vez
 * de proxiar bytes por el backend.
 */

const crypto = require('crypto');
const {
  BlobServiceClient,
  StorageSharedKeyCredential,
  generateBlobSASQueryParameters,
  BlobSASPermissions,
} = require('@azure/storage-blob');

const CONNECTION_STRING = process.env.AZURE_STORAGE_CONNECTION_STRING;
const CONTAINER_NAME = process.env.AZURE_STORAGE_CONTAINER || 'bitacoradocumentos';
const SAS_TTL_MIN = parseInt(process.env.AZURE_STORAGE_SAS_TTL_MIN || '15', 10);

let blobServiceClient = null;
let containerClient = null;
let accountName = null;
let accountKey = null;

function init() {
  if (!CONNECTION_STRING) {
    console.warn(
      '[azureBlobService] AZURE_STORAGE_CONNECTION_STRING ausente. Endpoints de documentos retornarán 503.',
    );
    return;
  }
  try {
    blobServiceClient = BlobServiceClient.fromConnectionString(CONNECTION_STRING);
    containerClient = blobServiceClient.getContainerClient(CONTAINER_NAME);

    // Parse connection string para obtener account name + key (necesarios para SAS).
    for (const part of CONNECTION_STRING.split(';')) {
      const [k, ...rest] = part.split('=');
      const v = rest.join('=');
      if (k === 'AccountName') accountName = v;
      else if (k === 'AccountKey') accountKey = v;
    }
    console.log(
      `[azureBlobService] Conectado a container '${CONTAINER_NAME}' (cuenta ${accountName})`,
    );
  } catch (err) {
    console.error('[azureBlobService] Error inicializando:', err.message);
    blobServiceClient = null;
    containerClient = null;
  }
}

function isConfigured() {
  return containerClient !== null;
}

function ensureConfigured(res) {
  if (containerClient) return true;
  res.status(503).json({
    ok: false,
    error: 'Azure Blob Storage no configurado (falta AZURE_STORAGE_CONNECTION_STRING)',
  });
  return false;
}

function buildBlobPath(sitioId, originalName) {
  const ext = (originalName.match(/\.[^.]+$/) || [''])[0].toLowerCase();
  const safeBase = originalName
    .replace(ext, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .slice(0, 80);
  const id = crypto.randomBytes(8).toString('hex');
  const yyyymm = new Date().toISOString().slice(0, 7);
  return `${sitioId}/${yyyymm}/${id}-${safeBase}${ext}`;
}

async function uploadBuffer({ blobPath, buffer, contentType }) {
  if (!containerClient) throw new Error('Azure Blob no configurado');
  const blockBlob = containerClient.getBlockBlobClient(blobPath);
  await blockBlob.uploadData(buffer, {
    blobHTTPHeaders: { blobContentType: contentType },
  });
}

async function deleteBlob(blobPath) {
  if (!containerClient) throw new Error('Azure Blob no configurado');
  const blockBlob = containerClient.getBlockBlobClient(blobPath);
  await blockBlob.deleteIfExists();
}

function generateDownloadSasUrl(blobPath, originalName) {
  if (!containerClient || !accountName || !accountKey) {
    throw new Error('Azure Blob no configurado para SAS');
  }
  const credential = new StorageSharedKeyCredential(accountName, accountKey);
  const expiresOn = new Date(Date.now() + SAS_TTL_MIN * 60 * 1000);

  const sas = generateBlobSASQueryParameters(
    {
      containerName: CONTAINER_NAME,
      blobName: blobPath,
      permissions: BlobSASPermissions.parse('r'),
      expiresOn,
      contentDisposition: `attachment; filename="${originalName.replace(/"/g, '')}"`,
    },
    credential,
  ).toString();

  const blockBlob = containerClient.getBlockBlobClient(blobPath);
  return `${blockBlob.url}?${sas}`;
}

init();

module.exports = {
  isConfigured,
  ensureConfigured,
  buildBlobPath,
  uploadBuffer,
  deleteBlob,
  generateDownloadSasUrl,
};
