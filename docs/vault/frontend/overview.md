# Frontend — Overview

**Framework:** Angular 21, standalone components, signals
**Estilos:** Tailwind CSS v4
**Gráficos:** Chart.js
**Iconos:** Material Symbols Outlined (CDN) + Lucide Angular
**Repo:** `frontend-angular/`

---

## Estructura de carpetas

```
frontend-angular/src/app/
  app.config.ts           — proveedores globales, HttpClient, Router
  app.routes.ts           — rutas lazy-loaded
  components/
    chart-card/           — wrapper de gráfico Chart.js
    layout/
      header/             — top bar con logo y avatar
      sidebar/            — navegación por módulos y empresas
      layout.ts           — shell con sidebar 248px + contenido
      view-as-banner/     — banner de impersonación (SuperAdmin)
    metric-card/          — tarjeta de métrica con valor numérico
    ui/                   — componentes UI reutilizables
  guards/
    auth.guard.ts         — redirige a /login si no autenticado
  interceptors/
    auth.interceptor.ts   — agrega JWT a cada request
    two-factor.interceptor.ts — intercepta 403 de step-up 2FA
  pages/
    login/                — pantalla de login + OTP
    dashboard/            — dashboard general de sitios
    companies/            — detalle de sitio (módulo principal)
    administration/       — gestión de usuarios y empresas
    dga-review/           — revisión manual de slots DGA
    profile/              — perfil del usuario
    ventisqueros/         — módulo salas frías
    legal/                — términos y privacidad
  services/               — servicios HTTP (un archivo por dominio)
  shared/                 — utilidades compartidas (RUT, timezone, etc.)
```

---

## Módulo de páginas `companies/`

El módulo central de la app. Muestra el detalle de un sitio. El tipo de sitio determina el componente de detalle:

| Componente                          | `tipo_sitio` / módulo | Descripción                                                  |
| ----------------------------------- | --------------------- | ------------------------------------------------------------ |
| `company-site-water-detail`         | Agua (pozo)           | Dashboard pozo: telemetría, DGA, alertas, análisis, bitácora |
| `company-site-vertiente-detail`     | Agua (vertiente)      | Similar a water-detail para sitios de vertiente              |
| `company-site-electric-detail`      | Eléctrico             | Consumo eléctrico                                            |
| `company-site-riles-detail`         | Riles                 | Generación de riles                                          |
| `company-site-canal-detail`         | Canal                 | Medición en canales                                          |
| `company-site-pasteurizador-detail` | Proceso/Pasteurizador | Variables de pasteurización                                  |
| `company-site-coming-soon-detail`   | Otros                 | Placeholder                                                  |

### Tabs dentro de `company-site-water-detail`

| Tab       | Componentes                                                      |
| --------- | ---------------------------------------------------------------- |
| Monitor   | Gráficos en tiempo real, diagrama de pozo, KPIs                  |
| DGA       | Tabla de slots `dato_dga`, estado de envíos                      |
| Alertas   | `water-detail-alertas/` — bandeja, configuración, histórico      |
| Análisis  | `water-detail-analisis/` — calendario, métricas, predictivo      |
| Operación | `water-detail-operacion/` — gráficos históricos, resumen período |
| Bitácora  | `water-detail-bitacora/` — incidencias, documentos, ficha sitio  |

---

## Vistas por rol

La página `companies/` tiene vistas separadas por rol:

| Vista                       | Rol        | Descripción                 |
| --------------------------- | ---------- | --------------------------- |
| `companies-superadmin-view` | SuperAdmin | Ve todas las empresas       |
| `companies-admin-view`      | Admin      | Ve su empresa               |
| `companies-gerente-view`    | Gerente    | Ve su empresa o sub_empresa |
| `companies-cliente-view`    | Cliente    | Vista de solo lectura       |

---

## Servicios HTTP (`services/`)

| Servicio                    | Descripción                              |
| --------------------------- | ---------------------------------------- |
| `auth.service.ts`           | Login, logout, OTP, refresh, JWT storage |
| `company.service.ts`        | Empresas, sub_empresas, sitios           |
| `dga.service.ts`            | Slots DGA, revisión, pozo config         |
| `alerta.service.ts`         | Alertas, eventos                         |
| `analisis.service.ts`       | Análisis predictivo y de salud           |
| `bitacora-sitio.service.ts` | Bitácora de sitio                        |
| `incidencia.service.ts`     | Incidencias                              |
| `documento.service.ts`      | Documentos adjuntos                      |
| `user.service.ts`           | CRUD de usuarios                         |
| `administration.service.ts` | Administración (usuarios, empresas)      |
| `cold-room.service.ts`      | Salas frías                              |
| `two-factor.service.ts`     | Step-up 2FA                              |
| `audit-log.service.ts`      | Log de auditoría                         |
| `shortcut.service.ts`       | Paleta de shortcuts                      |

---

## Design System

Ver `AGENTS.md` para especificación completa. Resumen:

| Token              | Valor     | Uso                     |
| ------------------ | --------- | ----------------------- |
| `--teal-400`       | `#0DAFBD` | Color primario, activos |
| `--bg-body`        | `#F0F2F5` | Fondo de la app         |
| `--bg-surface`     | `#FFFFFF` | Cards, panels           |
| `--text-primary`   | `#1E293B` | Títulos                 |
| `--text-secondary` | `#64748B` | Texto de apoyo          |

**Tipografía:**

- Josefin Sans — headings, labels uppercase
- DM Sans — body text
- JetBrains Mono — valores numéricos, datos

---

## Componentes UI reutilizables

| Componente                | Descripción                                    |
| ------------------------- | ---------------------------------------------- |
| `kpi-card`                | Tarjeta de KPI con valor teal + JetBrains Mono |
| `chart-card`              | Wrapper de Chart.js con skeleton               |
| `site-card`               | Card de sitio en el dashboard                  |
| `well-stat-card`          | Estadística de pozo                            |
| `confirm-dialog`          | Dialog de confirmación                         |
| `two-factor-dialog`       | Dialog de 2FA inline                           |
| `session-expiry-warning`  | Aviso de expiración de sesión                  |
| `shortcut-palette`        | Paleta de atajos de teclado                    |
| `skeleton` / `*-skeleton` | Estados de carga                               |

---

## Sidebar — estructura de navegación

```
[Módulo (tipo_empresa)]
  EMPRESA (uppercase)
    └── Sitio / Instalación
```

Módulos: Consumo de Agua, Generación de Riles, Variables de Proceso, Consumo Eléctrico, Maletas Piloto.

---

## Ver también

- [[../main-api/auth]] — roles y permisos que controlan las vistas
- [[../main-api/overview]] — API que consume el frontend
- [[../db/empresa-sitio]] — jerarquía que estructura la navegación
