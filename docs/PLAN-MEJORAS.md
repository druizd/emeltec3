# Plan de Mejoras — Emeltec Cloud

> Documento de trabajo. Marcar tareas con `[x]` al completarlas.
> Origen: auditoría del frontend Angular (julio 2026) + pendientes de performance de mayo 2026.
> Tres ejes: **(A) Deuda técnica**, **(B) Cumplimiento Ley 21.719** (protección de datos personales, Chile) y **(C) Performance / infra**.

---

## Contexto general

**Proyecto**: SaaS IIoT de monitoreo industrial (agua, riles, eléctrico, proceso) + cumplimiento DGA.
**Stack**: Angular 21 (standalone + signals), Tailwind 4, backend `nuevacloud.emeltec.cl` + auth-api separada. Deploy: Docker → GHCR → Azure VM.

**Estado positivo (no tocar, mantener):**

- Auth JWT + 2FA (interceptor `X-2FA-Code`), guards por rol, view-as para SuperAdmin, auto-logout pre-expiración.
- Headers de seguridad en `nginx.conf`: HSTS, CSP, `X-Frame-Options: DENY`.
- Sin analytics de terceros, sin cookies.
- Audit log en backend (IP, actor, acción, timestamp).
- CI completo: lint, format, typecheck, build, imágenes a GHCR.
- Páginas `/privacidad` y `/terminos` ya existen.

**Datos personales que maneja la app**: email, RUT, teléfono, nombre, apellido, cargo, IP (audit log), credenciales DGA del informante.

**Archivos clave:**

| Archivo                                                           | Rol                               |
| ----------------------------------------------------------------- | --------------------------------- |
| `frontend-angular/src/app/services/auth.service.ts`               | Tokens, localStorage, sesión      |
| `frontend-angular/src/app/services/user.service.ts`               | CRUD usuarios (datos personales)  |
| `frontend-angular/src/app/services/audit-log.service.ts`          | Consulta de auditoría             |
| `frontend-angular/src/app/interceptors/auth.interceptor.ts`       | Inyección JWT                     |
| `frontend-angular/src/app/interceptors/two-factor.interceptor.ts` | Orquestación 2FA                  |
| `frontend-angular/src/app/guards/auth.guard.ts`                   | authGuard, publicGuard, roleGuard |
| `frontend-angular/src/app/pages/profile/profile.ts`               | Edición de datos del usuario      |
| `frontend-angular/nginx.conf`                                     | Headers de seguridad, CSP         |

---

## A. Deuda técnica

### A1. Descomponer componentes gigantes 🔴 prioridad alta

**Contexto**: tres componentes concentran la mayor parte de la lógica de la app. Bloqueador nº 1 de mantenibilidad: cada cambio toca archivos de miles de líneas, imposibles de testear o revisar.

| Componente                                     | Líneas |
| ---------------------------------------------- | ------ |
| `pages/ventisqueros/ventisqueros.ts`           | ~6.648 |
| `pages/companies/company-site-water-detail.ts` | ~4.997 |
| `pages/administration/administration.ts`       | ~3.306 |

Estrategia: extraer sub-componentes por tab/panel (alertas, análisis, bitácora, operación, config DGA…). Un PR por extracción, sin cambios funcionales.

- [ ] A1.1 Mapear secciones internas de `company-site-water-detail.ts` (tabs, paneles, modales) y definir plan de extracción
- [ ] A1.2 Extraer sub-componentes de `company-site-water-detail.ts` (uno por PR)
- [ ] A1.3 Mapear secciones de `ventisqueros.ts` y definir plan de extracción
- [ ] A1.4 Extraer sub-componentes de `ventisqueros.ts`
- [ ] A1.5 Mapear secciones de `administration.ts` y definir plan de extracción
- [ ] A1.6 Extraer sub-componentes de `administration.ts`

### A2. Tests de autenticación 🔴 prioridad alta

**Contexto**: cero archivos `.spec.ts` en el frontend. El CI solo testea backend. Empezar por auth: es el código más crítico y el más testeable. Meta: cubrir auth completo, no perseguir % global.

- [ ] A2.1 Configurar runner de tests frontend (vitest) e integrarlo al job de CI
- [ ] A2.2 Tests de `auth.service.ts`: login, logout, expiración de token, restauración de sesión, view-as
- [ ] A2.3 Tests de guards (`auth.guard.ts`): authGuard, publicGuard, roleGuard por rol
- [ ] A2.4 Tests de `auth.interceptor.ts`: inyección Bearer, manejo 401/403
- [ ] A2.5 Tests de `two-factor.interceptor.ts`: flujo TWOFA_REQUIRED / TWOFA_INVALID

### A3. Eliminar `any` en water-detail 🟡 prioridad media

**Contexto**: ~65 usos de `any` en `company-site-water-detail.ts` (ej. `company: any; subCompany: any; site: any`). Conviene hacerlo junto con A1.2 (extraer + tipar en el mismo paso).

- [ ] A3.1 Crear interfaces compartidas `Company`, `SubCompany`, `Site` en `shared/` o `models/`
- [ ] A3.2 Reemplazar `any` en `company-site-water-detail.ts` por las interfaces
- [ ] A3.3 Activar regla ESLint `@typescript-eslint/no-explicit-any` (warning primero, error después)

### A4. Reducir duplicación 🟡 prioridad media

**Contexto**: interfaces `ContactForm` repetidas en varios componentes; panel de alertas/reglas clonado entre vistas.

- [ ] A4.1 Unificar `ContactForm` en un tipo compartido único
- [ ] A4.2 Extraer panel de alertas/reglas a componente compartido y reutilizarlo

---

## B. Cumplimiento Ley 21.719

### Contexto legal

- **Vigencia plena: 1 de diciembre de 2026.** Crea la Agencia de Protección de Datos Personales.
- Multas: hasta 5.000 UTM (graves) y 20.000 UTM (gravísimas), + % de ingresos por reincidencia.
- Derechos del titular (ARCO+): **A**cceso, **R**ectificación, **C**ancelación/supresión, **O**posición, + **portabilidad** y **bloqueo**.
- Obligaciones del responsable: base legal por tratamiento, deber de información, medidas de seguridad, notificación de brechas a la Agencia (y a titulares si hay alto riesgo), proporcionalidad/minimización.
- Los puntos B1, B2 y B5 son los que un fiscalizador encontraría primero.

### B1. Supresión real de datos (derecho de supresión) 🔴 crítico

**Contexto**: el backend hace soft-delete (`activo = false`). La ley exige supresión efectiva cuando el titular la ejerce y no existe base legal para retener. El audit log puede conservarse **anonimizado** (base: obligación legal / interés legítimo — documentarla).

- [ ] B1.1 Diseñar flujo de supresión: qué se borra (hard-delete), qué se anonimiza (email → hash, RUT → null), qué se retiene y con qué base legal
- [ ] B1.2 Implementar endpoint de supresión/anonimización en backend
- [ ] B1.3 Anonimizar referencias al usuario en audit log al suprimir cuenta
- [ ] B1.4 Documentar el flujo (plazo legal de respuesta: 30 días)

### B2. Minimizar datos personales en localStorage 🔴 crítico

**Contexto**: `user_data` (email, RUT, teléfono) se guarda en localStorage en texto plano — legible por cualquier script (XSS = fuga). Las medidas de seguridad son obligación del responsable. Cifrar localStorage con crypto-js es teatro (la llave vive en el mismo JS); la solución correcta es **minimización**.

- [ ] B2.1 Reducir `user_data` en localStorage a lo mínimo para la UI: `{id, nombre, rol}`
- [ ] B2.2 Hidratar el resto del perfil desde `/api/users/me` al restaurar sesión
- [ ] B2.3 (Ideal, requiere backend) Migrar JWT a cookie `httpOnly` + `Secure` + `SameSite=Strict` — elimina la clase de ataque completa
- [ ] B2.4 Verificar que las credenciales DGA nunca transiten ni se guarden en el cliente (hay TODO en `dga-generar-reporte-modal.ts`); solo backend, cifradas en reposo

### B3. Canal de derechos ARCO+ en la app 🔴 crítico

**Contexto**: rectificación ya existe (perfil editable). Faltan acceso, portabilidad y supresión como funciones visibles para el titular.

- [ ] B3.1 Sección "Mis datos" en `/profile`: mostrar todo lo que se almacena del titular
- [ ] B3.2 Exportar datos propios en JSON/CSV (portabilidad)
- [ ] B3.3 Solicitud de supresión de cuenta desde el perfil, conectada al flujo B1
- [ ] B3.4 Registrar cada solicitud ARCO+ con timestamp (prueba de cumplimiento de plazos)

### B4. Procedimiento de notificación de brechas 🔴 crítico

**Contexto**: Art. 14 sexies — reportar a la Agencia "sin dilaciones indebidas" (sin plazo fijo en horas, a diferencia del RGPD) cuando haya riesgo razonable para titulares. A los titulares solo si la brecha afecta datos sensibles, menores de 14 años o datos económicos/financieros. Exige además **registro interno** de las vulneraciones. Omitir reporte: grave (10.000 UTM); omitirlo deliberadamente: gravísima (20.000 UTM). Detalle: `LEY-21719-SEGURIDAD.md`.

- [ ] B4.1 Redactar procedimiento escrito de respuesta a brechas (quién detecta, quién decide, quién notifica, plazos)
- [ ] B4.2 Alertas automáticas sobre audit log: logins anómalos, exportaciones masivas, cambios de permisos
- [ ] B4.3 Definir plantilla de notificación a la Agencia y a titulares
- [ ] B4.4 Crear registro interno de vulneraciones (naturaleza, efectos, categorías de datos, nº titulares afectados, medidas adoptadas) — obligatorio Art. 14 sexies inc. 2°

### B5. Política de retención de datos 🔴 crítico

**Contexto**: IP + email en audit log se conservan indefinidamente — infringe el principio de proporcionalidad. Las mediciones IIoT sin datos personales pueden quedarse.

- [ ] B5.1 Definir plazos de retención por tipo de dato (audit log: N meses → anonimizar; cuentas inactivas: definir)
- [ ] B5.2 Implementar job de anonimización periódica del audit log
- [ ] B5.3 Publicar plazos en `/privacidad`

### B6. Registro de actividades de tratamiento 🟡 medio

**Contexto**: documento interno (no código). Por cada tratamiento: qué datos, finalidad, base legal, plazo, destinatarios. El envío del RUT del informante a la DGA es transferencia a organismo público — base legal: obligación legal, documentarla.

- [ ] B6.1 Levantar inventario de tratamientos (usuarios, contactos operacionales, audit log, DGA)
- [ ] B6.2 Redactar registro con base legal y plazo por tratamiento

### B7. Consentimiento y deber de información 🟡 medio

**Contexto**: B2B con base contractual cubre lo esencial, pero falta prueba del deber de información al crear usuarios.

- [ ] B7.1 Aviso en creación/registro de usuario: qué datos se tratan, finalidad, base legal
- [ ] B7.2 Checkbox de aceptación de política de privacidad con timestamp persistido en backend

### B8. Actualizar página `/privacidad` 🟡 medio

**Contexto**: adecuar el texto al lenguaje de la 21.719.

- [ ] B8.1 Identificar responsable del tratamiento y datos de contacto
- [ ] B8.2 Detallar base legal por cada tratamiento
- [ ] B8.3 Incluir plazos de retención (de B5)
- [ ] B8.4 Explicar derechos ARCO+ y cómo ejercerlos en la app
- [ ] B8.5 Mencionar a la Agencia de Protección de Datos como autoridad de reclamo

### B9. Evaluar DPO / modelo de prevención de infracciones 🟢 opcional

**Contexto**: no obligatorio para todos, pero el modelo de prevención certificado ante la Agencia actúa como atenuante de responsabilidad. Para un SaaS que procesa datos regulados (DGA), vale la pena evaluarlo. Reglamento del modelo: D.S. 662/2025 Hacienda, vigente junto con la ley (01-12-2026).

- [ ] B9.1 Evaluar designación de delegado de protección de datos
- [ ] B9.2 Evaluar adopción de modelo de prevención de infracciones certificable

### B10. Medidas de seguridad del Art. 14 quinquies 🔴 crítico

**Contexto**: el artículo central de seguridad (detalle completo en `LEY-21719-SEGURIDAD.md`). Exige confidencialidad, integridad, disponibilidad y **resiliencia**; nombra seudonimización y cifrado como medidas ejemplares; exige capacidad de **restauración rápida** (backups) y **verificación periódica de eficacia**. Carga de la prueba invertida: ante incidente, el responsable debe acreditar sus medidas. Infracción grave: 10.000 UTM. Además, Art. 14 ter e) exige que la **política de seguridad sea pública**.

- [ ] B10.1 Redactar y publicar política de seguridad (Art. 14 ter e) — nivel política, sin detalles explotables; enlazar desde `/privacidad`
- [ ] B10.2 Verificar/implementar cifrado en reposo de campos sensibles en BD (credenciales DGA como mínimo)
- [ ] B10.3 Documentar y probar plan de backup/restauración de datos personales (Art. 14 quinquies c)
- [ ] B10.4 Establecer calendario de revisión periódica de seguridad documentada (Art. 14 quinquies d): auditoría interna, revisión de dependencias, pentest si presupuesto lo permite

### B11. Encargados de tratamiento — terceros (Art. 15 bis) 🟡 medio

**Contexto**: proveedores que tratan datos personales por cuenta nuestra son "encargados" y requieren contrato con contenido mínimo legal; quedan sujetos a los deberes de secreto y seguridad; reportan brechas al responsable. Candidatos: Azure (hosting), servicio de envío de correo/SMS del 2FA, GitHub si hay datos personales en logs. La Agencia publicará contratos modelo.

- [ ] B11.1 Inventariar encargados de tratamiento (qué tercero ve qué dato personal)
- [ ] B11.2 Revisar DPAs/contratos existentes (Azure ya ofrece DPA estándar — verificar cobertura) y cerrar brechas contractuales
- [ ] B11.3 Verificar acuerdos de confidencialidad con empleados/contratistas con acceso a datos (Art. 14 bis)

### B12. EIPD y seguimiento normativo 🟡 medio

**Contexto**: Art. 15 ter exige evaluación de impacto ante alto riesgo (obligatoria siempre en tratamiento masivo, perfilado con efectos jurídicos, datos sensibles sin consentimiento). Probablemente NO aplica hoy (datos IIoT no son personales; usuarios B2B volumen acotado) — pero la conclusión debe quedar **documentada**: omitir EIPD cuando corresponde es gravísima (20.000 UTM). Los estándares técnicos mínimos vendrán por **instrucción general de la Agencia** (Art. 14 septies), aún no dictada.

- [ ] B12.1 Documentar evaluación de aplicabilidad de EIPD (conclusión y fundamento)
- [ ] B12.2 Monitorear instrucciones generales de la Agencia de Protección de Datos (estándares mínimos 14 septies, contratos modelo 15 bis, lista EIPD 15 ter) — revisar trimestralmente
- [ ] B12.3 Confirmar que la plataforma no trata datos sensibles (definición amplia Art. 2° g incluye situación socioeconómica, salud, biometría) y dejar constancia

---

## C. Performance / Infra

> Origen: pendientes al cierre de la sesión de performance de mayo 2026
> (`optimizaciones-2026-05.md`, documento histórico). Vigencia verificada
> el 16-07-2026: ninguno se ha implementado aún.

### C1. Datos de Operación pozo 🟡 prioridad media

**Contexto**: el cold path de contadores daily/jornada sigue en ~1 s (query on-demand sobre caggs). La tabla de incidencias del Resumen por Período es el último mock de la vista.

- [ ] C1.1 Materializar contadores daily + jornada (worker + tablas `site_contador_diario` / `site_contador_jornada`) — cold path ~1 s → ~30 ms
- [ ] C1.2 Endpoint de incidencias por sitio (`GET /sites/:id/incidencias?desde&hasta`) y conectar `mockIncidencias` en `operacion-resumen-periodo.ts`

### C2. Entrega frontend 🟢 prioridad baja

**Contexto**: mejoras incrementales sobre la base ya optimizada en mayo (cache immutable, gzip, fuentes reducidas).

- [ ] C2.1 Brotli en nginx (hoy solo gzip; el comentario del conf menciona brotli pero no está activo) — +10-15 % de compresión
- [ ] C2.2 `<link rel="modulepreload">` de chunks críticos en `index.html`
- [ ] C2.3 Tunear split de chunks en `angular.json` (vendor split, commonChunk)
- [ ] C2.4 Evaluar SSR + Transfer State para primer paint — solo si C2.1–C2.3 no bastan; costo de mantención alto

---

## Calendario sugerido (deadline: 1-dic-2026)

| Mes          | Foco                                                                                   |
| ------------ | -------------------------------------------------------------------------------------- |
| Jul–Ago 2026 | B2 (localStorage) + B5 (retención) + B12.1/B12.3 (evaluaciones documentadas, rápidas)  |
| Ago–Sep 2026 | B1 (supresión real) + B8 (`/privacidad`) + B10.1 (política de seguridad pública)       |
| Sep–Oct 2026 | B3 (ARCO+ en perfil) + B6 (registro de tratamientos) + B10.2/B10.3 (cifrado + backups) |
| Oct–Nov 2026 | B4 (brechas + registro interno + alertas) + B7 (consentimiento) + B11 (encargados)     |
| Continuo     | A1–A4 y C1–C2 en paralelo; B12.2 (monitoreo Agencia) trimestral                        |

**Referencia legal detallada**: `docs/LEY-21719-SEGURIDAD.md` (texto literal de artículos, sanciones, mapa exigencia→acción).
