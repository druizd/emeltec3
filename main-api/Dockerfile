################################################################
# main-api — build TypeScript en stage de build, runtime slim.
################################################################
ARG NODE_VERSION=22-alpine

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
COPY migrations ./migrations
EXPOSE 3000
CMD ["node", "dist/server.js"]
