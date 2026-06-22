# Emeltec Design System

## Company Overview

**Emeltec** is a Chilean B2B IIoT (Industrial Internet of Things) company operating the cloud platform **Emeltec Cloud** (cloud.emeltec.cl). Their tagline is *"Experiencia & Flexibilidad"*.

The platform serves as a SaaS solution for industrial variable monitoring, with a strong focus on:
- **Water resource monitoring** (groundwater wells, flow rates, static/dynamic levels)
- **Environmental regulatory compliance** — specifically DGA (Dirección General de Aguas, Chile's water authority) report submission and tracking
- **Historical data downloads** for audits and environmental reports
- **Real-time operational dashboards** for plant operators and management

### Target Users
- **Plant Operators** (Operarios de Planta): need real-time data, status at a glance, shift-based reporting
- **Management (Gerencia)**: need aggregated metrics, compliance status, data export

### Products Represented

| Product | URL | Description |
|---|---|---|
| Emeltec Cloud | cloud.emeltec.cl | SaaS platform for IIoT monitoring and DGA compliance |

### Source Materials
- Logo file: `uploads/Logo-Emeltec_250x@2x.avif`
- UI screenshots: `uploads/Captura de pantalla 2026-04-26 214323.png` through `214444.png` (8 screenshots of cloud.emeltec.cl)
- No Figma files or codebase provided

---

## Content Fundamentals

### Language
- Primary language: **Spanish** (Chilean Spanish)
- Technical terms remain in Spanish (e.g., "Nivel Freático", "Caudal", "Totalizador")
- DGA (Dirección General de Aguas) is a regulatory body, always capitalized

### Tone
- **Professional and direct** — no marketing fluff in the app
- **Data-first** — labels are short, values are prominent
- **Operator-friendly** — uses clear field terminology
- No emoji in the current UI (except possibly status indicators)
- Third-person for system status messages: *"Último dato en dashboard"*, *"Aceptado"*
- Action labels are infinitive verbs: *"Descargar"*, *"Aplicar"*, *"Ver en DGA"*

### Casing
- Section headers: **Title Case** in Spanish ("Panel de Monitoreo", "Consumo por Turnos")
- Navigation: Title Case ("Dashboard", "Dynamic")
- Status badges: Sentence case ("Enviado", "Pendiente", "Rechazado")
- Metric labels: ALL CAPS small ("NV. FREÁTICO [M]", "CAUDAL [L/S]")

### Copy Examples
- "Últimas 10 mediciones" — concise, lowercase for supporting copy
- "Datos en tiempo real (actualización cada minuto)" — parenthetical clarification
- "Descarga los datos minuto a minuto del período elegido en el selector mensual." — full sentence for descriptions in modals
- "Sin datos" — simple placeholder

---

## Visual Foundations

### Colors

**Current (Light Mode)**
- Primary teal: `#1A7A8E` (brand teal from logo)
- Sidebar/nav bg: `#FFFFFF`
- App background: `#F5F7FA`
- Teal gradient banner (real-time data): from `#1A7A8E` to `#25AFBE`
- Success / Enviado: `#22C55E`
- Warning / Pendiente: `#F59E0B`
- Danger / Rechazado: `#EF4444`
- Purple CTA: `#7C3AED`
- Magenta CTA: `#EC4899`
- Text primary: `#1A202C`
- Text secondary: `#6B7280`

**Redesigned Dark Mode (this system)**
See `colors_and_type.css` for full token system.

### Typography

**Current UI fonts** (from screenshots, appear to be):
- Body: A clean geometric sans-serif (likely Inter or similar)
- Data values: Regular weight, larger scale
- Substitution used in this design system: **Space Grotesk** (Google Fonts) for headings + UI, **DM Sans** for body text, **JetBrains Mono** for data values/codes

### Backgrounds
- Current: flat white sidebar, very light gray app body
- Redesign direction: deep dark navy/slate backgrounds with subtle surface elevation
- No textures or images in the app background
- Teal gradient used for the real-time data banner — this is a key brand visual motif

### Cards
- Current: white cards, very subtle box shadow, light border `#E5E7EB`
- Redesign: dark surface cards with `1px` border, subtle inner glow on active/focus
- Rounded corners: `8px` standard, `12px` for featured/metric cards
- No colored left-border accent pattern

### Spacing
- Dense, information-rich layout
- 16px base grid
- Sidebar: 240px wide (collapsible to 60px)
- Top nav: 52px tall

### Animations
- Current UI: minimal, appears to use simple CSS transitions
- No bouncy or spring animations observed
- Fade-in for new data, subtle slide for sidebar collapse
- Easing: ease-in-out, ~200ms

### Hover/Press States
- Sidebar items: background highlight on hover (light teal tint)
- Buttons: slight darkening
- Cards: no lift/shadow change observed

### Iconography
See ICONOGRAPHY section below.

### Borders & Shadows
- Cards: `box-shadow: 0 1px 4px rgba(0,0,0,0.06)`
- No heavy drop shadows
- Bottom-border separator under top nav (teal `3px` accent line visible)

### Imagery
- No photography or illustrations in the app
- Icon-based: small informational icons in modals (calendar, cloud, etc.)
- Charts are the primary visual — line charts and bar charts in teal/blue tones

### Corner Radii
- Buttons: `6px`
- Cards: `8px`
- Badges/pills: `999px` (fully rounded)
- Input fields: `6px`
- Modal: `12px`

---

## Visual Foundations — Redesign Direction (Dark Mode)

The redesign adopts a **dark industrial dashboard** aesthetic:
- Deep navy/slate background layers create depth without heavy shadows
- Electric teal as the primary accent — vivid against dark backgrounds
- Data values rendered in large, monospaced type for instant readability
- Shift cards use the brand teal-to-green palette
- Status system (Enviado/Pendiente/Rechazado) rendered as colored dot + pill badges
- Charts: teal strokes on dark grid, minimal gridlines

---

## Iconography

The current Emeltec Cloud UI uses **outline-style icons** (appears to be a mix of Bootstrap Icons or similar CDN set). No custom icon font was found in the provided materials.

**Substitution used in this design system:** [Lucide Icons](https://lucide.dev) — consistent 2px stroke, rounded, clean. Loaded via CDN.

```html
<script src="https://unpkg.com/lucide@latest/dist/umd/lucide.min.js"></script>
```

**Common icons used in the platform:**
- `gauge` — flow rate / monitoring
- `droplets` — water level
- `bar-chart-2` — totalizador / charts
- `clock` — timestamps / shifts
- `download` — export / descargar
- `check-circle` — Enviado/success
- `alert-circle` — Pendiente/warning
- `x-circle` — Rechazado/error
- `building-2` — companies/instalaciones
- `settings` — configuration
- `calendar` — date range picker

Assets copied:
- `assets/logo.avif` — Emeltec wordmark + tagline (AVIF format)

---

## File Index

```
/
├── README.md                    — This file
├── SKILL.md                     — Agent skill definition
├── colors_and_type.css          — Full CSS token system (colors, type, spacing)
├── assets/
│   └── logo.avif                — Emeltec logo (250px @2x)
├── preview/
│   ├── colors-brand.html        — Brand color swatches
│   ├── colors-dark-bg.html      — Dark mode background scale
│   ├── colors-semantic.html     — Semantic status colors
│   ├── type-scale.html          — Typography scale
│   ├── type-data.html           — Data/metric typography
│   ├── spacing-tokens.html      — Spacing + radius tokens
│   ├── shadows-elevation.html   — Elevation/shadow system
│   ├── comp-buttons.html        — Button variants
│   ├── comp-badges.html         — Status badges and pills
│   ├── comp-cards-metric.html   — Metric KPI cards
│   ├── comp-nav-sidebar.html    — Sidebar navigation
│   ├── comp-topnav.html         — Top navigation bar
│   ├── comp-table.html          — Data table rows
│   └── brand-logo.html          — Logo usage
└── ui_kits/
    └── emeltec-cloud/
        ├── README.md
        └── index.html           — Full interactive prototype
```
