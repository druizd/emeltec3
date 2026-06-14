# Declaración de Aplicabilidad (SoA) — Extracto — Emeltec Cloud

|             |                                                                                                                                             |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| **Marco**   | ISO/IEC 27001:2022 — Anexo A (cláusula 6.1.3 d)                                                                                             |
| **Fecha**   | 14 de junio de 2026                                                                                                                         |
| **Alcance** | Controles del Anexo A relacionados con los hallazgos tratados en esta remediación. Extracto — la SoA completa debe cubrir los 93 controles. |

**Estado:** Implementado · Parcial · Planificado · Aceptado (riesgo aceptado).

| Control       | Nombre                                 | ¿Aplica? | Justificación                                                | Estado                                            |
| ------------- | -------------------------------------- | -------- | ------------------------------------------------------------ | ------------------------------------------------- |
| A.5.15        | Control de acceso                      | Sí       | Acceso multi-tenant a datos y endpoints                      | Implementado (modelo único `canAccessSite` v1/v2) |
| A.5.17        | Información de autenticación           | Sí       | Gestión de credenciales/secretos (JWT, DGA, BD)              | Parcial — rotación de secretos pendiente (R-01)   |
| A.5.18        | Derechos de acceso                     | Sí       | Roles (SuperAdmin/Admin/Gerente/Cliente) y su alcance        | Implementado                                      |
| A.5.19–A.5.23 | Proveedores y servicios en la nube     | Sí       | Dependencias (npm/cargo), imágenes Docker, VM/cloud          | Parcial — fijar imágenes por digest pendiente     |
| A.5.34        | Privacidad y protección de PII         | Sí       | Datos personales/regulatorios (DGA, firmante) — Ley 19.628   | Parcial — purga de datos en historia pendiente    |
| A.8.3         | Restricción de acceso a la información | Sí       | IDOR por serial/sitio                                        | Implementado                                      |
| A.8.5         | Autenticación segura                   | Sí       | Lockout, OTP, MFA, anti-enumeración, fail-closed             | Implementado                                      |
| A.8.6         | Gestión de capacidad                   | Sí       | Capacidad de ingesta (DoS por recursos)                      | Aceptado (R-20)                                   |
| A.8.8         | Gestión de vulnerabilidades técnicas   | Sí       | Auditoría + remediación + dependencias                       | Implementado (proceso establecido)                |
| A.8.9         | Gestión de configuración               | Sí       | Puertos, contenedores no-root, infra-db, secretos en compose | Parcial (nginx no-root / digests pendientes)      |
| A.8.12        | Prevención de fuga de datos            | Sí       | Datos regulatorios versionados                               | Parcial — purga de historia pendiente             |
| A.8.15        | Registro (logging)                     | Sí       | Bitácora append-only (Ley 21.663)                            | Implementado (IP no falsificable)                 |
| A.8.16        | Actividades de monitoreo               | Sí       | Detección de abuso/enumeración (rate-limit, auditoría)       | Parcial                                           |
| A.8.20        | Seguridad de redes                     | Sí       | Exposición de puertos, segmentación interna                  | Parcial — firewall a gRPC pendiente               |
| A.8.21        | Seguridad de servicios de red          | Sí       | CORS, exposición de APIs                                     | Implementado (CORS allowlist; gRPC pend.)         |
| A.8.24        | Uso de criptografía                    | Sí       | TLS en tránsito, JWT (algoritmo fijado), cifrado DGA         | Parcial — TLS gRPC/BD pendiente (R-12/R-19)       |
| A.8.25        | Ciclo de vida de desarrollo seguro     | Sí       | Correcciones con tests, revisión, CI                         | Implementado                                      |
| A.8.28        | Codificación segura                    | Sí       | Consultas parametrizadas, validación, sin secretos en código | Implementado                                      |
| A.8.29        | Pruebas de seguridad                   | Sí       | Tests de control de acceso, verificación adversaria          | Implementado                                      |
| A.8.31        | Separación de entornos                 | Sí       | Dev/prod; futura migración a Kubernetes                      | Parcial (planificado)                             |
| A.8.32        | Gestión de cambios                     | Sí       | Gate de aprobación de despliegue, PR + CI                    | Implementado                                      |

> **Notas:** los estados "Parcial/Planificado/Aceptado" están trazados en `REGISTRO-RIESGOS-Y-TRATAMIENTO-2026-06.md`. Para certificación, completar la SoA con los 93 controles del Anexo A, indicando para cada uno aplicabilidad y justificación de inclusión/exclusión.
