# Ley 21.719 — Impacto en la plataforma cloud.emeltec.cl

> Síntesis ejecutiva. Mezcla y resume: `PLAN-MEJORAS.md` (eje B, tareas),
> `LEY-21719-SEGURIDAD.md` (análisis legal), `GOBERNANZA-DATOS.md` (roles y
> registro de tratamientos) y `RESPUESTA-BRECHAS.md` (procedimiento).
> Para el detalle, ir a esos documentos. Audiencia: gerencia + equipo.
> **Deadline legal: 1 de diciembre de 2026.**

---

## 1. La idea en tres frases

1. Desde el 01-12-2026, Chile tiene una ley de datos personales con
   dientes: Agencia fiscalizadora y multas de hasta 10.000 UTM (graves) y
   20.000 UTM (gravísimas), con recargos por reincidencia.
2. La plataforma maneja datos personales de los usuarios de nuestros
   clientes: nombre, email, RUT, teléfono, cargo, IP y credenciales DGA.
   Las mediciones IIoT (caudales, niveles) **no** son datos personales.
3. Ante un incidente, la carga de la prueba es **nuestra**: Emeltec debe
   demostrar con documentos fechados que sus medidas existían y
   funcionaban (Art. 14 quinquies). Lo no documentado, legalmente no
   existe.

## 2. Qué ya cumple la plataforma (mantener)

| Qué                                               | Por qué suma                                           |
| ------------------------------------------------- | ------------------------------------------------------ |
| JWT + 2FA por email, guards por rol, auto-logout  | Evidencia de diligencia en control de acceso           |
| Headers de seguridad (HSTS, CSP, X-Frame-Options) | Medidas técnicas del 14 quinquies                      |
| Audit log (quién hizo qué, cuándo, desde qué IP)  | Trazabilidad; insumo del registro de vulneraciones     |
| Sin analytics de terceros, sin cookies            | Minimización — no hay tratamiento oculto               |
| Páginas `/privacidad` y `/terminos`               | Base del deber de información (falta actualizar texto) |
| Rectificación de datos en `/profile`              | Primer derecho ARCO+ ya operativo                      |

## 3. Qué cambia en la plataforma (features y trabajo técnico)

Resumen del eje B de `PLAN-MEJORAS.md`, en lenguaje de producto:

| #   | Cambio en la plataforma                                                                                                                                                   | Por qué (artículo)                                             | Tarea      |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | ---------- |
| 1   | **Sesión más liviana**: dejar de guardar email/RUT/teléfono en localStorage; solo `{id, nombre, rol}` e hidratar el resto desde la API. Ideal: token en cookie httpOnly   | Minimización por defecto (14 quáter); un XSS hoy se lleva todo | B2         |
| 2   | **Borrado real de cuentas**: hoy es soft-delete; hay que poder suprimir/anonimizar de verdad, incluido el rastro en audit log                                             | Derecho de supresión                                           | B1         |
| 3   | **Sección "Mis datos" en el perfil**: ver todo lo que guardamos del usuario, exportarlo (JSON/CSV) y pedir supresión                                                      | Derechos ARCO+ visibles para el titular                        | B3         |
| 4   | **Retención con reloj**: job que anonimiza el audit log — 12 meses lo general, 36 meses las acciones que afectan datos DGA (justificación en `GOBERNANZA-DATOS.md` §4 T3) | Proporcionalidad                                               | B5         |
| 5   | **Cifrado en reposo de credenciales DGA** + verificación de que jamás pasan por el cliente                                                                                | Cifrado como medida ejemplar (14 quinquies a)                  | B2.4/B10.2 |
| 6   | **Alertas de seguridad sobre el audit log**: logins anómalos, exportaciones masivas, cambios de permisos                                                                  | Detección de brechas (14 sexies)                               | B4.2       |
| 7   | **`/privacidad` actualizada** + **política de seguridad pública** (obligatoria: 14 ter e)                                                                                 | Deber de información                                           | B8/B10.1   |
| 8   | **Aviso + checkbox al crear usuarios** con timestamp persistido                                                                                                           | Prueba del deber de información                                | B7         |
| 9   | **Backups con prueba de restauración documentada**                                                                                                                        | Resiliencia (14 quinquies c)                                   | B10.3      |

## 4. Qué cambia en cómo operamos la plataforma (no es código)

- **Delegado de protección de datos**: D. Ruiz (Desarrollador de
  Sistemas) — designación por acta física (modelo en `GOBERNANZA-DATOS.md`
  Anexo A). Punto de contacto: `datos@emeltec.cl` (grupo por crear).
- **Brechas**: procedimiento de 5 fases en `RESPUESTA-BRECHAS.md` —
  contención inmediata, evaluación ≤24 h, notificación a la Agencia ≤72 h
  (estándar interno), registro interno obligatorio de TODA vulneración,
  incluso las no notificadas. Simulacro anual.
- **Reglas de uso interno** (`GOBERNANZA-DATOS.md` §3): mínimo privilegio,
  view-as solo con justificación, cero exportaciones de datos personales,
  nada de datos productivos en dev, canales corporativos.
- **Proveedores como "encargados"**: Resend (correo 2FA) y Azure tratan
  datos por nosotros → contrato/DPA obligatorio (Art. 15 bis). No hay que
  cambiar de proveedor; hay que archivar el papel.
- **Solicitudes de titulares**: 30 días de plazo legal (interno: 10),
  registradas con timestamp.

## 5. Riesgo si no hacemos nada (los números)

| Escenario                                                               | Multa máx.                         |
| ----------------------------------------------------------------------- | ---------------------------------- |
| Datos personales en localStorage + XSS → fuga; sin medidas acreditables | 10.000 UTM (grave, 14 quinquies)   |
| Brecha no reportada a la Agencia                                        | 10.000 UTM; deliberada: 20.000 UTM |
| Usuario pide borrar su cuenta y solo hacemos soft-delete                | Infracción a derechos del titular  |
| Sin política de seguridad pública                                       | Incumplimiento 14 ter e            |
| Reincidencia (empresa no-PYME)                                          | Hasta 2–4 % de ingresos anuales    |

## 6. Calendario (de `PLAN-MEJORAS.md`)

| Mes     | Foco                                                                   |
| ------- | ---------------------------------------------------------------------- |
| Jul–Ago | Sesión liviana (B2), retención (B5), evaluaciones documentadas (B12)   |
| Ago–Sep | Supresión real (B1), `/privacidad` (B8), política de seguridad (B10.1) |
| Sep–Oct | "Mis datos" ARCO+ (B3), cifrado + backups (B10.2/.3)                   |
| Oct–Nov | Alertas de brechas (B4.2), consentimiento (B7), DPAs (B11)             |

**Lectura recomendada después de este doc**: `GOBERNANZA-DATOS.md`
(roles, registro de tratamientos y acta) → `RESPUESTA-BRECHAS.md`
(qué hacer si pasa algo) → `PLAN-MEJORAS.md` eje B (checklist vivo).
