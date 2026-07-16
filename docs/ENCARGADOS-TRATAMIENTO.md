# Inventario de Encargados de Tratamiento — Emeltec Cloud

> Cubre la tarea **B11.1** (inventario de encargados de tratamiento) de
> `PLAN-MEJORAS.md`. Base legal: Art. 15 bis, Ley 19.628 modificada por
> Ley 21.719 (vigencia 01-12-2026).
>
> Las tareas B11.2 (revisión y cierre de DPAs) y B11.3 (acuerdos de
> confidencialidad con empleados/contratistas) están fuera del alcance de
> este documento.
>
> ⚠️ Documento interno de trabajo. No es asesoría legal.
> Los campos marcados `【PENDIENTE VERIFICAR】` requieren validación antes
> de usar este documento como evidencia ante la Agencia.

---

## 1. Marco legal

El Art. 15 bis de la Ley 19.628 establece que cuando el responsable del
tratamiento encargue a un tercero el tratamiento de datos personales, debe
existir un **contrato con contenido mínimo** que incluya: objeto, duración,
finalidad, tipos de datos, categorías de titulares, derechos y obligaciones
del encargado. El encargado queda directamente sujeto al deber de secreto
(Art. 14 bis) y al deber de adoptar medidas de seguridad (Art. 14 quinquies).

Obligaciones del encargado hacia el responsable:
- Tratar los datos exclusivamente conforme a las instrucciones del responsable.
- No subdelegarlos sin autorización escrita previa del responsable.
- Reportar al responsable cualquier vulneración de seguridad.
- Al término del servicio, suprimir o devolver los datos personales.

La Agencia de Protección de Datos publicará contratos modelo para encargados
(Art. 15 bis inc. final). A la fecha de este inventario, dichos modelos no han
sido publicados.

---

## 2. Criterio de inclusión en este inventario

Se incluye como encargado de tratamiento todo tercero que:
1. Trata datos personales **por cuenta de Emeltec** (no por cuenta propia ni
   como responsable independiente).
2. Tiene acceso a datos personales de los titulares del servicio SaaS
   (usuarios de clientes B2B, contactos de alertas, datos del audit log).

No se incluyen en esta tabla los responsables independientes (por ejemplo,
ACHS actúa como responsable por mandato de la Ley 16.744, no como encargado
de Emeltec).

---

## 3. Inventario de encargados

### E1 — Microsoft Azure (infraestructura de hosting)

| Aspecto | Detalle |
| --- | --- |
| Encargado | Microsoft Corporation (proveedor de nube) |
| Servicio | Máquina virtual (VM) Azure donde se despliega el stack Docker de Emeltec Cloud |
| Qué dato personal ve | Potencialmente todos los datos alojados en la VM: base de datos de usuarios, audit log, credenciales DGA en reposo. En la práctica, el acceso a nivel de infraestructura es técnico; Microsoft no procesa ni accede al contenido de los datos de aplicación en condiciones normales |
| Confirmado en el repo | Sí — el workflow `deploy-production.yml` referencia `secrets.AZURE_VM_HOST` y `secrets.AZURE_VM_SSH_KEY`; el `docker-compose.yml` despliega el stack completo (BD TimescaleDB, main-api, auth-api, frontend) sobre la VM |
| Ubicación / transferencia internacional | Infraestructura en región Azure 【PENDIENTE VERIFICAR: confirmar región configurada, ej. East US, Brazil South】; si es región fuera de Chile → transferencia internacional de datos personales que requiere base legal (Art. 28 Ley 19.628) |
| DPA disponible | Microsoft ofrece su Data Processing Agreement (DPA) estándar en [Microsoft Privacy](https://www.microsoft.com/en-us/licensing/product-licensing/products) como parte de las condiciones del servicio |
| Estado del contrato | 【PENDIENTE VERIFICAR: confirmar que la suscripción activa de Azure incluye el DPA estándar de Microsoft — revisar portal de Microsoft para la cuenta de Emeltec】 |
| Acción pendiente | B11.2: verificar y archivar el DPA de Microsoft aplicable; confirmar región de la VM |

---

### E2 — Resend (envío de correo electrónico transaccional)

| Aspecto | Detalle |
| --- | --- |
| Encargado | Resend Inc. (proveedor de correo transaccional) |
| Servicio | Envío de correos de acceso OTP (inicio de sesión), códigos 2FA (step-up para acciones sensibles), notificaciones de alertas industriales y resúmenes de salud de la plataforma |
| Qué dato personal ve | Correo electrónico del destinatario (usuario o contacto de alertas); asunto y cuerpo del mensaje (contiene el código OTP o el detalle de la alerta); nombre del destinatario en algunos templates |
| Confirmado en el repo | Sí — `main-api/src/services/emailService.js` línea 1: `const { Resend } = require('resend');`, línea 52: `const resend = RESEND_API_KEY ? new Resend(RESEND_API_KEY) : null;`. El servicio usa `resend.emails.send()` para todos los envíos transaccionales. `auth-api` delega el envío al main-api vía endpoint interno |
| Datos que contiene el cuerpo del correo | OTP/2FA: código + tiempo de expiración (sin nombre ni datos adicionales — configuración actual del template). Alertas: nombre del destinatario, descripción del sitio, variable afectada, valor detectado (datos operacionales) |
| Ubicación / transferencia internacional | Resend procesa correos en infraestructura de AWS (EE.UU., con posibilidad de otras regiones). Los correos electrónicos con datos personales del titular se transfieren fuera de Chile → transferencia internacional |
| Subprocesadores de Resend | Amazon Web Services (infraestructura de envío) — declarado en la política de Resend |
| DPA disponible | Resend ofrece DPA en `resend.com/legal/dpa` |
| Estado del contrato | 【PENDIENTE VERIFICAR: confirmar si se ha aceptado formalmente el DPA de Resend y si se ha archivado. Acción mínima: aceptar el DPA en la cuenta de Resend y archivar la constancia】 |
| Acción pendiente | B11.2: aceptar y archivar el DPA de Resend; documentar subprocesador AWS; verificar que el cuerpo de los correos OTP no incluya datos más allá del código y expiración (ya verificado en el código — mantener) |

---

### E3 — GitHub / GitHub Actions (repositorio de código e integración continua)

| Aspecto | Detalle |
| --- | --- |
| Encargado | GitHub Inc. (subsidiaria de Microsoft) |
| Servicio | Repositorio de código fuente (`github.com/druizd/emeltec3`); CI/CD mediante GitHub Actions (lint, test, build, publicación de imágenes a GHCR) |
| Qué dato personal podría ver | Logs de ejecución de los workflows de CI/CD. Los workflows leen archivos de ejemplo (`.env.example`) que, según el análisis del repo, no contienen datos personales reales. Los secretos (claves de Azure, RESEND_API_KEY) se pasan como `secrets.*` y GitHub Actions los enmascara en los logs |
| Confirmado en el repo | Sí — workflows en `.github/workflows/`. `ci.yml` corre lint/test/build con `pnpm`. `build-publish.yml` construye imágenes y las publica en GHCR (`ghcr.io/druizd/emeltec3`). `deploy-production.yml` usa SSH a la VM de Azure con clave almacenada como secreto |
| Riesgo de filtración en logs | 【PENDIENTE VERIFICAR: revisar que los logs de CI no exponen correos, IPs ni datos de usuarios de producción. Riesgo bajo si los tests solo usan datos sintéticos (no hay fixtures con datos reales detectados en el análisis)】 |
| Ubicación / transferencia internacional | GitHub opera en EE.UU. (Microsoft). Repositorio y logs de CI en infraestructura estadounidense → transferencia internacional si hay datos personales en el repo |
| DPA disponible | GitHub ofrece DPA como parte de sus condiciones para organizaciones |
| Estado del contrato | 【PENDIENTE VERIFICAR: confirmar si la cuenta de GitHub de Emeltec tiene activado el DPA de GitHub (Data Protection Agreement) para organizaciones; verificar que no existan datos personales en el historial de commits ni en variables de entorno del repositorio】 |
| Acción pendiente | B11.2: verificar DPA de GitHub para la organización; B11.2: auditar que los logs de CI no filtren datos personales de producción |

---

### E4 — Google Cloud Storage / GCS (exportación DGA)

| Aspecto | Detalle |
| --- | --- |
| Encargado | Google LLC |
| Servicio | Almacenamiento en la nube para exportación de datos DGA (reportes de clientes hacia GCS, referenciado como "exporter DGA→GCS para CCU_Central") |
| Qué dato personal podría ver | RUT del informante DGA (incluido en los reportes exportados, según el tratamiento T5 de `GOBERNANZA-DATOS.md`). Las mediciones IIoT en sí no son datos personales |
| Confirmado en el repo | Sí — `docker-compose.yml` líneas 74–78: volumen `./.secrets:/app/secrets:ro` para service account JSON de GCS; variable `DGA_GCS_KEY_FILE` en el entorno del main-api. `main-api/scripts/verify-gcs-export.ts` confirma la integración |
| Ubicación / transferencia internacional | Google Cloud Storage en EE.UU. o región configurada 【PENDIENTE VERIFICAR: confirmar bucket region en la configuración del servicio account / GCS de Emeltec】 |
| DPA disponible | Google Cloud ofrece Data Processing Agreement estándar (Cloud DPA) incluido en sus Condiciones de Servicio para Google Cloud |
| Estado del contrato | 【PENDIENTE VERIFICAR: confirmar si se ha revisado el Google Cloud DPA para la cuenta de Emeltec; confirmar si el RUT del informante viaja en los archivos exportados a GCS y cuáles son los controles de acceso al bucket】 |
| Acción pendiente | B11.2: verificar Google Cloud DPA; confirmar contenido exacto de los archivos exportados y si incluyen datos personales; verificar controles de acceso al bucket GCS |

---

## 4. Encargados descartados o con aclaración de rol

### Buk (RRHH)

Buk es encargado de tratamiento de los datos de RRHH de los **empleados de
Emeltec** (legajos, liquidaciones, asistencia), no de los datos de usuarios
de la plataforma SaaS. Aplica al tratamiento T7 de `GOBERNANZA-DATOS.md`. Su
DPA es prioritario por el manejo de datos sensibles de salud (licencias
médicas). Se documenta en `GOBERNANZA-DATOS.md` §4 T6 y T7, y su revisión
corresponde a B11.2. No aparece en este inventario porque los datos que trata
son de empleados de Emeltec, no de titulares del servicio SaaS.

### Disofi / Softland (ERP)

Disofi actúa como encargado de tratamiento de los datos comerciales de
Emeltec (contactos de clientes/proveedores, facturación). Aplica al
tratamiento T8 de `GOBERNANZA-DATOS.md`. No es encargado de los datos de
usuarios de la plataforma SaaS. Documentado en `GOBERNANZA-DATOS.md` §4 T6
y T8. Su revisión corresponde a B11.2.

### ACHS

La Asociación Chilena de Seguridad actúa como **responsable independiente**
en virtud de la Ley 16.744 (seguro de accidentes laborales), no como
encargado de Emeltec. Queda fuera de este inventario.

### TimescaleDB / Redis

Son componentes de infraestructura de base de datos y caché que se ejecutan
en la VM propia de Emeltec (Docker compose). No son terceros; no corresponden
a encargados de tratamiento.

---

## 5. Resumen ejecutivo de estado

| Encargado | Datos personales que ve | DPA verificado | Transferencia internacional | Prioridad B11.2 |
| --- | --- | --- | --- | --- |
| Microsoft Azure | Todos los datos alojados en la VM (BD, logs) | 【PENDIENTE】 | 【PENDIENTE confirmar región】 | Alta |
| Resend | Email del destinatario, asunto/cuerpo (OTP) | 【PENDIENTE】 | Sí (AWS, EE.UU.) | Alta |
| GitHub / GHCR | Logs CI (bajo riesgo) | 【PENDIENTE】 | Sí (EE.UU.) | Media |
| Google Cloud Storage | RUT informante en archivos DGA exportados | 【PENDIENTE】 | 【PENDIENTE confirmar región bucket】 | Media |

---

## 6. Mantenimiento de este documento

- Dueño: delegado de protección de datos (D. Ruiz, `datos@emeltec.cl`).
- Revisión: al incorporar un nuevo proveedor con acceso a datos personales,
  antes de contratar el servicio (Art. 14 quáter — protección desde el diseño).
- Revisión periódica: trimestral junto con B12.2 (monitoreo de instrucciones
  de la Agencia).
- Cuando la Agencia publique contratos modelo para encargados (Art. 15 bis),
  revisar que los DPAs vigentes sean equivalentes o superados por el modelo.

| Campo | Valor |
| --- | --- |
| Versión | 1.0 |
| Fecha de elaboración | 16-07-2026 |
| Elaborado por | D. Ruiz — DPO designado |
| Fuentes de verificación | `main-api/src/services/emailService.js`, `docker-compose.yml`, `.github/workflows/build-publish.yml`, `.github/workflows/deploy-production.yml` |
| Tareas dependientes | B11.2 (cierre de DPAs), B11.3 (acuerdos confidencialidad personal) |
