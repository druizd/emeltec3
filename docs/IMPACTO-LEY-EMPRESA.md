# Ley 21.719 — Impacto en Emeltec como empresa (más allá de la plataforma)

> Complemento de `IMPACTO-LEY-CLOUD.md`. La ley NO aplica solo al software:
> aplica a **todo tratamiento de datos de personas naturales** que haga la
> empresa — ventas, compras, facturación, RRHH, marketing, correo,
> planillas. Audiencia: gerencia.
> ⚠️ Borrador operativo, no asesoría legal.

---

## 1. La regla de oro: empresa ≠ persona

La ley protege datos de **personas naturales** (seres humanos). Los datos
de **personas jurídicas** NO son datos personales. Esta distinción define
todo el impacto comercial:

| Dato                                                                                 | ¿Es dato personal?                 |
| ------------------------------------------------------------------------------------ | ---------------------------------- |
| Razón social, RUT de empresa, giro, dirección comercial del cliente                  | **NO**                             |
| Números de venta, montos facturados a una empresa, órdenes de compra                 | **NO** (dato comercial de empresa) |
| Nombre, email, teléfono, cargo del **contacto** en esa empresa                       | **SÍ**                             |
| RUT y firma del representante legal en un contrato                                   | **SÍ**                             |
| Datos de un cliente/proveedor que es **persona natural** (boleta, factura a persona) | **SÍ, completo**                   |
| Remuneraciones, evaluaciones, licencias médicas de empleados                         | **SÍ — y salud es dato SENSIBLE**  |

Consecuencia práctica: las cifras de venta y las OC en sí no tienen
problema. El problema vive en las **personas de contacto** que las rodean
y, sobre todo, en **RRHH**.

## 2. Dónde tiene datos personales la empresa (fuera de la plataforma)

Inventario típico a confirmar/completar — cada fila debería terminar como
un tratamiento T7, T8… en `GOBERNANZA-DATOS.md` §4:

| Área                       | Datos personales probables                                                                                                                | Dónde viven hoy                                                  |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| **Ventas / comercial**     | Contactos de clientes y prospectos (nombre, cargo, email, teléfono), notas de reuniones                                                   | Correo, planillas, WhatsApp, **Softland**                        |
| **Compras / OC**           | Contactos de proveedores, datos del vendedor que atiende                                                                                  | Correo, OC en **Softland**                                       |
| **Facturación / cobranza** | Contactos de pago; si hay clientes persona natural: RUT + dirección + deuda (dato económico)                                              | **Softland**                                                     |
| **RRHH** ⚠️                | Asistencia, documentos informativos, liquidaciones de sueldo, contratos, previsión; **licencias médicas y salud ocupacional (SENSIBLES)** | **Buk** (asistencia/documentos/pagos) + **ACHS** (salud laboral) |
| **Terreno / operaciones**  | Nombres y teléfonos de operadores en sitios de clientes, coordinaciones por WhatsApp                                                      | Teléfonos del equipo                                             |
| **Postulantes**            | CVs recibidos                                                                                                                             | Correo                                                           |

### 2.1 Los tres proveedores nombrados — qué es cada uno ante la ley

| Proveedor                                                                        | Rol legal                                       | Qué significa                                                                                                                                                                                                                                                                                                                              |
| -------------------------------------------------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Buk** (RRHH SaaS: asistencia, documentos informativos, firma de liquidaciones) | **Encargado de tratamiento** (Art. 15 bis)      | No procesa el pago de sueldos, pero para la firma de liquidaciones VE su contenido (remuneraciones) — ver ya es tratar. Requiere contrato/DPA con contenido mínimo legal; Buk reporta brechas a Emeltec y Emeltec evalúa reportar a la Agencia. Es el encargado MÁS crítico de la empresa: revisar su contrato primero.                    |
| **Disofi** (partner que administra Softland, el ERP)                             | **Encargado de tratamiento**                    | El encargado es **Disofi** (quien opera/gestiona el sistema y accede a los datos), no Softland como marca de software. Revisar contrato con Disofi. Ojo: si Disofi usa a su vez infraestructura de Softland cloud u otro tercero, eso es **subdelegación** y el Art. 15 bis exige autorización escrita de Emeltec.                         |
| **ACHS** (mutual, Ley 16.744)                                                    | **Responsable INDEPENDIENTE — no es encargado** | Trata los datos de salud laboral con finalidad PROPIA por mandato legal (administrar el seguro de accidentes). El envío de datos de trabajadores a la ACHS es una comunicación con base legal = obligación legal (misma categoría que el envío a la DGA). No requiere contrato 15 bis; sí debe quedar en el registro de tratamientos (T7). |

## 3. Qué exige la ley para esos datos (lo mismo que para la plataforma)

1. **Base legal por tratamiento**: contactos comerciales B2B → ejecución
   de contrato / interés legítimo. RRHH → contrato de trabajo y
   obligación legal. Prospección en frío → la base más débil: ojo con
   comprar bases de datos de contactos.
2. **Deber de secreto y mínimo privilegio**: quien no necesita el legajo
   de RRHH, no lo ve. Aplican los NDAs de B11.3 a TODO el equipo, no solo
   a quienes tocan la plataforma.
3. **Derechos ARCO+**: un contacto de un proveedor puede pedir que lo
   borremos de nuestras listas. Mismo canal: `datos@emeltec.cl`, mismo
   plazo (30 días), mismo registro de solicitudes.
4. **Retención**: CVs de postulantes no seleccionados, contactos de
   prospectos fríos, ex-empleados — todo necesita plazo y limpieza
   periódica. "Lo guardamos por si acaso" es exactamente lo que la ley
   prohíbe (proporcionalidad).
5. **Brechas**: un correo con la planilla de remuneraciones enviado al
   destinatario equivocado ES una vulneración (y toca datos sensibles →
   posible notificación a los afectados). El procedimiento de
   `RESPUESTA-BRECHAS.md` cubre a la empresa completa, no solo al SaaS.
6. **Encargados**: contabilidad externa, software de facturación en la
   nube, y cualquier servicio que procese remuneraciones son "encargados
   de tratamiento" → contrato 15 bis, igual que Resend/Azure.

## 4. El punto que gerencia no puede pasar por alto: RRHH

Los datos de salud (licencias, exámenes preocupacionales, accidentes
laborales) son **datos sensibles** (Art. 2° g, definición amplia que
incluye salud y situación socioeconómica). Vulnerar el secreto sobre datos
sensibles es infracción **GRAVÍSIMA: hasta 20.000 UTM** — el doble que
cualquier falla de la plataforma. Y una brecha que los afecte obliga a
notificar a los propios empleados.

Acciones mínimas: legajo bajo llave/acceso restringido, no circular
licencias por correo abierto ni WhatsApp, y verificar qué ve la
contabilidad externa y bajo qué contrato.

## 5. Plan de acción empresa (complementa el calendario del eje B)

| #   | Acción                                                                                                                                                                                                                      | Dueño                         | Cuándo       |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- | ------------ |
| 1   | Completar el inventario §2 con lo que realmente usa cada área (1 reunión por área: ventas, compras, administración)                                                                                                         | Delegado                      | Ago 2026     |
| 2   | Agregar los tratamientos T7+ (comercial, RRHH, proveedores) a `GOBERNANZA-DATOS.md` §4 con base legal y plazo                                                                                                               | Delegado                      | Ago–Sep 2026 |
| 3   | NDAs / cláusulas de confidencialidad a todo el equipo (B11.3 ampliada a empresa)                                                                                                                                            | Gerencia + 【asesoría legal】 | Sep 2026     |
| 4   | Encargados NO-plataforma: revisar contrato/DPA de **Buk** (prioridad 1: datos sensibles) y contrato con **Disofi** (incl. cláusula de subdelegación si usa Softland cloud); confirmar si hay contabilidad externa adicional | Delegado + administración     | Sep–Oct 2026 |
| 5   | Política de retención comercial: CVs 【6 meses】, prospectos fríos 【12 meses】, ex-empleados según plazos laborales/tributarios (esos mandan)                                                                              | Delegado + contabilidad       | Oct 2026     |
| 6   | Restringir acceso a legajos RRHH y sacar datos sensibles de canales abiertos                                                                                                                                                | Gerencia                      | Inmediato    |
| 7   | Comunicar reglas de uso (`GOBERNANZA-DATOS.md` §3) a TODO el equipo, con acta                                                                                                                                               | Gerencia                      | Sep 2026     |

## 6. Lo que NO cambia

- Vender, comprar, facturar y reportar números de negocio: cero impacto —
  son datos de empresas.
- Las mediciones IIoT y los reportes DGA: no son datos personales.
- No hay que pedir consentimiento a cada contacto B2B para operar la
  relación comercial: la base contractual / interés legítimo cubre el uso
  normal. Lo que se exige es informar, proteger y responder si ejercen
  derechos.

**Relación con los otros docs**: la gobernanza (roles, delegado, registro)
y el procedimiento de brechas son ÚNICOS para toda la empresa — viven en
`GOBERNANZA-DATOS.md` y `RESPUESTA-BRECHAS.md`. Este doc solo extiende su
alcance más allá de la plataforma.
