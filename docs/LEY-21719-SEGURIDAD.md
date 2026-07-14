# Ley 21.719 — Seguridad de datos: ¿qué exige exactamente la ley?

> Análisis basado en el **texto oficial** (BCN LeyChile, idNorma 1209272, versión vigencia 01-12-2026).
> La Ley 21.719 modifica la Ley 19.628; la numeración de artículos citada es la de la 19.628 modificada.
> Fuente: <https://www.bcn.cl/leychile/navegar?idNorma=1209272>
> Complementa a `PLAN-MEJORAS.md` (eje B).

---

## Pregunta clave: ¿el JWT es suficiente?

**La ley no exige ninguna tecnología de autenticación específica.** No menciona MFA, 2FA, tokens, sesiones, contraseñas ni gestión de credenciales en ninguna parte. La única mención de "autenticación" (Art. 11 a) se refiere a verificar la identidad del titular cuando ejerce sus derechos ARCO, según procedimientos que fijará la Agencia.

Lo que sí exige es un **estándar de resultado** (Art. 14 quinquies):

1. Medidas adecuadas al riesgo, considerando el **"estado actual de la técnica"**.
2. Garantizar **confidencialidad, integridad, disponibilidad y resiliencia** de los sistemas.
3. Evitar **"la alteración, destrucción, pérdida, tratamiento o acceso no autorizado"**.
4. **Carga de la prueba invertida**: "Ante la ocurrencia de un incidente de seguridad, y en caso de controversia judicial o administrativa, **corresponderá al responsable acreditar** la existencia y el funcionamiento de las medidas de seguridad adoptadas en base a los niveles de riesgo y a la tecnología disponible."

**Conclusión práctica**: JWT como mecanismo es perfectamente legal. El problema es el conjunto: JWT guardado en localStorage en texto plano, junto a datos personales (email, RUT, teléfono), es difícil de defender como "estado actual de la técnica" ante un incidente — el estándar de la industria es cookie `httpOnly` + `Secure` + `SameSite`, precisamente porque elimina el robo de token vía XSS. El 2FA que ya tenemos SUMA como evidencia de diligencia. Infringir el 14 quinquies es infracción **GRAVE: hasta 10.000 UTM**.

Los estándares técnicos concretos (donde podría aparecer una exigencia tipo MFA) los fijará la **Agencia de Protección de Datos mediante instrucción general** (Art. 14 septies), diferenciados por tamaño de empresa. Aún no dictados → hay que monitorearlos.

---

## Artículo por artículo — lo que obliga y cómo nos afecta

### Art. 3° f) y h) — Principios de seguridad y confidencialidad

> f) "El responsable debe garantizar estándares adecuados de seguridad, protegiéndolos contra el tratamiento no autorizado o ilícito, y contra su pérdida, filtración, daño accidental o destrucción."
> h) "El responsable establecerá controles y medidas adecuadas para preservar el secreto o confidencialidad. Este deber subsiste aún después de concluida la relación con el titular."

**Impacto**: base de todo el eje B del plan. La confidencialidad sobrevive al fin del contrato con el cliente.

### Art. 14 bis — Deber de secreto o confidencialidad

Obliga al responsable Y a sus dependientes/terceros que traten datos bajo su responsabilidad. Vulnerarlo: infracción **grave** (34 ter i). Sobre datos sensibles: **gravísima** (34 quáter d).

**Impacto**: acuerdos de confidencialidad con empleados/contratistas que acceden a datos de usuarios; controles de acceso por rol (ya existen: roleGuard).

### Art. 14 ter e) — La política de seguridad debe ser PÚBLICA

> El responsable debe mantener a disposición del público: "La política y las medidas de seguridad adoptadas para proteger las bases de datos personales que administra."

**Impacto**: hallazgo nuevo — no basta tener medidas; hay que **publicar la política de seguridad** (a nivel de política, no detalles explotables). Página pública o sección en `/privacidad`.

### Art. 14 quáter — Protección desde el diseño y por defecto

> "...aplicar medidas técnicas y organizativas para garantizar que, **por defecto, sólo sean objeto de tratamiento los datos personales específicos y estrictamente necesarios** para dicha actividad. Para ello, se tendrá en consideración el número de datos recogidos, la extensión del tratamiento, el plazo de conservación y su accesibilidad."

**Impacto**: minimización por defecto = argumento legal directo para reducir `user_data` en localStorage (tarea B2.1) y para la política de retención (B5). "Accesibilidad" incluye cuán expuestos están los datos en el cliente.

### Art. 14 quinquies — Deber de adoptar medidas de seguridad (EL artículo)

Texto clave (extracto literal):

> "Las medidas aplicadas por el responsable deben asegurar la **confidencialidad, integridad, disponibilidad y resiliencia** de los sistemas de tratamiento de datos. Asimismo, deberán evitar la alteración, destrucción, pérdida, tratamiento o acceso no autorizado.
> [...] el responsable y el encargado del tratamiento aplicarán medidas técnicas y organizativas apropiadas para garantizar un nivel de seguridad adecuado al riesgo, que en su caso incluya, entre otros:
> a) La **seudonimización y el cifrado** de datos personales.
> b) La capacidad de garantizar la confidencialidad, integridad, disponibilidad y resiliencia permanentes de los sistemas y servicios de tratamiento.
> c) La capacidad de **restaurar la disponibilidad y el acceso a los datos personales de forma rápida** en caso de incidente físico o técnico.
> d) Un **proceso de verificación, evaluación y valoración regulares de la eficacia** de las medidas técnicas y organizativas."

Notas:

- Espejo casi textual del Art. 32 del RGPD europeo.
- Seudonimización y cifrado son **ejemplos**, no obligaciones absolutas ("que en su caso incluya, entre otros").
- Letra c) = exige **backups y plan de recuperación** verificables.
- Letra d) = exige **revisiones periódicas de seguridad** documentadas (auditorías internas, pentest, revisión de dependencias).
- Inciso final = **carga de la prueba invertida** (ver arriba).

**Impacto**: además de B2 (localStorage), necesitamos: cifrado en reposo en BD para campos sensibles (credenciales DGA como mínimo), respaldos verificados con prueba de restauración, y calendario de revisión de seguridad documentado.

### Art. 14 sexies — Reporte de vulneraciones

- **A la Agencia**: "por los medios más expeditos posibles y **sin dilaciones indebidas**" cuando exista "riesgo razonable para los derechos y libertades de los titulares". **No hay plazo fijo en horas** (a diferencia de las 72 h del RGPD).
- **Registro interno obligatorio**: "El responsable deberá **registrar estas comunicaciones**, describiendo la naturaleza de las vulneraciones sufridas, sus efectos, las categorías de datos y el número aproximado de titulares afectados y las medidas adoptadas."
- **A los titulares**: solo cuando la brecha afecte **datos sensibles, datos de menores de 14 años, o datos económicos/financieros/bancarios/comerciales**. En lenguaje claro; si no es posible notificar a cada uno, aviso en medio de comunicación masivo nacional.
- Omitir el reporte: **grave** (34 ter k). Omitirlo deliberadamente: **gravísima** (34 quáter f).

**Impacto**: tarea B4 se amplía — además del procedimiento, hace falta el **registro interno de vulneraciones** (bitácora formal).

### Art. 14 septies — Estándares mínimos los fija la Agencia

> "Los estándares o condiciones mínimas [...] para el cumplimiento de los deberes de información y de seguridad [...] **serán determinados por la Agencia mediante instrucción general**", diferenciados por tamaño de empresa (categorías Ley 20.416).

**Impacto**: los requisitos técnicos concretos aún NO existen. Cuando la Agencia dicte la instrucción general, ahí podrían aparecer exigencias específicas (¿MFA?, ¿cifrado obligatorio?). **Monitorear**.

### Art. 15 bis — Encargados de tratamiento (terceros)

- Contrato obligatorio con contenido mínimo: objeto, duración, finalidad, tipos de datos, categorías de titulares, derechos y obligaciones.
- El encargado queda sujeto directamente a 14 bis (secreto) y 14 quinquies (seguridad).
- El encargado **reporta brechas al responsable** (no a la Agencia).
- Sin subdelegación salvo autorización escrita. Al terminar el servicio: supresión o devolución de datos.
- La Agencia publicará contratos modelo en su web.

**Impacto**: hallazgo nuevo — nuestros proveedores que tratan datos personales son "encargados": **Azure (hosting VM), GitHub (¿hay datos personales en repos/logs?), servicio de envío de correos/SMS del 2FA si es externo**. Inventariar y revisar contratos/DPAs.

### Art. 15 ter — Evaluación de impacto (EIPD)

Obligatoria SIEMPRE en: a) decisiones automatizadas/perfilado con efectos jurídicos significativos; b) **"tratamiento masivo de datos o a gran escala"**; c) observación sistemática de zona pública; d) datos sensibles en hipótesis de excepción del consentimiento.

Omitirla cuando corresponde: **gravísima** (34 quáter k).

**Impacto**: evaluar si aplica. Los datos IIoT (mediciones de pozos/plantas) no son datos personales en sí; los datos personales (usuarios, contactos) son volumen acotado B2B. Probablemente NO aplica hoy, pero hay que **documentar esa evaluación** — la Agencia publicará lista orientativa de operaciones que la requieren.

### Datos sensibles (Art. 2° g y conexos)

Definición amplia: incluye situación socioeconómica, salud, biometría, etc. Hoy la plataforma **no trata datos sensibles** (verificar que siga siendo así). Relevancia: si algún día se agregan (p. ej. datos de salud ocupacional), se activan notificación a titulares en brechas + EIPD + sanción gravísima por vulnerar secreto.

---

## Sanciones vinculadas a seguridad (Arts. 34 bis/ter/quáter, 35)

| Infracción                                         | Categoría               | Multa máx. |
| -------------------------------------------------- | ----------------------- | ---------- |
| Omitir envío de comunicaciones a la Agencia        | Leve (34 bis d)         | 5.000 UTM  |
| Vulnerar deber de secreto (14 bis)                 | Grave (34 ter i)        | 10.000 UTM |
| Infringir obligaciones de seguridad (14 quinquies) | Grave (34 ter j)        | 10.000 UTM |
| Omitir comunicaciones/registros de vulneraciones   | Grave (34 ter k)        | 10.000 UTM |
| Vulnerar secreto sobre datos sensibles             | Gravísima (34 quáter d) | 20.000 UTM |
| Omitir deliberadamente comunicación de brechas     | Gravísima (34 quáter f) | 20.000 UTM |
| Omitir EIPD cuando corresponde                     | Gravísima (34 quáter k) | 20.000 UTM |

Agravantes: +50% de recargo si no se subsana en 60 días; reincidencia hasta 3×; empresas no-PYME reincidentes: hasta **2% (graves) o 4% (gravísimas) de los ingresos anuales**. Agravante expresa (36 c): "haber puesto en riesgo la seguridad de los derechos y libertades de los titulares".

---

## Mapa: exigencia legal → estado actual → acción

| Exigencia (artículo)                                    | Estado actual                                     | Acción (tarea en PLAN-MEJORAS)   |
| ------------------------------------------------------- | ------------------------------------------------- | -------------------------------- |
| Confidencialidad / acceso no autorizado (14 quinquies)  | JWT + datos personales en localStorage plain text | B2 — minimizar + cookie httpOnly |
| Minimización por defecto (14 quáter)                    | `user_data` completo en cliente                   | B2.1                             |
| Cifrado como medida ejemplar (14 quinquies a)           | Credenciales DGA: verificar cifrado en reposo     | B2.4 + B10.2                     |
| Disponibilidad / restauración rápida (14 quinquies c)   | Sin plan de backup/restore documentado            | B10.3 (nueva)                    |
| Verificación regular de eficacia (14 quinquies d)       | Sin auditorías periódicas                         | B10.4 (nueva)                    |
| Política de seguridad pública (14 ter e)                | No existe                                         | B10.1 (nueva)                    |
| Reporte de brechas + registro interno (14 sexies)       | Sin procedimiento ni registro                     | B4 (ampliada: B4.4)              |
| Contratos con encargados (15 bis)                       | Sin inventario de encargados/DPAs                 | B11 (nueva)                      |
| EIPD (15 ter)                                           | Sin evaluación documentada                        | B12.1 (nueva)                    |
| Estándares mínimos de la Agencia (14 septies)           | Instrucción general aún no dictada                | B12.2 (nueva) — monitorear       |
| Supresión/retención (14 quáter, ppio. proporcionalidad) | Soft-delete, retención indefinida                 | B1, B5 (ya en plan)              |
| Deber de secreto de dependientes (14 bis)               | Sin NDAs formales verificados                     | B11.3 (nueva)                    |

---

## Estado normativo complementario (a julio 2026)

- **D.S. N° 662/2025 (Hacienda)** — Reglamento del Modelo de Prevención de Infracciones: dictado 13-06-2025, en toma de razón de Contraloría desde agosto 2025; vigencia junto con la ley (01-12-2026). Relevante para tarea B9.
- **Instrucciones generales de la Agencia** (estándares mínimos de seguridad, Art. 14 septies): pendientes de dictación.
- La Agencia publicará: contratos modelo para encargados (15 bis), lista orientativa de EIPD (15 ter), procedimientos de autenticación de titulares (11 a).
