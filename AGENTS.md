# Emeltec Cloud — Frontend Angular

## Project

**Emeltec Cloud** (`cloud.emeltec.cl`) — SaaS IIoT platform for industrial variable monitoring (water, electricity, industrial processes) and DGA (Dirección General de Aguas) regulatory compliance. Chilean B2B, primary language: **Spanish**.

Stack: **Angular 21**, standalone components, signals, Tailwind CSS v4, Chart.js, Lucide Angular, Material Symbols.

---

## Design System

This project follows the **Emeltec Design System**. The full source bundle lives in the repo at `docs/design-system/`.

Design tokens (colors, typography, spacing), sidebar module structure, badge and
card patterns, the well diagram spec, and icon mappings live with the frontend
package, in `frontend-angular/AGENTS.md`. Read that file before touching UI.

(Referencia intencionalmente sin `@` — un import inlinearía el archivo en cada
sesión, que es justamente lo que este split evita.)

---

## Copy Rules

- Language: Chilean Spanish. Technical terms stay in Spanish.
- Action labels: infinitive verbs ("Descargar", "Aplicar", "Ver en DGA")
- Status badges: Sentence case ("Enviado", "Pendiente", "Rechazado")
- Metric labels: ALL CAPS ("NV. FREÁTICO [M]", "CAUDAL [L/S]")
- No emoji in the app UI
- Date format: `DD/MM/YYYY HH:MM`
