# Supresión de Datos Personales — Derecho ARCO+

## Marco legal

La Ley 21.719 de Protección de Datos Personales (Chile) establece el **derecho ARCO+**: Acceso, Rectificación, Cancelación/Supresión, Oposición, Portabilidad y Revocación del consentimiento.

El **derecho de supresión** (Art. 16 Ley 21.719) permite a toda persona natural exigir que sus datos personales sean eliminados o anonimizados cuando ya no sean necesarios para el fin que motivó su tratamiento, o cuando se revoque el consentimiento que lo sustentaba.

Plazo legal de respuesta: **30 días corridos** desde la solicitud.

---

## Qué se anonimiza

Al ejecutarse la supresión de una cuenta de usuario, los siguientes campos se reemplazan con valores neutros que impiden re-identificar a la persona:

| Campo            | Valor tras supresión                                                    |
| ---------------- | ----------------------------------------------------------------------- |
| `email`          | `anonimizado+{user_id}@eliminado.invalid`                               |
| `nombre`         | `[ANONIMIZADO]`                                                         |
| `apellido`       | `[ANONIMIZADO]`                                                         |
| `rut_usuario`    | `NULL`                                                                  |
| `telefono`       | `NULL`                                                                  |
| `cargo`          | `NULL`                                                                  |
| `password_hash`  | `NULL` — dato derivado del titular; la cuenta jamás vuelve a autenticar |
| `otp_hash`       | `NULL` — ídem                                                           |
| `otp_expires_at` | `NULL` — ídem                                                           |

El dominio `.invalid` es un TLD reservado por RFC 2606 que no puede resolver en DNS, lo que garantiza que el email anonimizado no pertenece a nadie.

Adicionalmente se **suprimen** (DELETE) los registros de `contacto_operativo` cuyo email coincide con el del titular: sin esto, la persona suprimida seguiría recibiendo correos de alertas con su nombre, y el derecho de supresión se ejercería a medias (hallazgo de auditoría 17-07-2026).

---

## Qué se retiene con base legal

Los siguientes campos se conservan porque su eliminación comprometería la integridad referencial del sistema de auditoría o porque existe una obligación legal vigente:

| Campo / tabla                                                         | Base legal para retener                                                                                                                                                                        |
| --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id` (usuario)                                                        | Integridad referencial: `audit_log` referencia este ID. Eliminar el registro rompería la trazabilidad de acciones históricas.                                                                  |
| `tipo`, `empresa_id`, `sub_empresa_id`                                | Necesario para mantener coherencia del modelo de datos y cumplimiento de contratos activos.                                                                                                    |
| `activo = false`                                                      | Permite distinguir cuentas activas de suprimidas sin exponer PII.                                                                                                                              |
| `last_login_at`, `activated_at`, `password_set_at` y otros timestamps | **Obligación legal** (Ley 19.628 en vigor, contratos de servicio) e **interés legítimo** para auditorías de seguridad y trazabilidad de accesos. Los timestamps no contienen PII por sí solos. |
| `politica_aceptada_at`                                                | **Prueba del deber de información cumplido** (Art. 14 ter): acredita que el titular fue informado y aceptó la política mientras la cuenta estuvo activa. No contiene PII.                      |
| Asignaciones en `incidencia_tecnicos`                                 | **Trazabilidad operacional**: qué incidencias atendió la cuenta. El JOIN con `usuario` ya devuelve `[ANONIMIZADO]`, por lo que ningún dato personal se expone a través de la relación.         |

---

## Anonimización en audit_log

Los registros históricos de `audit_log` atribuidos al usuario suprimido también se anonomizan para eliminar la asociación a su identidad:

| Columna en audit_log | Valor tras supresión |
| -------------------- | -------------------- |
| `actor_email`        | `[ANONIMIZADO]`      |
| `ip`                 | `[ANONIMIZADO]`      |

La columna `actor_id` se **conserva** (valor original) porque es necesaria para mantener la trazabilidad de qué cuenta realizó qué acción, sin que eso implique re-identificación del titular (el ID no contiene PII directa).

---

## Quién puede ejecutar la supresión

| Actor                                           | Condición                                                      |
| ----------------------------------------------- | -------------------------------------------------------------- |
| **El propio titular**                           | Puede suprimir su propia cuenta (`req.user.id === target_id`). |
| **SuperAdmin**                                  | Puede suprimir cualquier cuenta de cualquier empresa.          |
| Otros roles (Admin, Gerente, Cliente, Vendedor) | **No permitido** — retorna 403 Forbidden.                      |

### Restricciones de seguridad

- **Un SuperAdmin no puede suprimirse a sí mismo** si es el actor actuante de la solicitud. Esto previene la eliminación accidental del único administrador del sistema.
- La validación de identidad ocurre dentro del controller (no en el middleware de ruta), para poder aplicar la lógica "SuperAdmin O titular".

---

## Endpoint

```
POST /api/users/:id/suprimir
Authorization: Bearer {jwt}
```

La operación es **irreversible**. Se registra en `audit_log` con `action = 'user.suprimir'` **antes** de ejecutar la anonimización (para dejar traza completa del actor y el target con datos aún legibles en ese instante).

---

## Brechas documentadas

### B4.2: Exportaciones masivas no detectables

No existe ninguna acción `export`, `download` ni similar en `audit_log`. Las exportaciones de datos realizadas desde el frontend no generan registros auditables en la base de datos. Esto es una **brecha de trazabilidad** respecto al Art. 14 ter Ley 21.719 (deber de registro de tratamiento).

**Impacto**: El módulo B4.2 de alertas automáticas no puede detectar exportaciones masivas porque no hay eventos que monitorear.

**Acción recomendada**: Instrumentar los endpoints de descarga (`/api/data/export`, generación de reportes) con llamadas a `audit_log.record()` usando una acción `data.export` antes de liberar esta funcionalidad a producción.
