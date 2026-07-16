# Procedimiento de Respuesta a Brechas de Datos Personales — Emeltec

> Cubre B4.1 (procedimiento), B4.3 (plantillas) y B4.4 (registro interno)
> de `PLAN-MEJORAS.md`. Base: Art. 14 sexies Ley 19.628 mod. 21.719.
> Roles definidos en `GOBERNANZA-DATOS.md` §2.
> Sanciones: omitir reporte = grave (10.000 UTM); omitirlo deliberadamente =
> gravísima (20.000 UTM).

---

## 1. Qué cuenta como "vulneración"

Cualquier incidente que cause **alteración, destrucción, pérdida, o acceso/
tratamiento no autorizado** de datos personales. Ejemplos en nuestro
contexto:

- Acceso no autorizado a la BD de usuarios o al audit log.
- Token/credencial filtrada (XSS, repo público, log expuesto).
- Cuenta de SuperAdmin comprometida.
- Fuga vía encargado (Resend, Azure) — ellos nos reportan a NOSOTROS y
  nosotros evaluamos reportar a la Agencia.
- Backup extraviado o expuesto.
- Correo con datos personales enviado a destinatario equivocado (sí, esto
  también es una vulneración).

**No** son vulneraciones de datos personales: caída de servicio sin
exposición de datos, pérdida de mediciones IIoT sin datos personales.
(Igual se registran como incidentes técnicos, pero fuera de este flujo.)

## 2. Flujo (5 fases)

### Fase 1 — Detección y aviso (inmediato)

Quien detecte (equipo, cliente, alerta, aviso de Resend/Azure) avisa al
**delegado** por el canal más rápido. Regla: avisar aunque haya duda de si
califica — el delegado clasifica, no el detector.

### Fase 2 — Contención (inmediato, sin esperar aprobación)

El responsable técnico disponible ejecuta lo que corresponda:

- Revocar tokens/sesiones comprometidas; forzar re-login.
- Rotar credenciales expuestas (BD, API keys, credenciales DGA).
- Aislar el sistema afectado / cortar el acceso del atacante.
- Preservar evidencia: NO borrar logs; snapshot si es posible.

### Fase 3 — Evaluación y clasificación (≤24 h desde detección)

Delegado + responsable técnico documentan en el registro (§4):

1. ¿Qué datos, de cuántos titulares, por cuánto tiempo expuestos?
2. **¿Riesgo razonable para derechos y libertades de los titulares?**
   - SÍ → notificar a la Agencia (Fase 4).
   - NO → registrar igual con el fundamento de por qué no (la carga de la
     prueba es nuestra).
3. ¿Afecta datos **sensibles, de menores de 14 años, o económicos/
   financieros/bancarios/comerciales**?
   - SÍ → además notificar a los **titulares** (Fase 4b).
   - Hoy la plataforma no trata datos sensibles (ver B12.3) — el caso
     probable de notificación a titulares sería exposición de datos
     comerciales/financieros de clientes.

### Fase 4 — Notificación

- **4a. A la Agencia**: "por los medios más expeditos posibles y sin
  dilaciones indebidas". Estándar interno: **≤72 h** desde la detección
  (la ley no fija horas; 72 h es defendible y homologa RGPD). Decide el
  delegado CON el representante legal. Plantilla en §3.1.
- **4b. A titulares** (solo si Fase 3.3 = SÍ): lenguaje claro, plantilla
  §3.2. Si no es posible individualmente, aviso en medio de comunicación
  masivo de alcance nacional.
- **No esperar a tener el análisis completo**: se puede notificar en fases
  (aviso inicial + actualización).

### Fase 5 — Post-mortem (≤10 días hábiles)

- Causa raíz, cronología, qué funcionó y qué no.
- Medidas correctivas con dueño y fecha.
- Actualizar el registro interno (§4) y, si cambió un tratamiento,
  `GOBERNANZA-DATOS.md` §4.

## 3. Plantillas

### 3.1 Notificación a la Agencia de Protección de Datos

```text
Asunto: Notificación de vulneración de seguridad — [Razón social], RUT [__]

1. Responsable: [razón social, RUT, domicilio, representante legal]
   Contacto: [delegado de protección de datos, correo, teléfono]
2. Fecha y hora de detección: [__]  Fecha estimada de ocurrencia: [__]
3. Naturaleza de la vulneración: [acceso no autorizado / pérdida /
   alteración / destrucción / filtración]
4. Categorías de datos afectados: [identificación, contacto, credenciales…]
   ¿Incluye datos sensibles, de menores o económico-financieros?: [sí/no]
5. Número aproximado de titulares afectados: [__]
6. Consecuencias probables para los titulares: [__]
7. Medidas de contención ya adoptadas: [__]
8. Medidas correctivas planificadas: [__]
9. ¿Se notificó o notificará a los titulares?: [sí/no, fundamento]
```

### 3.2 Notificación a titulares (lenguaje claro, obligatorio)

```text
Asunto: Aviso de seguridad sobre tus datos en Emeltec Cloud

Te escribimos para informarte de un incidente de seguridad que afectó
[QUÉ DATOS: p. ej. tu correo y número de teléfono] registrados en la
plataforma Emeltec Cloud.

Qué pasó: [explicación simple, sin tecnicismos, 2-3 frases]
Cuándo: [fecha de ocurrencia y de detección]
Qué hicimos: [contención en términos simples]
Qué te recomendamos: [p. ej. cambiar tu contraseña; desconfiar de correos
que pidan tus claves citando este incidente]

Puedes contactarnos en datos@emeltec.cl. También puedes reclamar ante la
Agencia de Protección de Datos Personales.

[Nombre representante legal] — [Razón social]
```

## 4. Registro interno de vulneraciones (Art. 14 sexies inc. 2° — OBLIGATORIO)

Archivo vivo: `docs/registro-vulneraciones.md` (crear con la primera
entrada; mientras esté vacío, este procedimiento basta como evidencia).
Una entrada por incidente, incluso los NO notificados:

```markdown
## [AAAA-MM-DD] — [título corto]

- Detección: [fecha/hora, cómo]
- Naturaleza: [tipo de vulneración]
- Datos y categorías afectadas: [__]
- Titulares afectados (nº aprox.): [__]
- Efectos: [__]
- Riesgo para titulares: [evaluación y conclusión]
- ¿Notificado a la Agencia?: [sí + fecha / no + fundamento]
- ¿Notificado a titulares?: [sí/no + fundamento]
- Medidas de contención: [__]
- Medidas correctivas: [dueño, fecha compromiso, estado]
- Post-mortem: [enlace o resumen]
```

## 5. Prueba del procedimiento

- **Simulacro anual** (tabletop 1 h): correr un escenario (p. ej. "token de
  SuperAdmin filtrado en un repo") con este documento en mano. Registrar
  fecha, participantes y aprendizajes — evidencia directa del Art. 14
  quinquies d (verificación de eficacia).
- Primer simulacro: 【agendar, idealmente antes de nov-2026】.
