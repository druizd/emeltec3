---
aliases: [home, index, inicio]
tags: [vault/home]
---

# Emeltec Cloud — Base de conocimiento

> [!abstract] Qué es este proyecto
> SaaS IIoT chileno para monitoreo industrial de agua, electricidad y procesos, con cumplimiento regulatorio DGA. Stack: Angular 21 + Node.js + TimescaleDB + Rust gRPC.

---

## Mapa del conocimiento

```mermaid
graph LR
    HOME([🏠 HOME])

    subgraph INFRA [Infraestructura]
        SVC[[servicios]]
        DEP[[deployment]]
        ENV[[variables-entorno]]
    end

    subgraph DB [Base de datos]
        SCH[[schema]]
        QRY[[queries]]
        MIG[[migraciones]]
    end

    subgraph FTP [Pipeline FTP]
        FD[[ftp-dispositivos]]
        FP[[ftpprocessor]]
    end

    subgraph DGA [Pipeline DGA]
        DS[[dga-setup]]
        DW[[dga-workers]]
    end

    REF[[quick-ref]]
    PEN[[pendientes]]

    HOME --> SVC
    HOME --> SCH
    HOME --> FD
    HOME --> DS
    HOME --> REF
    HOME --> PEN

    SVC --> DEP
    SVC --> ENV
    SCH --> QRY
    SCH --> MIG
    FD --> FP
    DS --> DW
```

---

## Navegación por área

> [!info] Infraestructura
> - [[servicios]] — containers, puertos, arquitectura
> - [[deployment]] — deploy, migraciones, rollback
> - [[variables-entorno]] — .env, flags workers, secrets

> [!tip] Base de datos
> - [[schema]] — tablas, hypertables, continuous aggregates
> - [[queries]] — SQL frecuentes por categoría
> - [[migraciones]] — historial de cambios al schema

> [!example] Pipeline FTP
> - [[ftp-dispositivos]] — REGADIO / CASINO: datos, archivos pendientes, gotchas
> - [[ftpprocessor]] — servicio Go: parser, serial, gRPC

> [!example] Pipeline DGA
> - [[dga-setup]] — configurar sitio DGA, estado actual de pozos
> - [[dga-workers]] — preseed, fill, submission, reconciler

> [!tip] Referencia rápida
> - [[quick-ref]] — SSH, SQL inline, logs, ftpprocessor

> [!todo] Backlog
> - [[pendientes]] — tareas priorizadas FTP + DGA + deuda técnica

---

## Arquitectura de un vistazo

```mermaid
graph TD
    A[Dispositivos FTP\nREGADIO · CASINO] -->|CSV raw| B

    subgraph Windows Azure
        B[ftpprocessor Go]
    end

    subgraph Linux Azure 145.190.8.19
        B -->|gRPC :50061| C[ftpconsumer Rust]
        C -->|INSERT| D[(TimescaleDB\ntelemetry_platform)]
        D --> E[main-api Node.js]
        E -->|DGA workers| F[dato_dga]
        F -->|submission ⛔| G[SNIA MOP]
        E --> H[frontend-angular]
    end
```

---

## Estado del sistema

> [!success] Datos en DB
> - **REGADIO** (25120112) Mayo 2026 → ~19,336 filas en `equipo`
> - **CASINO** (25120225) Mayo 2026 → ~730 filas en `equipo`

> [!warning] DGA — acción requerida
> - REGADIO (S131): solo 3 filas en `dato_dga` → verificar `dga_activo` en `pozo_config`
> - CASINO: sin `obra_dga` → no puede reportar a SNIA hasta que empresa obtenga código

> [!danger] Submission DGA deshabilitada
> `ENABLE_DGA_SUBMISSION_WORKER=false` — mantener hasta autorización de gerencia
