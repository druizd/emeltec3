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
# Scripts CJS operativos (import histórico DGA, backfill contadores, etc).
# Se ejecutan via `docker compose exec main-api node /app/scripts/<X>.js`.
COPY scripts ./scripts
COPY migrations ./migrations
EXPOSE 3000
CMD ["node", "dist/server.js"]
