# Emeltec Cloud — UI Kit

## Overview
High-fidelity dark-mode redesign of the Emeltec Cloud platform (cloud.emeltec.cl).  
Built as a click-through React prototype covering the core monitoring workflow.

## Screens
1. **Dashboard** — Instalaciones grid across all companies
2. **Company Detail** — Aguas Cachantún with 3 installation cards
3. **Monitoring — DGA Tab** — Static + Dynamic levels, quick actions, status summary
4. **Monitoring — Operación Tab** — Real-time data banner + shift consumption cards
5. **Download Modal** — Descargar Datos Históricos

## Design Tokens
Uses `../../colors_and_type.css` for all CSS variables.

## Components
- `Sidebar.jsx` — Left nav with brand, user, search, company list
- `TopNav.jsx` — Tab bar + WIP badge + site header with status chips
- `DashboardScreen.jsx` — Installation card grid
- `CompanyScreen.jsx` — Company detail + installation cards
- `MonitorScreen.jsx` — DGA + Operación tabs with metric cards + table
- `DownloadModal.jsx` — 3-option download dialog

## Fonts
- Josefin Sans (headings)
- DM Sans (body)
- JetBrains Mono (data values)

## Icons
Lucide Icons via CDN.
