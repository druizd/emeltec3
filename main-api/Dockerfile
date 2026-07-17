################################################################
# main-api — build TypeScript en stage de build, runtime slim.
################################################################
ARG NODE_VERSION=24-alpine

# ── Stage 1: dependencias (con dev) ────────────────────────────
FROM node:${NODE_VERSION} AS deps
WORKDIR /app
COPY package*.json ./
RUN npm install --no-audit --no-fund

# ── Stage 2: build TS → dist/ ──────────────────────────────────
FROM node:${NODE_VERSION} AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package*.json tsconfig.json tsconfig.test.json eslint.config.js ./
COPY src ./src
RUN npm run build

# ── Stage 3: runtime con sólo prod deps ────────────────────────
FROM node:${NODE_VERSION} AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm install --omit=dev --no-audit --no-fund && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY --from=build /app/src/grpc ./dist/grpc
# Servicios CJS legacy (emailService.js) que no están compilados en dist/
# pero el código TS los carga via require dinámico (ver dga/notifier.ts).
COPY --from=build /app/src/services ./src/services
# Config CJS (db.js, env.js) que las migraciones requieren en runtime
# (migrations/run.js y cada migración usan ../src/config/db).
COPY --from=build /app/src/config ./src/config
# Assets embebidos en correos transaccionales (logo Resend inline).
COPY assets ./assets
# Scripts CJS operativos (import histórico DGA, backfill contadores, etc).
# Se ejecutan via `docker compose exec main-api node /app/scripts/<X>.js`.
COPY scripts ./scripts
COPY migrations ./migrations
# Correr como usuario no-root (incluido en la imagen node). La app solo lee
# sus archivos (logs a stdout, datos a BD/Redis/Azure), así que no necesita root.
USER node
EXPOSE 3000
# Migraciones ANTES del server: run.js aplica pendientes (tabla
# schema_migrations + advisory lock) y aborta el arranque si alguna falla —
# evita servir con schema desactualizado (incidente 17-07-2026).
CMD ["sh", "-c", "node migrations/run.js && node dist/server.js"]
