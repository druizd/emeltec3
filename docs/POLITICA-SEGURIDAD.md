# Política de Seguridad de la Información — Emeltec Cloud

> Documento **público**, exigido por el Art. 14 ter e) de la Ley 19.628
> modificada por Ley 21.719 (vigencia 01-12-2026).
> Cubre la tarea **B10.1** de `PLAN-MEJORAS.md`.
>
> Este documento describe compromisos verificables a nivel de política.
> No contiene detalles técnicos explotables (versiones de software,
> topología de red, nombres de servidores ni configuraciones específicas).
>
> Una vez aprobado, este documento se publicará enlazado desde la página
> `/privacidad` de la plataforma (tarea B8 de `PLAN-MEJORAS.md`).

---

## 1. Identificación del responsable

| Campo | Valor |
| --- | --- |
| Responsable del tratamiento | 【Razón social exacta, ej. Emeltec SpA】 |
| RUT | 【RUT empresa】 |
| Plataforma | Emeltec Cloud (`cloud.emeltec.cl`) |
| Contacto del delegado de protección de datos | `datos@emeltec.cl` |

---

## 2. Alcance

Esta política aplica a la plataforma **Emeltec Cloud** (`cloud.emeltec.cl`),
servicio SaaS de monitoreo industrial IIoT y cumplimiento regulatorio DGA,
y a todos los datos personales que Emeltec trata en el contexto de la
prestación de dicho servicio a sus clientes B2B.

Abarca los sistemas de procesamiento, almacenamiento y comunicación de datos
personales, así como al personal y terceros con acceso a dichos datos.

---

## 3. Principios rectores

La política de seguridad de Emeltec Cloud se sustenta en los cuatro
principios establecidos por el Art. 14 quinquies de la Ley 19.628:

### 3.1 Confidencialidad

Los datos personales son accesibles únicamente por el personal y los
sistemas autorizados para cada finalidad específica. Nadie accede a datos
personales fuera del alcance definido por su rol. El deber de secreto sobre
los datos tratados subsiste tras el término de la relación laboral o
contractual (Art. 14 bis).

### 3.2 Integridad

Los datos personales se mantienen exactos y completos. Se aplican controles
para prevenir su alteración no autorizada durante el procesamiento, el
almacenamiento y la transmisión.

### 3.3 Disponibilidad

Los sistemas que soportan el tratamiento de datos personales se gestionan
para garantizar la continuidad del servicio. Se mantienen capacidades de
respaldo y restauración de datos que permiten la recuperación ante
incidentes físicos o técnicos (Art. 14 quinquies c).

### 3.4 Resiliencia

Los sistemas se diseñan y operan para resistir y recuperarse de incidentes.
Se evalúan periódicamente los riesgos y se revisan las medidas de seguridad
adoptadas para verificar su eficacia (Art. 14 quinquies d).

---

## 4. Medidas de seguridad adoptadas

Las medidas descritas a continuación se declaran a nivel general de política.
Los detalles de implementación son confidenciales por razones de seguridad.

### 4.1 Cifrado en tránsito

Todas las comunicaciones entre los clientes y la plataforma se realizan
mediante protocolos de cifrado estándar de la industria. Los datos personales
no viajan en texto claro por redes públicas.

### 4.2 Control de acceso por rol

El acceso a datos personales y funciones de la plataforma está segmentado por
roles (SuperAdmin, Admin, Gerente, Cliente, Vendedor). Cada usuario accede
únicamente a los datos y funciones correspondientes a su rol asignado.
Los accesos se revisan periódicamente.

### 4.3 Autenticación reforzada

La plataforma exige autenticación de dos factores (2FA) para el acceso y para
acciones sensibles (gestión de usuarios, operaciones críticas). El segundo
factor se entrega mediante código de un solo uso enviado al correo electrónico
registrado del usuario, con tiempo de expiración y límite de intentos.

### 4.4 Registro de auditoría

Las acciones relevantes sobre datos personales (creaciones, modificaciones,
eliminaciones, accesos sensibles) quedan registradas con identificador del
actor, acción, fecha/hora y dirección IP. Este registro se utiliza para la
detección de accesos no autorizados y para la investigación de incidentes.
Los datos del registro se conservan conforme a la política de retención
documentada en `RETENCION-DATOS.md`.

### 4.5 Minimización de datos en el cliente

La plataforma aplica el principio de minimización de datos por defecto
(Art. 14 quáter): el cliente web retiene únicamente los datos estrictamente
necesarios para el funcionamiento de la interfaz, sin almacenar datos
personales adicionales en el navegador del usuario.

### 4.6 Protección desde el diseño

Las nuevas funciones y cambios que involucren datos personales se evalúan
antes de su implementación para incorporar medidas de protección desde el
diseño (Art. 14 quáter). Los cambios de tratamiento se documentan antes de
ser llevados a producción.

### 4.7 Gestión de encargados de tratamiento

Los terceros que tratan datos personales por cuenta de Emeltec (proveedores
de infraestructura, servicios de comunicación) son identificados y evaluados.
Se exige que adopten medidas de seguridad equivalentes a las de esta política
y que notifiquen cualquier incidente de seguridad a Emeltec de forma
inmediata (Art. 15 bis).

### 4.8 Revisión periódica de eficacia

Emeltec establece un calendario de revisión periódica de sus medidas de
seguridad, que incluye revisión interna de accesos y configuraciones,
revisión de dependencias de software, y evaluación de nuevos riesgos
(Art. 14 quinquies d). Los resultados de cada revisión quedan documentados.

---

## 5. Gestión de incidentes y brechas de seguridad

### 5.1 Procedimiento de respuesta

Emeltec cuenta con un procedimiento escrito de respuesta a incidentes de
seguridad (detalle en documento interno `RESPUESTA-BRECHAS.md`). El
procedimiento cubre la detección, contención, evaluación, notificación y
análisis post-incidente.

### 5.2 Notificación a la Agencia

Cuando un incidente de seguridad genere riesgo razonable para los derechos y
libertades de los titulares, Emeltec notificará a la Agencia de Protección de
Datos Personales sin dilaciones indebidas y por los medios más expeditos
disponibles, conforme al Art. 14 sexies de la Ley 19.628.

### 5.3 Registro interno de vulneraciones

Todo incidente de seguridad que involucre datos personales, independientemente
de si se notifica a la Agencia, queda registrado en el registro interno de
vulneraciones (Art. 14 sexies inc. 2°), con descripción de la naturaleza del
incidente, datos y titulares afectados, efectos y medidas adoptadas.

### 5.4 Notificación a titulares

Cuando el incidente afecte datos sensibles, datos de menores de 14 años o
datos económicos/financieros/bancarios/comerciales, Emeltec notificará a los
titulares afectados en lenguaje claro, conforme al Art. 14 sexies.

---

## 6. Responsabilidades

| Rol | Responsabilidad principal |
| --- | --- |
| Delegado de protección de datos (DPO) | Punto de contacto para titulares y para la Agencia; supervisión de esta política; gestión de solicitudes ARCO+; decisión de notificación de brechas |
| Responsable técnico | Implementación y mantenimiento de las medidas de seguridad; respuesta técnica ante incidentes |
| Personal y contratistas | Cumplimiento de las reglas de uso interno de datos (deber de secreto, Art. 14 bis); reporte inmediato de incidentes detectados |

---

## 7. Revisión de esta política

Esta política es revisada al menos anualmente o cuando ocurra alguno de los
siguientes eventos:

- Cambio significativo en los tratamientos de datos personales realizados.
- Publicación de instrucciones generales de la Agencia de Protección de Datos
  (Art. 14 septies) que afecten los estándares aplicables.
- Incidente de seguridad que revele deficiencias en las medidas declaradas.
- Incorporación de nuevos encargados de tratamiento con acceso a datos
  personales.

La versión vigente de esta política se mantiene disponible en la plataforma
y en la página `/privacidad`.

---

## 8. Contacto

Para consultas sobre esta política, para ejercer derechos ARCO+ (acceso,
rectificación, cancelación/supresión, oposición, portabilidad y bloqueo)
o para reportar un incidente de seguridad relacionado con datos personales,
puede contactar al delegado de protección de datos en:

**Correo**: `datos@emeltec.cl` — 【PENDIENTE: confirmar creación del grupo】

También puede dirigir consultas o reclamaciones a la **Agencia de Protección
de Datos Personales**, autoridad competente en materia de protección de datos
en Chile (vigente desde el 01-12-2026).

---

## 9. Vigencia

Esta política entra en vigor el 【fecha de aprobación】 y reemplaza cualquier
versión anterior. El responsable del tratamiento y su representante legal
aprueban este documento.

| Campo | Valor |
| --- | --- |
| Versión | 1.0 |
| Fecha de elaboración | 16-07-2026 |
| Elaborado por | D. Ruiz — DPO designado |
| Fecha de aprobación | 【dd-mm-aaaa】 |
| Aprobado por | 【Representante legal / Gerencia】 |
| Próxima revisión | 【dd-mm-aaaa】 (máx. 12 meses desde aprobación) |
