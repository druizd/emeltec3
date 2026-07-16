# Gobernanza de Datos Personales — Emeltec Cloud

> Documento interno de trabajo. Cubre las tareas **B6** (registro de
> actividades de tratamiento), **B8.1** (identificación del responsable) y
> **B9.1** (delegado de protección de datos) de `PLAN-MEJORAS.md`.
> Base legal: Ley 19.628 modificada por Ley 21.719 (vigencia 01-12-2026).
> Referencia técnica: `LEY-21719-SEGURIDAD.md`.
>
> ⚠️ Borrador operativo, NO asesoría legal. Antes de publicar extractos en
> `/privacidad`, validar con abogado/a. Los campos `【…】` deben completarse.

---

## 1. Responsable del tratamiento

La ley radica la responsabilidad en la **persona jurídica**, no en un
empleado. El "responsable" es la empresa; las personas designadas abajo
ejecutan, pero la multa le llega a la empresa.

| Campo | Valor |
| --- | --- |
| Responsable del tratamiento | 【Razón social exacta, ej. Emeltec SpA】 |
| RUT | 【RUT empresa】 |
| Domicilio | 【Dirección】 |
| Representante legal | 【Nombre】 |
| Correo de contacto para titulares (ARCO+) | `datos@emeltec.cl` — 【PENDIENTE: crear grupo; solicitado a Cristian Salas】 |
| Plataforma | Emeltec Cloud (`cloud.emeltec.cl`) |

Este bloque alimenta directamente B8.1 (página `/privacidad`).

## 2. Roles internos

### 2.1 Delegado de protección de datos (DPO) — recomendado, no obligatorio

Para un SaaS que procesa datos regulados (DGA) conviene designarlo: es
evidencia de diligencia (Art. 14 quinquies, carga de prueba invertida) y
atenuante ante la Agencia.

| Campo | Valor |
| --- | --- |
| Delegado/a designado/a | 【Nombre legal completo】 Ruiz — Desarrollador de Sistemas, Emeltec (`druiz@emeltec.cl`) |
| Suplente | 【Nombre】 |
| Fecha de designación | 【dd-mm-aaaa】 |

**Formalización**: la ley no exige forma específica. Sirve CUALQUIER
constancia escrita, fechada y verificable, emitida por quien tenga poder de
administración (representante legal/gerencia): un correo dirigido al
delegado, un acta breve firmada, o la aprobación escrita de este documento.
Lo único que NO sirve es la auto-designación sin respaldo de la
administración — debilita el valor probatorio. Guardar la constancia junto
a este documento.

**Formalización de la designación**: acta breve **firmada en físico y
archivada** (modelo listo en el **Anexo A**). Igual de válido que un correo
del representante legal; la firma física ante gerencia es incluso más
sólida como evidencia. Guardar el original archivado y un escaneo junto a
este documento.

### ¿Qué es la "carga de la prueba invertida"? (explicación para gerencia)

En un juicio normal, **quien acusa debe probar**. Si alguien dice "Emeltec
no protegía los datos", en el mundo normal esa persona tendría que
demostrarlo.

El Art. 14 quinquies (inciso final) de la ley **invierte esa regla** para
los incidentes de seguridad. Texto legal: *"Ante la ocurrencia de un
incidente de seguridad, y en caso de controversia judicial o
administrativa, **corresponderá al responsable acreditar** la existencia y
el funcionamiento de las medidas de seguridad adoptadas"*.

Traducción: si mañana hay una filtración y la Agencia fiscaliza (o un
titular demanda), **no es la Agencia la que debe probar que Emeltec lo hizo
mal — es Emeltec la que debe probar que lo hizo bien**, con documentos
fechados ANTERIORES al incidente.

Consecuencia práctica, y la razón de ser de todos estos papeles: **la
medida que no está documentada con fecha, legalmente no existe**.

| Sin papel | Con papel |
| --- | --- |
| "Teníamos a alguien a cargo" (dicho en la audiencia) | Acta de designación firmada el 【fecha】 |
| "Sabíamos qué datos tratamos" | Registro de tratamientos §4, versionado en git |
| "Teníamos un plan para brechas" | `RESPUESTA-BRECHAS.md` + acta del simulacro anual |
| "Borrábamos lo que no se usa" | Política de retención con plazos y justificación (§4 T3) |

Multa por infringir el 14 quinquies: **grave, hasta 10.000 UTM** — y el
agravante del Art. 36 c) aplica si se puso en riesgo a los titulares.

**Funciones mínimas del delegado:**

1. Punto de contacto para titulares (casilla ARCO+) y para la Agencia.
2. Responder solicitudes ARCO+ dentro de **30 días** y registrar cada una
   (tarea B3.4).
3. Mantener actualizado este documento y el registro de tratamientos (§4).
4. Decidir/escalar la notificación de brechas (procedimiento en
   `RESPUESTA-BRECHAS.md`; es quien "decide" en ese flujo).
5. Revisar trimestralmente instrucciones de la Agencia (tarea B12.2).
6. Mantener el registro interno de vulneraciones (Art. 14 sexies inc. 2°).

**Funciones diferenciadoras** (no exigidas por la ley — posicionan a Emeltec
frente a clientes B2B que pronto van a exigir esto a sus proveedores):

1. **Responder ARCO+ en ≤10 días hábiles** como estándar interno (la ley da
   30) — argumento de venta verificable con el registro de solicitudes.
2. **Página de confianza** pública (`/privacidad` + política de seguridad
   B10.1 + estado de cumplimiento): un cliente que audita proveedores
   encuentra todo publicado en vez de pedirlo por correo.
3. **Revisión anual de accesos**: auditar quién tiene qué rol en la
   plataforma y dar de baja accesos huérfanos; dejar constancia.
4. **Cláusula de privacidad en propuestas comerciales**: párrafo estándar
   describiendo el tratamiento (sale de §4) — se anticipa a la due diligence
   del cliente.
5. **Simulacro anual de brecha** (tabletop de 1 hora con el procedimiento de
   `RESPUESTA-BRECHAS.md`): convierte el papel en músculo y es evidencia de
   "verificación de eficacia" (14 quinquies d).
6. Evaluar a futuro la **certificación del modelo de prevención** (B9.2):
   sello ante la Agencia + atenuante formal de responsabilidad.

### 2.2 Encargado de prevención (solo si se adopta el modelo B9.2)

El modelo de prevención de infracciones (D.S. 662/2025) exige un encargado
con autonomía y reporte a la administración. Decisión pendiente en B9.2.
Si se adopta, puede recaer en la misma persona del DPO si el tamaño de la
empresa lo justifica.

### 2.3 Matriz de decisión ante brecha (resumen; procedimiento completo en `RESPUESTA-BRECHAS.md`)

| Paso | Quién | Plazo |
| --- | --- | --- |
| Detecta (alerta, reporte de cliente, aviso de encargado como Resend/Azure) | Cualquiera del equipo → avisa al delegado por el canal más rápido | Inmediato |
| Contiene (revocar tokens, aislar, cortar acceso) | Responsable técnico de turno, sin esperar aprobación | Inmediato |
| Evalúa riesgo para titulares y clasifica | Delegado + responsable técnico | ≤24 h desde detección |
| Decide notificar a la Agencia | Delegado con el representante legal | "Sin dilaciones indebidas" — estándar interno: ≤72 h |
| Ejecuta notificación y registro interno | Delegado | Junto a la decisión |
| Post-mortem y medidas correctivas | Delegado + equipo técnico | ≤10 días hábiles |

### 2.4 ¿Emeltec es PYME para efectos de la ley?

El Art. 14 septies diferencia los estándares mínimos por las categorías de
la **Ley 20.416**, que clasifica por **ventas anuales**, no por headcount:
micro ≤ 2.400 UF, pequeña ≤ 25.000 UF, mediana ≤ 100.000 UF. Tener menos de
50 personas sugiere "pequeña" por el criterio laboral (Art. 505 bis del
Código del Trabajo), pero el que manda aquí es el de ventas.

- [ ] Confirmar con contabilidad las ventas anuales (UF) y registrar la
      categoría aquí: 【micro / pequeña / mediana】.

## 3. Reglas de uso interno de datos de usuarios

Reglas operativas para el equipo Emeltec. Vulnerar el deber de secreto es
infracción **grave** (10.000 UTM); sobre datos sensibles, **gravísima**.

1. **Mínimo privilegio**: el acceso a datos personales sigue los roles de la
   plataforma (SuperAdmin / Admin / Gerente / Cliente / Vendedor, guards por
   rol ya implementados). Nadie pide ni comparte credenciales.
2. **Deber de secreto** (Art. 14 bis): todo empleado/contratista con acceso a
   datos de usuarios firma acuerdo de confidencialidad (tarea B11.3). El
   deber subsiste después de terminar el contrato.
3. **View-as (suplantación SuperAdmin)**: solo para soporte/diagnóstico;
   queda en audit log; prohibido usarlo para consultar datos personales sin
   ticket/solicitud que lo justifique.
4. **Exportaciones**: prohibido extraer datos personales de la plataforma
   (planillas, capturas, dumps) salvo solicitud ARCO+ o requerimiento legal,
   siempre vía delegado.
5. **Credenciales DGA de informantes**: solo backend, cifradas en reposo
   (tareas B2.4/B10.2); nunca en cliente, logs ni mensajería interna.
6. **Datos en desarrollo**: prohibido copiar datos personales productivos a
   entornos de desarrollo/pruebas; usar datos sintéticos.
7. **Comunicaciones**: no enviar datos personales de usuarios por canales no
   corporativos (WhatsApp personal, correos personales).

### 3.1 Estado actual del SaaS vs cada regla — plan de acción

| # | Regla | Estado hoy | Acción | Tarea |
| --- | --- | --- | --- | --- |
| 1 | Mínimo privilegio | ✅ roles + guards implementados | Revisión anual de accesos (función diferenciadora 3) | — |
| 2 | Deber de secreto | ⚠️ Sin NDAs formales verificados | Firmar acuerdos de confidencialidad con equipo/contratistas | B11.3 |
| 3 | View-as auditado | ✅ audit log registra; ⚠️ sin regla escrita de uso | Este documento la formaliza; comunicarla al equipo | — |
| 4 | Sin exportaciones | ⚠️ Sin control técnico; depende de disciplina | Alerta sobre audit log ante exportaciones masivas | B4.2 |
| 5 | Credenciales DGA solo backend | ⚠️ Verificar cifrado en reposo + TODO en `dga-generar-reporte-modal.ts` | Cerrar verificación | B2.4, B10.2 |
| 6 | Sin datos productivos en dev | ⚠️ Sin verificación formal | Revisar seeds/fixtures; documentar | nueva |
| 7 | Canales corporativos | ⚠️ Regla nueva | Comunicar al equipo junto con la 3 | — |

**Cierre del plan**: comunicar estas reglas al equipo por escrito (correo o
reunión con acta) — sin comunicación no hay cumplimiento acreditable.

## 4. Registro de actividades de tratamiento (Art. 14 ter — tarea B6)

Inventario de tratamientos con datos personales. Las mediciones IIoT
(caudales, niveles, temperaturas) **no son datos personales** y quedan fuera.

### T1 — Cuentas de usuario de la plataforma

| Aspecto | Detalle |
| --- | --- |
| Datos | Nombre, apellido, email, RUT, teléfono, cargo, rol, contraseña (hash), flags 2FA |
| Titulares | Usuarios de clientes B2B y personal Emeltec |
| Finalidad | Autenticación, autorización por rol, operación del servicio |
| Base legal | Ejecución de contrato (servicio SaaS B2B) |
| Plazo | Vigencia de la cuenta + **6 meses** tras baja → supresión/anonimización (propuesta B5.1, confirmar) |
| Destinatarios | Solo Emeltec; sin terceros ni transferencias |
| Sistemas | `auth-api` (BD usuarios), frontend (sesión) |

### T2 — Contactos operacionales de clientes

| Aspecto | Detalle |
| --- | --- |
| Datos | Nombre, cargo, email, teléfono |
| Titulares | Personal designado por el cliente para recibir alertas |
| Finalidad | Notificación de alarmas y eventos operacionales |
| Base legal | Ejecución de contrato / interés legítimo del cliente |
| Plazo | Mientras el cliente los mantenga configurados; revisar en baja de cliente |
| Destinatarios | **Resend** (envío de correo) → encargado de tratamiento, ver T6 |

### T3 — Audit log

| Aspecto | Detalle |
| --- | --- |
| Datos | IP, identificador/email del actor, acción, timestamp |
| Titulares | Usuarios de la plataforma |
| Finalidad | Seguridad, trazabilidad, detección de accesos no autorizados |
| Base legal | Interés legítimo (seguridad) / obligación de medidas del 14 quinquies |
| Plazo | **Retención diferenciada por tipo de acción** (ver justificación abajo). General: **12 meses** identificable → anonimizar. Acciones que afectan la integridad de datos reportados a la DGA: **36 meses**. La fila nunca se borra: acción + timestamp + rol se conservan; solo caen IP y email. **Legal hold**: si un registro está vinculado a incidente o disputa en curso, se retiene identificable hasta el cierre (documentado por el delegado). Propuesta B5.1, confirmar. |

**Justificación del plazo de 36 meses (documentada aquí a propósito — esto
es lo que se muestra ante fiscalización):** los registros que el cliente
reporta a la DGA quedan sujetos a revisión por un período de
**3 años** 【verificar cita exacta de la norma DGA/MEE antes de publicar】.
Si un tercero manipulara sensores o configuración en terreno para
transmitir datos falsos, el impacto (multas al cliente por parte de la DGA)
puede aflorar durante toda esa ventana. Para investigar y atribuir
responsabilidad se necesita el rastro identificable de **quién** modificó
configuración de sitios, mapeos de variables o envíos DGA. Por eso las
acciones del audit log que afectan datos reportables (updateSite, cambios
de variable map, operaciones DGA) retienen actor identificable **36 meses
— alineado a la ventana de revisión de la DGA**, mientras el resto
(logins, navegación, consultas) se anonimiza a los **12**. Base legal:
interés legítimo (seguridad y defensa frente a reclamaciones) +
proporcionalidad: el plazo largo aplica SOLO al subconjunto que lo
necesita.
| Destinatarios | Solo Emeltec |

### T4 — Credenciales DGA del informante

| Aspecto | Detalle |
| --- | --- |
| Datos | RUT y contraseña del informante ante DGA |
| Titulares | Informante designado por el cliente |
| Finalidad | Envío obligatorio de mediciones a la DGA (MEE) |
| Base legal | Obligación legal (normativa DGA) + contrato |
| Plazo | Vigencia del servicio de reporte DGA del sitio |
| Medidas | Cifradas en reposo, solo backend (B2.4/B10.2) |

### T5 — Transferencia a la DGA (organismo público)

| Aspecto | Detalle |
| --- | --- |
| Datos | RUT informante + mediciones asociadas a la obra |
| Finalidad | Cumplimiento normativo del cliente ante DGA |
| Base legal | **Obligación legal** — documentada aquí (cierra la nota de B6) |
| Destinatario | Dirección General de Aguas (organismo público, Chile) |

### T6 — Encargados de tratamiento (terceros — tarea B11.1)

| Tercero | Qué dato personal ve | Estado contrato |
| --- | --- | --- |
| Microsoft Azure (VM hosting) | Todo lo alojado (BD, logs) | 【Verificar DPA estándar Microsoft — B11.2】 |
| **Resend** (correo 2FA + notificaciones) | Email del destinatario, asunto/cuerpo (código OTP) | 【Aceptar/archivar DPA de Resend (resend.com/legal/dpa); anotar subprocesadores (AWS)】 |
| GitHub (repos/CI) | No debería ver datos personales | 【Verificar que logs de CI no filtren emails/IPs】 |
| **Buk** (RRHH SaaS: asistencia, documentos informativos, **firma de liquidaciones de sueldo**) | Legajo de empleados y contenido de liquidaciones (remuneraciones); potencialmente salud (SENSIBLE). No procesa el pago — pero VER la liquidación ya es tratar el dato | 【Revisar contrato/DPA de Buk — prioridad 1 de B11.2 por datos sensibles】 |
| **Disofi** (partner que administra Softland — ERP: ventas, OC, facturación) | Contactos de clientes/proveedores; personas naturales facturadas | 【Revisar contrato con Disofi (el encargado es Disofi, no Softland). Si Disofi usa a su vez infraestructura de Softland cloud u otro tercero → **subdelegación**: requiere autorización escrita de Emeltec (Art. 15 bis)】 |

Nota: **ACHS no va en esta tabla** — no es encargado sino responsable
independiente (ver T7).

**Sobre Resend**: no hay que cambiarlo. Cualquier proveedor externo de
correo es "encargado" — la obligación es **contractual** (aceptar y archivar
su DPA), no técnica. Cambiar de proveedor no elimina la obligación; solo la
mueve. Mitigación adicional barata: que el correo del OTP contenga el mínimo
(código + expiración, sin nombre completo ni datos extra).

### T7 — Gestión de personas (RRHH) ⚠️ incluye datos sensibles

| Aspecto | Detalle |
| --- | --- |
| Datos | Identificación, contrato, asistencia, liquidaciones de sueldo, previsión; **licencias médicas y salud ocupacional (dato SENSIBLE, Art. 2° g)** |
| Titulares | Empleados y ex-empleados de Emeltec |
| Finalidad | Relación laboral, pago de remuneraciones, obligaciones previsionales y de seguridad laboral |
| Base legal | Contrato de trabajo + obligación legal (Código del Trabajo, Ley 16.744, normativa previsional) |
| Plazo | Los plazos laborales/tributarios mandan (superiores a los de esta política); ex-empleados: revisar caso a caso |
| Encargado | **Buk** — asistencia, documentos informativos y firma de liquidaciones (ve el contenido de las remuneraciones aunque no procese el pago); contrato 15 bis, ver T6 |
| Comunicación a terceros | **ACHS**: responsable independiente por mandato de la Ley 16.744 (administra el seguro de accidentes) — base legal: obligación legal. No es encargado. |
| Medidas | Acceso restringido al legajo; datos de salud NUNCA por canales abiertos (correo masivo, WhatsApp) |

### T8 — Gestión comercial (ventas, compras, facturación)

| Aspecto | Detalle |
| --- | --- |
| Datos | Nombre, cargo, email, teléfono de contactos de clientes y proveedores; RUT/dirección de clientes persona natural (dato económico si hay deuda) |
| Titulares | Personas de contacto en empresas cliente/proveedor; clientes persona natural |
| Finalidad | Gestión de la relación comercial: cotizaciones, OC, facturación, cobranza |
| Base legal | Ejecución de contrato / interés legítimo (relación comercial B2B) |
| Plazo | Vigencia de la relación + plazos tributarios para documentos; prospectos fríos: 【12 meses】 sin interacción → depurar |
| Sistemas | **Softland**, administrado por **Disofi** (encargado — ver T6), correo corporativo |

## 5. Derechos de los titulares (resumen operativo)

**ARCO+** es la sigla de los derechos que la ley da a cada persona sobre sus
datos: **A**cceso (ver qué datos tenemos de ella), **R**ectificación
(corregirlos), **C**ancelación/supresión (que los borremos), **O**posición
(que dejemos de tratarlos para cierto fin); el «+» agrega **portabilidad**
(llevárselos en formato reutilizable) y **bloqueo** (suspensión temporal del
tratamiento mientras se resuelve una solicitud). El "titular" es la persona
dueña de los datos — en nuestro caso, cada usuario de la plataforma.

| Derecho | Cómo se ejerce hoy | Pendiente |
| --- | --- | --- |
| Rectificación | Perfil editable en `/profile` | — |
| Acceso | — | B3.1 sección "Mis datos" |
| Portabilidad | — | B3.2 export JSON/CSV |
| Supresión | — | B3.3 + flujo backend B1 |
| Oposición / bloqueo | Vía casilla ARCO+ (§1) | Documentar respuesta |

Plazo de respuesta: **30 días** desde la solicitud. Toda solicitud se
registra con timestamp (B3.4).

## 6. Mantenimiento de este documento

- Dueño: delegado de protección de datos (§2.1).
- Revisión: trimestral, junto con B12.2 (instrucciones de la Agencia).
- Cambios de tratamiento (nuevo dato personal, nuevo tercero, nueva
  finalidad) → actualizar §4 ANTES de implementar (protección desde el
  diseño, Art. 14 quáter).

---

## Anexo A — Modelo de acta de designación del delegado de protección de datos

> Imprimir, completar, firmar ambas partes, archivar original físico y
> guardar escaneo junto a este documento.

```text
ACTA DE DESIGNACIÓN
DELEGADO DE PROTECCIÓN DE DATOS PERSONALES

En 【ciudad】, a 【día】 de 【mes】 de 2026.

【Razón social】, RUT 【__】, representada por don/doña 【nombre del
representante legal】, cédula de identidad N° 【__】, en su calidad de
【representante legal / gerente general】, en adelante "la Empresa",
deja constancia de lo siguiente:

PRIMERO. En el marco de la Ley N° 19.628 sobre protección de datos
personales, modificada por la Ley N° 21.719, la Empresa ha resuelto
designar un Delegado de Protección de Datos Personales.

SEGUNDO. Se designa en dicho cargo a don/doña 【nombre completo del
delegado】, cédula de identidad N° 【__】, Desarrollador de Sistemas de la
Empresa, correo de contacto datos@emeltec.cl.

TERCERO. Las funciones del Delegado son las descritas en la sección 2.1
del documento interno "Gobernanza de Datos Personales — Emeltec Cloud"
(docs/GOBERNANZA-DATOS.md), versión vigente a esta fecha, que se tiene
por parte integrante de esta acta. Entre ellas: actuar como punto de
contacto para los titulares de datos y para la Agencia de Protección de
Datos Personales, gestionar las solicitudes de derechos dentro de los
plazos legales, mantener el registro de actividades de tratamiento, y
decidir, junto al representante legal, la notificación de vulneraciones
de seguridad.

CUARTO. La Empresa otorga al Delegado autonomía para el ejercicio de
estas funciones, acceso directo a la administración y los recursos
razonables para desempeñarlas.

QUINTO. El Delegado acepta la designación y declara conocer las
obligaciones que asume, incluido el deber de secreto del Art. 14 bis.


_____________________________          _____________________________
【Representante legal】                 【Delegado】
Representante Legal                     Delegado de Protección de Datos
【Razón social】                        C.I. 【__】
```
