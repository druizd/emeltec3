# DGA → GCS Exporter

Exporta a Google Cloud Storage (Parquet) cada envío DGA por el que **la API de
SNIA emitió respuesta**, sea aceptado (`status '00'`) o **rechazado** (cualquier
otro código).

> **Origen:** solicitado por **CCU_Central** (dueño de las instalaciones CCU).
> El diseño es **genérico**: aplica a cualquier empresa. CCU solo se documenta
> como solicitante. La selección de qué instalaciones exportan es **por-sitio**.

---

## Regla de oro

- ✅ Se exporta TODO lo que **tuvo respuesta de DGA** (enviado o rechazado).
- ❌ **Nunca** se exporta algo sin respuesta: error de red, timeout o error
  pre-envío dejan `dga_send_audit.dga_status_code = NULL` → quedan fuera.

El gate es la **respuesta del POST a SNIA**, no la consulta GET de verificación
(`consultarSnia`). Un rechazado nunca quedaría "verified" en el GET y aun así
debe exportarse, por eso el gate es `dga_status_code IS NOT NULL`.

---

## Flujo (cada `DGA_GCS_BATCH_MINUTES`)

1. `listExportableSends` trae filas de `dga_send_audit` con `dga_status_code IS
   NOT NULL`, de sitios con `pozo_config.dga_gcs_export = TRUE`, que aún no
   estén en `dga_gcs_export_log`.
2. Agrupa por `site_id`; por sitio genera **un** Parquet (3 filas por medición:
   `CAUDAL`, `TOTALIZADOR`, `NIVEL_FREATICO`).
3. Sube a GCS. **Solo si la subida fue OK**, registra cada audit en
   `dga_gcs_export_log` (idempotencia + auditoría).

La subida precede al log: si el proceso muere entremedio, el próximo ciclo
re-sube (path determinístico) y `ON CONFLICT (audit_id)` evita duplicar el
ledger. Nunca se marca exportado algo que no subió.

---

## Selección de instalaciones

Columna `pozo_config.dga_gcs_export BOOLEAN DEFAULT FALSE`. Se administra desde
la UI de configuración DGA del sitio (toggle "Copia a GCS"), vía el mismo
`PATCH /api/v2/dga/sites/:siteId/pozo-config`. Opt-in explícito por sitio.

### Activación y seguridad (UI)

- **2FA al activar**: poner `dga_gcs_export=true` exige verificación de 2 pasos
  (header `X-DGA-2FA-Code`), igual que pasar `dga_transport='rest'`. El guard
  `require2faIfSensitiveChange` (`modules/dga/twofactor-guards.ts`) lo aplica en
  el PATCH. **Desactivar** (`false`) NO pide 2FA.
- **Flujo en el frontend** (`dga-generar-reporte-modal.ts`): al marcar el toggle,
  el backend responde `DGA_2FA_REQUIRED`; el componente abre el prompt 2FA y
  reintenta con el código (lógica ya existente, sin código nuevo).
- **Ícono de ayuda `?`**: junto al toggle, un `material-symbols help` con tooltip
  que explica el propósito y advierte que es **desarrollo a medida de
  CCU_Central — usar SOLO en instalaciones de CCU**.

---

## Origen de los valores (auditable)

Los valores `CAUDAL / TOTALIZADOR / NIVEL_FREATICO` salen de
`dga_send_audit.request_payload->'medicionSubterranea'` — la medición **tal cual
se envió** en ese intento — no de `dato_dga` (mutable). Así el Parquet es
reconciliable contra lo que efectivamente recibió DGA.

---

## Esquema Parquet (formato long, 1 fila por variable)

| Columna | Fuente |
|---|---|
| `NOMBRE_PROVEEDOR` | `DGA_GCS_PROVEEDOR` (default `EMELTEC`) |
| `PLANTA` | `sub_empresa.nombre` (sin tildes, ñ→n) |
| `NOMBRE_SENSOR` | `sitio.id_serial` (serial físico del sensor/datalogger) |
| `CENTRO_DE_OBRA` | `request_payload._headers.codigoObra` ∥ `pozo_config.obra_dga` |
| `FECHA_MEDICION_SENSOR` | `dga_send_audit.ts` |
| `VARIABLE` | `CAUDAL` / `TOTALIZADOR` / `NIVEL_FREATICO` |
| `VALOR` | valor enviado (puede ser null) |
| `FECHA_REPORTE_DGA` | `dga_send_audit.sent_at` |
| `STATUS_DGA` | `dga_send_audit.dga_status_code` (`'00'` o código de rechazo) |
| `COMPROBANTE` | `dga_send_audit.api_n_comprobante` verbatim de SNIA (null en rechazos) |
| `MENSAJE_DGA` | `dga_send_audit.dga_message` verbatim de SNIA (texto OK o motivo de rechazo) |
| `FECHA_HORA_CARGA` | timestamp del ciclo |

Path GCS (spec CCU_Central):
```
{bucket}/{nombre_planta}/fecha_carga=YYYY-MM-DD/{nombre_sensor}_{yyyymmddhhmmss}.parquet
```
La carpeta es **byte-idéntica** a la columna `PLANTA` y el stem del archivo a
`NOMBRE_SENSOR` (misma función `sanitizeName`: sin tildes, Ñ→N, espacios
colapsados, conservando mayúsculas y espacios). `fecha_carga` va **sin comillas**
para que BigQuery/Hive detecte la partición. Separador `;` y CSV solo aplican
como fallback si Parquet diera problema técnico.

---

## Variables de entorno

```env
ENABLE_DGA_GCS_WORKER=true                 # default false
DGA_GCS_BUCKET=raw-reg-ind-tc-ext-emeltec-prod
DGA_GCS_BATCH_MINUTES=60                    # intervalo del ciclo
DGA_GCS_KEY_FILE=/ruta/service-account.json # opcional; si no, usa ADC
DGA_GCS_PROVEEDOR=EMELTEC
# DGA_GCS_MAX_PER_CYCLE=500
```

`@dsnp/parquetjs` corre con compresión UNCOMPRESSED por defecto → **sin build
nativo** en el Docker Linux.

---

## Cómo se envían los datos (transporte y autenticación)

No hay FTP, SFTP ni API intermedia: la API de Emeltec escribe **directo** en el
bucket de CCU usando el SDK oficial de Google (`@google-cloud/storage`) sobre
**HTTPS** contra la API JSON de GCS.

**Destino (credencial entregada por CCU):**

| Dato | Valor |
|---|---|
| Proyecto GCP | `ccusa-90321100-mdw-prod` |
| Service account | `id-sa-mdw-bucket-int-emeltec-p@ccusa-90321100-mdw-prod.iam.gserviceaccount.com` |
| Bucket | `raw-reg-ind-tc-ext-emeltec-prod` |

**Autenticación:** el service account JSON contiene una llave privada RSA. El
SDK firma un JWT con esa llave, lo canjea en `oauth2.googleapis.com/token` por un
access token de corta duración, y ese token autoriza cada request a GCS. CCU
controla el acceso: el bucket sólo acepta a ese service account con permiso de
escritura (rol `Storage Object Creator`/`Admin`). Emeltec nunca usa usuario/clave.

**Transporte de un archivo (lo que hace `uploadBufferToGcs` → `file.save()`):**

```
worker arma Parquet en memoria (Buffer)
   │  HTTPS POST  storage.googleapis.com/upload/storage/v1/b/<bucket>/o
   │  (uploadType=multipart, resumable:false) + Bearer <access_token>
   ▼
GCS guarda el objeto en  <bucket>/<PLANTA>/fecha_carga=YYYY-MM-DD/<NOMBRE_SENSOR>_<ts>.parquet
   │  responde 200 + metadata del objeto
   ▼
worker registra el audit en dga_gcs_export_log (idempotencia)
```

- **TLS**: todo el tráfico va cifrado (HTTPS). La llave privada nunca viaja.
- **Sin reintentos peligrosos**: si la subida falla (red/permiso), el worker NO
  registra el log → el próximo ciclo reintenta. El path es determinístico, así
  que un reintento sobrescribe el mismo objeto en vez de duplicar.
- **Idempotencia**: `dga_gcs_export_log` con `UNIQUE(audit_id)` evita re-subir un
  envío ya entregado.
- **Prueba de entrega**: tras subir, el ledger guarda el acuse de GCS —
  `gcs_generation` (versión del objeto) y `gcs_md5` (checksum) — para reconciliar
  integridad contra lo que CCU recibió.

**Dónde poner la credencial (deploy):** el JSON va en el servidor (fuera del
repo), y se apunta con `DGA_GCS_KEY_FILE=/ruta/sa-mdw-bucket-int-emeltec-prod.json`
(o vía `GOOGLE_APPLICATION_CREDENTIALS`). En local ya está en
`main-api/.secrets/gcs-sa.prod.json` (gitignored).

---

## Archivos

| Archivo | Rol |
|---|---|
| `infra-db/migrations/2026-06-24-dga-gcs-export.sql` | columna `dga_gcs_export` + tabla `dga_gcs_export_log` |
| `main-api/src/modules/dga/gcs-repo.ts` | query de exportables + insert al ledger |
| `main-api/src/modules/dga/gcs-parquet-builder.ts` | rows → Parquet Buffer (puro) |
| `main-api/src/modules/dga/gcs-client.ts` | wrapper `@google-cloud/storage` |
| `main-api/src/modules/dga/gcs-exporter.ts` | worker (cron, agrupa, sube, registra) |
| `main-api/src/modules/dga/twofactor-guards.ts` | guard 2FA para cambios sensibles (transport=rest, gcs_export=true) |
| `main-api/src/server.js` | arranque/cierre del worker |
| `main-api/src/config/appConfig.ts` | env vars + `config.dga.gcs` |
| `main-api/src/http/v2/routes.ts` | aplica `require2faIfSensitiveChange` en el PATCH |
| `main-api/src/modules/dga/{schema,repo,service}.ts` | `dga_gcs_export` en payload/row/DTO |
| `frontend-angular/.../dga-generar-reporte-modal.ts` | toggle "Copia a GCS" + ícono ayuda + 2FA |
| `frontend-angular/.../services/dga.service.ts` | tipos `PozoDgaConfig` / payload |

### Tests (vitest)

| Test | Cubre |
|---|---|
| `__tests__/gcs-parquet-builder.test.ts` | 9 — 3 filas/medición, mapping VALOR, rechazados, nulls, sanitizeName, round-trip Parquet |
| `__tests__/gcs-exporter.test.ts` | 6 — agrupa+sube+registra, falla-subida-no-registra, vacío, sin-bucket, byte-identidad path |
| `__tests__/twofactor-guards.test.ts` | 7 — 2FA al activar gcs_export/rest, no-2FA al desactivar/cambios no sensibles |

### Verificación local

| Script | Qué hace |
|---|---|
| `scripts/verify-gcs-export.ts` | Genera Parquet de ejemplo, lo relee, valida concordancia byte-idéntica e instancia el cliente GCS (sin red) |
| `scripts/verify-gcs-emulator.ts` | Subida REAL contra fake-gcs-server (Docker), descarga y relee (round-trip) |

Emulador:
```
docker run -d --name fake-gcs -p 4443:4443 fsouza/fake-gcs-server -scheme http -public-host localhost:4443
# crear bucket (el client createBucket falla contra el fake): 
curl -X POST "http://localhost:4443/storage/v1/b?project=ccu-datalake-sim" -d '{"name":"raw-reg-ind-tc-ext-emeltec-prod"}'
STORAGE_EMULATOR_HOST=http://localhost:4443 DB_PASSWORD=x JWT_SECRET=xxxxxxxxxxxxxxxx tsx scripts/verify-gcs-emulator.ts
```

---

## Pendiente antes del deploy

- [ ] Aplicar migración `2026-06-24-dga-gcs-export.sql`.
- [ ] Conseguir service account JSON de GCS (proyecto destino de CCU_Central).
- [ ] Setear env vars en el `.env` del servidor + `ENABLE_DGA_GCS_WORKER=true`.
- [ ] Activar `dga_gcs_export` en los sitios CCU que correspondan (toggle UI).
- [ ] `build` + restart de `emeltec-api`.
