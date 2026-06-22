# Skill Registry — emeltec3

**Generated**: 2026-06-21
**Project**: emeltec3 (Emeltec Cloud)

## Project Conventions (source-of-truth files)

- `AGENTS.md` (root) — single source of truth for all AI tools. Stack, Emeltec Design System (colors/type/spacing/tokens), copy rules (Chilean Spanish), icon mappings.
- `CLAUDE.md` (root) — points to AGENTS.md.
- `docs/design-system/` — full design bundle (README, colors_and_type.css, ui_kits prototypes).
- Global `~/.claude/CLAUDE.md` — commit rules (conventional only, NO AI attribution), never build after changes, strict TDD enabled.

## User Skills (trigger table)

| Skill         | Trigger                                                 | Applies to                   |
| ------------- | ------------------------------------------------------- | ---------------------------- |
| go-testing    | Go tests, Bubbletea TUI testing, teatest, test coverage | `grpc-pipeline/` (Go module) |
| skill-creator | Creating new AI skills                                  | meta                         |

## Compact Rules (inject into sub-agent prompts as "## Project Standards")

### All code

- Language: Chilean Spanish for UI copy + technical terms. Code/identifiers English.
- Conventional commits only. NEVER add Co-Authored-By or AI attribution.
- NEVER build after changes (user rule). Run tests/lint, not build.
- Formatter: prettier repo-wide. Linter: eslint per package.

### Frontend (frontend-angular)

- Angular 21 standalone components + signals. Tailwind v4. NO NgModules.
- Follow Emeltec Design System tokens (src/styles.css): teal #0DAFBD primary, fonts Josefin Sans (display) / DM Sans (body) / JetBrains Mono (data).
- Metric labels ALL CAPS 10px. Data values JetBrains Mono. Cards: white, 1px #E2E8F0, radius 8-12px.
- Status badges: Sentence case (Enviado/Pendiente/Rechazado) with colored dot. Date format DD/MM/YYYY HH:MM. No emoji in UI.
- NO test runner configured — strict TDD NOT viable here yet.

### Backend Node/TS (main-api, auth-api, shared)

- main-api: vitest. auth-api: node:test. Strict TDD viable — write failing test first.
- Type-safe (tsc). Lint eslint.

### Pipeline (grpc-pipeline, Go)

- go test built-in. Load `go-testing` skill BEFORE writing Go tests.
- Strict TDD viable.

## Notes

- Strict TDD Mode ENABLED globally; applies only where a test runner exists (backend + Go), NOT frontend-angular.
