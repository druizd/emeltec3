# Política de Retención de Datos Personales — Emeltec Cloud

> Cubre la tarea **B5.1** (definición de plazos de retención) de
> `PLAN-MEJORAS.md`. Base legal: Art. 14 quáter (principio de minimización y
> proporcionalidad) y Art. 14 quinquies, Ley 19.628 modificada por Ley 21.719
> (vigencia 01-12-2026).
>
> Los plazos indicados en este documento han sido **definidos por gerencia** y
> son vinculantes para la implementación técnica.
>
> ⚠️ Documento interno de trabajo. No es asesoría legal.
> Tareas relacionadas pero fuera del alcance de este documento:
> - Implementación técnica del job de anonimización periódica → **B5.2**
> - Publicación de plazos en `/privacidad` → **B5.3 / B8**

---

## 1. Principios que rigen la retención

### 1.1 Minimización y proporcionalidad (Art. 14 quáter)

Los datos personales deben conservarse en forma identificable únicamente
durante el tiempo estrictamente necesario para la finalidad que justifica
su tratamiento. Superado ese plazo, deben ser anonimizados o suprimidos.
La conservación indefinida de datos personales infringe el principio de
proporcionalidad.

### 1.2 Anonimización versus supresión

**Anonimización**: eliminación irreversible de los identificadores que permiten
vincular el registro con una persona natural. El registro resultante deja de
ser dato personal y puede conservarse indefinidamente. Para el audit log,
esto implica sustituir IP y correo electrónico del actor por un valor
constante (`[ANONIMIZADO]`). Un hash simple del correo **no** constituye
anonimización: el espacio de correos es enumerable y el hash se revierte por
ataque de diccionario (seguiría siendo dato personal seudonimizado). Si la
investigación forense exige correlacionar acciones de un mismo actor ya
anonimizado, usar HMAC con llave efímera destruida al cierre del período de
retención.

**Supresión**: eliminación completa del registro de los sistemas de
producción, copias de seguridad incluidas (en el ciclo de rotación de
backups). Aplica cuando no existe interés legítimo residual en conservar el
registro anonimizado.

### 1.3 Carga de la prueba invertida (Art. 14 quinquies)

Esta política y su implementación técnica son la evidencia de cumplimiento
ante la Agencia de Protección de Datos. Una medida de retención no
documentada, con fecha anterior al incidente o fiscalización que la requiera,
legalmente no existe.

---

## 2. Tabla de retención por categoría de dato

La tabla cruza con los tratamientos T1–T6 del registro de actividades de
`GOBERNANZA-DATOS.md`.

| Categoría de dato | Tratamiento | Plazo identificable | Acción al vencer | Base legal de la retención |
| --- | --- | --- | --- | --- |
| **Audit log — acciones generales** (logins, navegación, consultas) | T3 | 12 meses | Anonimizar IP y email del actor; conservar acción + timestamp + rol | Interés legítimo (seguridad, detección de accesos no autorizados) + obligación de medidas (Art. 14 quinquies) |
| **Audit log — acciones sobre datos reportados a la DGA** (updateSite, cambios de variable map, operaciones DGA) | T3 | 36 meses | Anonimizar IP y email del actor; conservar acción + timestamp + rol | Interés legítimo (defensa frente a reclamaciones en ventana de revisión DGA de 3 años — ver nota 1) |
| **Cuentas de usuario activas** | T1 | Vigencia de la cuenta | Sin acción mientras la cuenta esté activa | Ejecución de contrato (servicio SaaS B2B) |
| **Cuentas de usuario inactivas** (sin acceso) | T1 | 24 meses desde último inicio de sesión, previo aviso por correo al titular | Anonimizar email, RUT y teléfono; conservar ID y rol para integridad referencial del audit log | Ejecución de contrato (proporcionalidad: la relación se entiende extinguida tras 24 meses de inactividad) |
| **Contactos operacionales de alertas** | T2 | Mientras el cliente los mantenga activos; revisar en baja de cliente | Suprimir al dar de baja al cliente o al retirarse el contacto | Ejecución de contrato / interés legítimo del cliente |
| **Credenciales DGA del informante** | T4 | Vigencia del servicio de reporte DGA del sitio | Suprimir al término del servicio del sitio | Obligación legal (normativa DGA) + contrato |
| **Mediciones IIoT** (caudales, niveles, variables eléctricas, proceso) | — | Indefinida | Sin acción | Fuera del ámbito de la ley (ver nota 2) |
| **Solicitudes ARCO+ y registros de respuesta** | — | 5 años desde la solicitud | Suprimir | Interés legítimo (prueba de cumplimiento de plazos legales) — **PENDIENTE CONFIRMAR: plazo propuesto por DPO, requiere validación con asesor legal o criterio de la Agencia** |

---

## 3. Notas de fundamento

### Nota 1 — Audit log DGA: justificación del plazo de 36 meses

Los datos reportados por el cliente a la Dirección General de Aguas quedan
sujetos a revisión regulatoria por un período de 3 años.
【Pendiente: verificar cita exacta de la norma DGA/MEE antes de publicar
este fundamento externamente.】

Si un tercero manipulara sensores o configuración en terreno para transmitir
datos falsos a la DGA, el impacto (multas al cliente por parte de la DGA)
puede aflorar durante toda esa ventana. Para investigar y atribuir
responsabilidad se requiere el rastro identificable de quién modificó
configuración de sitios, mapeos de variables o envíos DGA. Por eso las
acciones del audit log que afectan datos reportables retienen el actor
identificable 36 meses (alineado a la ventana de revisión DGA), mientras que
los registros de navegación y consultas se anonimizan a los 12 meses.

**Base legal**: interés legítimo (seguridad y defensa frente a reclamaciones)
+ proporcionalidad: el plazo extendido aplica exclusivamente al subconjunto de
acciones que lo justifican.

### Nota 2 — Mediciones IIoT: fuera del ámbito de la ley

Las mediciones de variables industriales (caudales, niveles freáticos,
temperaturas, consumo eléctrico, presiones y otras variables de proceso)
son datos de instalaciones, no de personas. No permiten identificar a una
persona natural por sí mismos ni en combinación con otra información disponible
en la plataforma. Por tanto, no son datos personales en los términos del
Art. 2° de la Ley 19.628, y quedan fuera del ámbito de aplicación de la
política de retención de datos personales. Pueden conservarse indefinidamente
para los fines operacionales, estadísticos y regulatorios del servicio.

Esta determinación debe revisarse si en el futuro se incorporan a las
mediciones IIoT atributos que permitan vincularlas con personas naturales
identificables (por ejemplo, nombre del operador que tomó una lectura manual,
o geolocalización de un técnico de terreno).

### Nota 3 — Plazo de solicitudes ARCO+: propuesta pendiente de confirmación

El plazo propuesto de 5 años para conservar registros de solicitudes ARCO+ y
sus respuestas se basa en el interés legítimo de Emeltec de acreditar el
cumplimiento de los plazos y procedimientos legales ante eventuales reclamos
ante la Agencia o acciones judiciales. Este plazo es una propuesta del DPO
y **está pendiente de confirmación** por asesor legal externo o criterio
orientador de la Agencia de Protección de Datos Personales.

---

## 4. Procedimientos de ejecución

### 4.1 Anonimización periódica del audit log

Un proceso automatizado ejecutará mensualmente la anonimización del audit log
conforme a los plazos de la Sección 2. La implementación técnica (job,
consulta SQL, prueba de irreversibilidad) corresponde a la tarea **B5.2** de
`PLAN-MEJORAS.md` y está fuera del alcance de este documento.

Condiciones de ejecución:
- La anonimización aplica al campo IP y al campo email/identificador del
  actor de cada entrada del log que haya superado el plazo correspondiente.
- Los campos acción, timestamp y rol se conservan intactos.
- **Legal hold**: si un registro está vinculado a un incidente o disputa
  documentada en el registro de vulneraciones (`RESPUESTA-BRECHAS.md` §4),
  se retiene identificable hasta el cierre formal del caso. El DPO documenta
  cada legal hold activo.
- El job registra en log de operación las fechas de ejecución y el número de
  registros procesados, como evidencia de cumplimiento.

### 4.2 Aviso previo a anonimización de cuentas inactivas

Antes de anonimizar una cuenta inactiva, la plataforma enviará un correo de
aviso al titular (al correo electrónico registrado en la cuenta) con un plazo
mínimo de **30 días** para que reactive su sesión o solicite la conservación
de sus datos. Si no hay reactivación ni respuesta, se procede con la
anonimización al vencer el aviso.

El aviso debe incluir:
- Qué datos serán anonimizados y cuándo.
- Cómo reactivar la cuenta para detener el proceso.
- Cómo ejercer el derecho de acceso o portabilidad antes de la anonimización.
- Datos de contacto del DPO.

### 4.3 Baja de clientes

Al dar de baja a un cliente de la plataforma:
- Los contactos operacionales de alertas (T2) se suprimen.
- Los usuarios del cliente quedan en estado de "cuenta inactiva" y pasan al
  plazo de 24 meses de la Sección 2, con el aviso correspondiente.
- Las credenciales DGA del informante (T4) se suprimen al término del servicio
  del sitio.
- El audit log asociado al cliente se conserva y anonimiza conforme a los
  plazos generales de T3.

---

## 5. Publicación y transparencia

Los plazos de retención resumidos deben ser incluidos en la página pública
`/privacidad` de la plataforma, conforme a la tarea B5.3 / B8 de
`PLAN-MEJORAS.md`, para cumplir el deber de información al titular
(Art. 14 ter b).

---

## 6. Mantenimiento de este documento

- Dueño: delegado de protección de datos (D. Ruiz, `datos@emeltec.cl`).
- Revisión: anual o ante cambios en los tratamientos de datos personales,
  nuevos criterios de la Agencia, o cambios regulatorios que afecten los
  plazos de conservación.
- Cambios de plazo deben ser documentados con fecha y justificación antes de
  modificar la configuración del job de anonimización.

| Campo | Valor |
| --- | --- |
| Versión | 1.0 |
| Fecha de elaboración | 16-07-2026 |
| Elaborado por | D. Ruiz — DPO designado |
| Próxima revisión | 16-07-2027 o ante gatillo |
| Tareas dependientes | B5.2 (implementación job), B5.3 / B8 (publicación `/privacidad`) |
