# Build stage: pnpm workspaces + Angular productivo
FROM node:24-alpine AS build
WORKDIR /app

# pnpm via corepack — versión fija en root package.json (packageManager field)
RUN corepack enable

# Manifests + lockfile primero (mejor cache).
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY shared/package.json ./shared/
COPY frontend-angular/package.json ./frontend-angular/
COPY main-api/package.json ./main-api/
COPY auth-api/package.json ./auth-api/

RUN pnpm install --frozen-lockfile

# Fuentes solo de lo necesario para build del frontend
COPY shared/ ./shared/
COPY frontend-angular/ ./frontend-angular/

WORKDIR /app/frontend-angular
RUN pnpm run build

# Production stage: nginx sirve el bundle
FROM nginx:alpine
COPY --from=build /app/frontend-angular/dist/frontend-angular/browser /usr/share/nginx/html
COPY frontend-angular/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
