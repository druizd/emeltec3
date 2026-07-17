# Evaluación de Aplicabilidad de EIPD — Emeltec Cloud

> Cubre las tareas **B12.1** (evaluación de aplicabilidad y fundamento) y
> **B12.3** (constancia de ausencia de datos sensibles) de `PLAN-MEJORAS.md`.
> Base legal: Art. 15 ter y Art. 2° g, Ley 19.628 modificada por Ley 21.719
> (vigencia 01-12-2026).
>
> ⚠️ Documento interno de trabajo. No es asesoría legal.
> Omitir EIPD cuando corresponde: infracción **gravísima**, hasta 20.000 UTM
> (Art. 34 quáter k). La conclusión documentada aquí es la defensa de Emeltec
> ante una eventual fiscalización.

---

## 1. ¿Qué es la EIPD y cuándo es obligatoria?

La Evaluación de Impacto en la Protección de Datos (EIPD) es un análisis
previo obligatorio cuando un tratamiento de datos personales pueda generar
**alto riesgo para los derechos y libertades de los titulares**. El Art. 15
ter de la Ley 19.628 (modificada por Ley 21.719) establece los tres supuestos
que la hacen obligatoria de manera inexcusable:

| Supuesto legal                                                       | Texto del artículo                                                                                                                                                                                               |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **a)** Decisiones automatizadas con efectos jurídicos significativos | "...tratamiento [...] que incluya decisiones automatizadas respecto del titular, incluida la elaboración de perfiles, que produzcan efectos jurídicos en él o que le afecten significativamente de modo similar" |
| **b)** Tratamiento masivo o a gran escala                            | "...tratamiento a gran escala de datos personales"                                                                                                                                                               |
| **c)** Datos sensibles fuera de las excepciones al consentimiento    | "...tratamiento de datos [...] a que se refieren los artículos 9° bis y 9° ter" (datos sensibles sin hipótesis de excepción al consentimiento)                                                                   |

La Agencia de Protección de Datos publicará una lista orientativa de
operaciones que requieren EIPD (Art. 15 ter inc. 2°). A la fecha de esta
evaluación, dicha lista no ha sido dictada.

---

## 2. Análisis por supuesto

### 2.1 Supuesto a) — Decisiones automatizadas con efectos jurídicos o perfilado significativo

**Definición aplicable**: tratamientos que, mediante lógica automatizada,
tomen decisiones que produzcan efectos jurídicos sobre el titular (por
ejemplo, denegación de crédito, despido, acceso a servicios) o que afecten
de modo similar sus intereses de manera significativa de forma automática. El
perfilado que solo ordena o filtra información de uso interno, sin
consecuencias jurídicas para el titular, queda fuera de este supuesto.

**Análisis sobre Emeltec Cloud**:

La plataforma procesa mediciones IIoT (caudales, niveles, temperaturas,
variables eléctricas e industriales) provenientes de sensores y equipos de
terreno. Dichas mediciones **no son datos personales**: refieren a variables
físicas de instalaciones industriales, no a personas identificadas o
identificables. El procesamiento automatizado de estas mediciones no produce
efectos jurídicos ni consecuencias significativas sobre ningún titular de
datos personales.

Respecto de los usuarios de la plataforma (personas B2B), el sistema:

- Autentica mediante credenciales + OTP vía correo electrónico (verificación
  de identidad, no perfilado).
- Asigna roles predefinidos (SuperAdmin, Admin, Gerente, Cliente, Vendedor)
  que determinan el acceso a vistas y funciones. Esta asignación es realizada
  manualmente por un administrador de la empresa cliente; no existe lógica
  automatizada que asigne, degrade ni expulse roles basándose en el
  comportamiento del titular.
- Genera un audit log (IP, email del actor, acción, timestamp) con fines de
  seguridad y trazabilidad. Este log no alimenta ningún sistema de decisión
  automatizada sobre los titulares.

**No existe perfilado** en el sentido legal: la plataforma no construye
perfiles de comportamiento de los usuarios, no les presenta contenido
diferenciado en función de sus datos, ni toma decisiones automatizadas que
les afecten. Las alertas y notificaciones son eventos operacionales sobre
variables de proceso, ajenas a los datos personales de los titulares.

**Conclusión supuesto a): NO aplica.** La plataforma no realiza decisiones
automatizadas con efectos jurídicos ni elaboración de perfiles sobre titulares
de datos personales.

---

### 2.2 Supuesto b) — Tratamiento masivo o a gran escala

**Definición aplicable**: el legislador no fijó un umbral numérico específico.
La referencia comparada (considerando 91 del RGPD europeo, estándar habitual
de interpretación en ausencia de definición legal) distingue el tratamiento
"a gran escala" del tratamiento "incidental" considerando: número de titulares
afectados, volumen y variedad de datos tratados, duración del tratamiento, y
extensión geográfica. Tratamientos que afectan a millones de personas son el
caso paradigmático; no así plataformas B2B de nicho industrial con base de
usuarios acotada.

**Análisis sobre Emeltec Cloud**:

Los datos personales que trata la plataforma corresponden exclusivamente a:

- Usuarios internos de empresas clientes B2B (operadores, supervisores,
  personal técnico designado) que acceden a la plataforma para monitorear
  sus instalaciones industriales.
- Contactos operacionales de alertas (correo electrónico y teléfono de
  personas designadas por el cliente para recibir notificaciones).
- Personal de Emeltec con acceso a la plataforma.

El universo total de titulares es **acotado y determinable**: corresponde al
personal designado por empresas industriales en el segmento IIoT nacional. No
se trata de una plataforma de consumo masivo, red social, servicio de salud ni
proveedor de infraestructura crítica con millones de usuarios. El volumen de
datos personales procesados es reducido (identificadores de contacto,
credenciales, roles), sin variedad de categorías sensibles y sin extensión
geográfica relevante.

**Conclusión supuesto b): NO aplica.** El volumen de titulares de datos
personales es reducido y acotado al segmento B2B industrial; el tratamiento no
alcanza la escala que la norma busca cubrir con la obligación de EIPD.

---

### 2.3 Supuesto c) — Datos sensibles sin hipótesis de excepción al consentimiento

**Definición aplicable (Art. 2° g)**: la ley define datos sensibles en sentido
amplio. La categoría incluye, entre otros: origen racial o étnico, opiniones
políticas, convicciones religiosas o filosóficas, afiliación sindical, datos
genéticos, datos biométricos destinados a identificar de manera unívoca a una
persona física, datos relativos a la salud, vida u orientación sexual,
situación socioeconómica, e información sobre condenas y delitos.

Este supuesto obliga a la EIPD cuando se tratan datos sensibles bajo las
hipótesis de excepción al consentimiento de los artículos 9° bis y 9° ter
(por ejemplo, interés vital del titular, obligación legal, interés público).

**Análisis detallado de cada dato personal tratado por la plataforma**:

| Dato personal                       | Descripción                                                        | ¿Dato sensible? | Fundamento                                                                                                                               |
| ----------------------------------- | ------------------------------------------------------------------ | --------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| **Correo electrónico**              | Dirección de contacto corporativa del usuario                      | No              | Identificador de contacto; no revela categoría protegida del Art. 2° g                                                                   |
| **RUT**                             | Rol Único Tributario del usuario y del informante DGA              | No              | Identificador civil/tributario chileno; no encuadra en ninguna categoría del Art. 2° g                                                   |
| **Teléfono**                        | Número de contacto corporativo para alertas                        | No              | Dato de contacto; no revela categoría protegida                                                                                          |
| **Nombre y apellido**               | Identificación nominal del usuario                                 | No              | Dato de identificación básica; no sensible por sí mismo                                                                                  |
| **Cargo**                           | Posición funcional del usuario en la empresa cliente               | No              | Descriptor funcional; no revela situación socioeconómica individual en los términos del Art. 2° g (véase nota 1 abajo)                   |
| **IP (audit log)**                  | Dirección IP del dispositivo de acceso del usuario                 | No              | Dato técnico de acceso y seguridad; no es categoría sensible, aunque sí dato personal sujeto al principio de proporcionalidad (tarea B5) |
| **Credenciales DGA del informante** | RUT y contraseña del informante ante la Dirección General de Aguas | No              | Credenciales de acceso a un sistema regulatorio; no categoría sensible del Art. 2° g                                                     |

**Nota 1 — Cargo y situación socioeconómica**: la norma menciona "situación
socioeconómica" como dato sensible. El cargo laboral no revela de por sí la
situación socioeconómica del titular en los términos que la ley busca proteger;
es un descriptor funcional que no habilita inferencias protegidas sobre
patrimonio, ingresos ni condición económica del individuo.

**Nota 2 — Datos de RRHH de empleados de Emeltec (T7 en `GOBERNANZA-DATOS.md`)**:
el tratamiento de datos de recursos humanos (legajos, liquidaciones, licencias
médicas) sí incluye datos sensibles (salud). Sin embargo: (i) ese tratamiento
se realiza bajo obligación legal y contrato de trabajo, bases que encuadran
en las hipótesis del Art. 9° ter y no en las excepciones al consentimiento del
supuesto c) de la EIPD; (ii) es responsabilidad directa de Emeltec como
empleador, no del servicio SaaS Emeltec Cloud prestado a clientes. Esta
evaluación se circunscribe al tratamiento realizado en el contexto de la
prestación del servicio SaaS.

**Conclusión supuesto c): NO aplica.** La plataforma Emeltec Cloud no trata
datos sensibles en ninguna de las categorías del Art. 2° g en el contexto del
servicio SaaS a clientes B2B.

---

## 3. Conclusión general

**La EIPD NO es obligatoria para la plataforma Emeltec Cloud en su estado
actual (julio 2026).** Los tres supuestos del Art. 15 ter han sido analizados
individualmente y descartados con fundamento explícito.

Esta conclusión se basa en las siguientes premisas fácticas que deben
mantenerse para que la evaluación siga siendo válida:

1. La plataforma no realiza decisiones automatizadas con efectos jurídicos
   sobre titulares de datos personales.
2. El universo de titulares de datos personales es reducido (segmento B2B
   industrial) y no alcanza la escala cubierta por el supuesto b).
3. La plataforma no trata datos sensibles en el contexto del servicio SaaS.

> La Agencia de Protección de Datos publicará una lista orientativa de
> operaciones que requieren EIPD (Art. 15 ter inc. 2°). Cuando sea dictada,
> esta conclusión debe revisarse contra dicha lista (ver Sección 4).

---

## 4. Gatillos de re-evaluación

La conclusión anterior dejará de ser válida y deberá realizarse una nueva
evaluación ANTES de implementar cualquiera de los siguientes cambios de
producto o negocio:

| Gatillo                                                                                                                                                         | Supuesto que activa |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| Incorporación de funciones de perfilado de usuarios (segmentación por comportamiento, scoring, recomendaciones automatizadas con base en el perfil del titular) | a)                  |
| Decisiones automatizadas que afecten el acceso al servicio, estado de la cuenta o consecuencias regulatorias para el titular                                    | a)                  |
| Expansión de la base de usuarios a un volumen masivo (consumo general, plataforma pública, decenas de miles de titulares)                                       | b)                  |
| Incorporación de datos biométricos (reconocimiento facial, huella dactilar) para cualquier finalidad                                                            | b) y c)             |
| Incorporación de datos de salud, vida u orientación sexual de titulares del SaaS                                                                                | c)                  |
| Incorporación de datos de geolocalización en tiempo real de personas                                                                                            | c) y b)             |
| Expansión del servicio a personas naturales como clientes directos (B2C)                                                                                        | b)                  |
| Publicación de la lista orientativa de operaciones por la Agencia de Protección de Datos (Art. 15 ter inc. 2°)                                                  | Todos               |
| Dictación de instrucciones generales de la Agencia (Art. 14 septies) con criterios que afecten esta evaluación                                                  | Todos               |

Adicionalmente, esta evaluación debe ser revisada en el ciclo trimestral de
monitoreo normativo (tarea B12.2 de `PLAN-MEJORAS.md`).

---

## 5. Ficha de evaluación

| Campo                       | Valor                                                                      |
| --------------------------- | -------------------------------------------------------------------------- |
| Fecha de evaluación         | 16-07-2026                                                                 |
| Evaluador                   | D. Ruiz — Desarrollador de Sistemas, DPO designado (`druiz@emeltec.cl`)    |
| Versión del documento       | 1.0                                                                        |
| Próxima revisión programada | 16-10-2026 (ciclo trimestral B12.2) o ante gatillo de la Sección 4         |
| Resultado                   | EIPD NO obligatoria en el estado actual de la plataforma                   |
| Documentos de referencia    | `PLAN-MEJORAS.md` §B12, `LEY-21719-SEGURIDAD.md`, `GOBERNANZA-DATOS.md` §4 |
