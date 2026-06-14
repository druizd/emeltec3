# Registro de Riesgos y Plan de Tratamiento — Emeltec Cloud

|                      |                                                                         |
| -------------------- | ----------------------------------------------------------------------- |
| **Marco**            | ISO/IEC 27001:2022 — cláusulas 6.1.2 (evaluación) y 6.1.3 (tratamiento) |
| **Fecha**            | 14 de junio de 2026                                                     |
| **Fuente**           | Auditoría de ciberseguridad (`INFORME-AUDITORIA-SEGURIDAD-2026-06.md`)  |
| **Dueño del riesgo** | Desarrollador de Sistemas — Emeltec                                     |

## Metodología (resumen)

- **Probabilidad (P)** y **Impacto (I)**: escala Alta / Media / Baja.
- **Nivel de riesgo** = combinación P×I → Crítico / Alto / Medio / Bajo.
- **Tratamiento** (6.1.3): Mitigar · Aceptar · Transferir · Evitar.
- **Riesgo residual**: nivel remanente tras el tratamiento.

> El riesgo de **R-01 (secretos en historia)** se mantiene **Crítico** hasta que se ejecute la rotación + purga; la corrección de código no lo reduce por sí sola.

## Registro de riesgos

| ID   | Riesgo (hallazgo)                                  | Activo                              | Amenaza                          | P   | I   | Nivel       | Tratamiento                              | Estado                               | Riesgo residual        | Controles A.\* |
| ---- | -------------------------------------------------- | ----------------------------------- | -------------------------------- | --- | --- | ----------- | ---------------------------------------- | ------------------------------------ | ---------------------- | -------------- |
| R-01 | Secretos productivos en historia de Git (EMT-C04)  | Credenciales (JWT, DGA, Resend, BD) | Suplantación / acceso total      | A   | A   | **Crítico** | Mitigar (rotar + purgar)                 | **Pendiente**                        | Crítico hasta rotación | A.5.17, A.8.24 |
| R-02 | Datos regulatorios DGA en repo (EMT-C05)           | Datos cliente/DGA                   | Divulgación                      | M   | A   | Alto        | Mitigar (purga historia)                 | Parcial (fuera de HEAD)              | Medio                  | A.5.34, A.8.12 |
| R-03 | IDOR telemetría v1/v2 (EMT-C01)                    | Telemetría multi-tenant             | Acceso entre clientes            | A   | A   | **Crítico** | Mitigar                                  | **Resuelto**                         | Bajo                   | A.5.15, A.8.3  |
| R-04 | Bypass cold-room `?siteIds` (EMT-C02)              | Telemetría sitios                   | Acceso entre clientes            | A   | A   | **Crítico** | Mitigar                                  | Resuelto                             | Bajo                   | A.5.15, A.8.3  |
| R-05 | Endpoints sin autenticación (EMT-C03)              | API datos/catálogo                  | Acceso/escritura anónima         | A   | A   | **Crítico** | Mitigar                                  | Resuelto                             | Bajo                   | A.8.5, A.5.15  |
| R-06 | CRUD global credenciales SNIA (DGA Informantes)    | Credenciales DGA                    | Sabotaje regulatorio             | M   | A   | **Crítico** | Mitigar (SuperAdmin)                     | Resuelto                             | Bajo                   | A.5.15, A.5.17 |
| R-07 | IDOR v2 DGA/bitácora (dato, review-queue, equipos) | Datos DGA                           | Acceso/alteración entre clientes | M   | A   | Alto        | Mitigar                                  | Resuelto                             | Bajo                   | A.5.15, A.8.3  |
| R-08 | `linux-db-api` fail-open + comandos PLC (EMT-H02)  | Plano de control OT                 | Comando no autorizado            | M   | A   | Alto        | Mitigar (fail-closed)                    | Resuelto                             | Bajo                   | A.8.5, A.8.9   |
| R-09 | Lockout evadible / fuerza bruta (EMT-H08)          | Autenticación                       | Fuerza bruta                     | M   | M   | Alto        | Mitigar (backoff)                        | Resuelto                             | Bajo                   | A.8.5          |
| R-10 | Ventana/reuso de OTP (EMT-H09/H11)                 | Autenticación                       | Adivinación OTP                  | B   | M   | Medio       | Mitigar (TTL + 1 uso)                    | Resuelto                             | Bajo                   | A.8.5          |
| R-11 | Enumeración de usuarios (EMT-H10)                  | Cuentas                             | Reconocimiento/phishing          | M   | B   | Medio       | Mitigar (uniforme + rate-limit)          | Resuelto                             | Bajo                   | A.8.5, A.8.16  |
| R-12 | gRPC sin auth/TLS (EMT-H01)                        | Ingesta de datos                    | Inyección/escucha                | M   | A   | Alto        | Mitigar (firewall) + planificar (mTLS)   | Pendiente / **controlado** (interno) | Medio                  | A.8.20, A.8.24 |
| R-13 | Puertos expuestos a 0.0.0.0 (EMT-H03)              | Servicios/BD                        | Exposición a Internet            | M   | A   | Alto        | Mitigar (loopback)                       | Resuelto                             | Bajo                   | A.8.20, A.8.9  |
| R-14 | Credenciales hardcodeadas infra-db (EMT-H04)       | Credenciales BD                     | Acceso a BD                      | M   | A   | Alto        | Mitigar (env)                            | Resuelto (rotar histórico)           | Medio                  | A.5.17, A.8.9  |
| R-15 | Deploy a prod sin aprobación (EMT-H12)             | Cadena de despliegue                | Cambio no autorizado             | M   | A   | Alto        | Mitigar (gate)                           | Resuelto                             | Bajo                   | A.8.32         |
| R-16 | `sitio_id` no validado al crear (EMT-H05)          | Integridad de datos                 | Contaminación cross-tenant       | M   | M   | Medio       | Mitigar                                  | Resuelto                             | Bajo                   | A.5.15, A.8.3  |
| R-17 | CORS abierto                                       | API                                 | Abuso cross-origin               | B   | M   | Medio       | Mitigar (allowlist)                      | Resuelto (Rust pend.)                | Bajo                   | A.8.20         |
| R-18 | Contenedores como root / imágenes `:latest`        | Contenedores                        | Escalada / build no reproducible | B   | M   | Medio       | Mitigar (Node listo; nginx/digest pend.) | Parcial                              | Medio                  | A.8.9, A.5.23  |
| R-19 | TLS a BD ausente                                   | Tráfico BD                          | Escucha                          | B   | M   | Bajo        | **Aceptar** (mismo host)                 | Aceptado                             | Bajo                   | A.8.24         |
| R-20 | DoS de ingesta                                     | Disponibilidad ingesta              | Agotamiento de recursos          | B   | M   | Bajo        | **Aceptar** (capacidad)                  | Aceptado                             | Bajo                   | A.8.6          |
| R-21 | `auth-api/node_modules` y binarios versionados     | Cadena de suministro                | Componentes no auditados         | B   | B   | Bajo        | Mitigar                                  | Resuelto                             | Bajo                   | A.8.8, A.5.23  |

## Riesgos aceptados (acta de aceptación — 6.1.3 e)

Los riesgos **R-19 (TLS a BD)** y **R-20 (DoS de ingesta)**, y el carácter **controlado** de **R-12 (gRPC interno)**, se **aceptan** según el contexto de despliegue actual (red interna, base de datos en el mismo host, etapa de desarrollo, naturaleza de capacidad). Revisión obligatoria ante: exposición a redes no confiables, migración de la base de datos a otro host, o paso a producción ampliada.

_Aceptado por:_ **Dylan Maverick Ruiz Ponce — Desarrollador de Sistemas, Emeltec** — 14/06/2026.
