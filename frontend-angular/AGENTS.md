# Emeltec Cloud — Frontend Angular · Design System

Referencia de diseño e implementación de UI. Se carga sólo al trabajar dentro de
`frontend-angular/`. Las reglas transversales del proyecto (idioma, formatos,
copy) viven en el `AGENTS.md` de la raíz.

---

## Design System

This project follows the **Emeltec Design System**. The full source bundle lives in the repo at `docs/design-system/`.

### Colors

| Token                       | Value     | Use                                                            |
| --------------------------- | --------- | -------------------------------------------------------------- |
| `--teal-400` / primary      | `#0DAFBD` | Brand primary, active states, teal accents                     |
| `--teal-500` / primary-dark | `#0899A5` | Active text on white, hover                                    |
| `--teal-700`                | `#04606A` | Gradient end, dark teal                                        |
| `--bg-body`                 | `#F0F2F5` | App background                                                 |
| `--bg-surface`              | `#FFFFFF` | Cards, panels, sidebar                                         |
| `--bg-subtle`               | `#F8FAFC` | Table headers, inner surfaces                                  |
| `--border-default`          | `#E2E8F0` | All borders                                                    |
| `--text-primary`            | `#1E293B` | Headings, primary labels                                       |
| `--text-secondary`          | `#64748B` | Supporting text                                                |
| `--text-muted`              | `#94A3B8` | Placeholders, uppercase labels                                 |
| Success / Enviado           | `#22C55E` | bg: `rgba(34,197,94,0.10)`, border: `rgba(34,197,94,0.25)`     |
| Warning / Pendiente         | `#FBBF24` | bg: `rgba(251,191,36,0.10)`, border: `rgba(251,191,36,0.25)`   |
| Danger / Rechazado          | `#F87171` | bg: `rgba(248,113,113,0.10)`, border: `rgba(248,113,113,0.25)` |

### Typography

| Role                | Font                                                                  | Usage                                             |
| ------------------- | --------------------------------------------------------------------- | ------------------------------------------------- |
| **Display / Brand** | `Josefin Sans` (variable, `/fonts/JosefinSans-VariableFont_wght.ttf`) | Headings, navigation labels, uppercase labels     |
| **Body**            | `DM Sans` (Google Fonts)                                              | All body text, descriptions, form labels          |
| **Data / Mono**     | `JetBrains Mono` (Google Fonts)                                       | All numeric values, codes, timestamps, table data |

Rules:

- Metric labels: `ALL CAPS`, `font-size: 10px`, `letter-spacing: 0.1em`, color: `#94A3B8`
- Data values: JetBrains Mono, large (24–32px), color: `#0DAFBD` for primary metric
- Section headers: Josefin Sans, uppercase, tight tracking
- Body copy: DM Sans, 13–15px

### Spacing & Layout

```
Sidebar width:   248px
Header height:   64px
Base grid:       16px
Card radius:     8px (standard), 12px (featured)
Button radius:   6px
Badge radius:    9999px (pill)
Card shadow:     0 1px 4px rgba(0,0,0,0.06)
Active glow:     0 0 0 1px rgba(13,175,189,0.25), 0 2px 8px rgba(13,175,189,0.15)
```

### Sidebar — Module Structure

Navigation is grouped by module type (NOT by company name). Modules map to `tipo_empresa` from the API:

| Module               | Icon (Material) | Color     | `tipo_empresa` |
| -------------------- | --------------- | --------- | -------------- |
| Consumo de Agua      | `water_drop`    | `#0DAFBD` | `'Agua'`       |
| Generación de Riles  | `waves`         | `#22C55E` | `'Riles'`      |
| Variables de Proceso | `memory`        | `#6366F1` | `'Proceso'`    |
| Consumo Eléctrico    | `bolt`          | `#F59E0B` | `'Eléctrico'`  |
| Maletas Piloto       | `rocket`        | `#F97316` | catch-all      |

Tree structure: **Module → Company (uppercase label) → Plant/Installation** (with vertical tree line).

### Status Badges

```css
/* Enviado */
background: #f0fdf4;
border: 1px solid #bbf7d0;
color: #16a34a;
/* Pendiente */
background: #fffbeb;
border: 1px solid #fde68a;
color: #d97706;
/* Rechazado */
background: #fef2f2;
border: 1px solid #fecaca;
color: #dc2626;
```

All badges: `border-radius: 9999px; padding: 3px 8px; font-size: 11px;` with a colored dot before the text.

### Cards — Pattern

White surface, 1px `#E2E8F0` border, `border-radius: 10–12px`, `box-shadow: 0 1px 4px rgba(0,0,0,0.06)`.
Active/primary metric card: teal border `1px solid rgba(13,175,189,0.35)` + teal glow shadow.
Table headers: `background: #F8FAFC`, uppercase labels in Josefin Sans.

### Well Diagram (Monitoring screen)

SVG component showing a cross-section of a water well:

- **Superficie line**: horizontal gray line at ground level, labeled "Superficie" on the left
- **Nivel Freático line**: teal dashed line at water table level, labeled "Nivel Freático"
- **Bracket**: right-side annotation showing depth from surface to freatic level in meters
- **Water fill**: teal gradient, shows fill % in white JetBrains Mono inside
- **Sensor**: orange marker at sensor depth, labeled "Sensor"
- **Soil**: dotted pattern texture on either side of the well casing

---

## Icons

Primary: **Material Symbols Outlined** (CDN in `index.html`).
Also available: **Lucide Angular** (`lucide-angular` v1.0.0 installed).

Common icon mappings:

- Water monitoring: `water_drop`, `waves`, `speed`
- Electrical: `bolt`, `power`
- Process: `memory`, `factory`
- DGA/compliance: `shield`, `check_circle`, `error`
- Navigation: `chevron_right`, `keyboard_double_arrow_left`, `grid_view`
- Actions: `download`, `sync`, `settings`, `logout`
