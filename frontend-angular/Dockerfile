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

# Pre-compress: genera .br y .gz paralelos para brotli_static + gzip_static.
# find/gzip ya vienen en alpine; brotli se instala solo en el stage de build.
RUN apk add --no-cache brotli \
 && find /app/frontend-angular/dist/frontend-angular/browser \
         -type f \
         -regex '.*\.\(js\|css\|html\|json\|svg\|woff2\|woff\|ttf\|otf\)$' \
         -exec brotli --best --keep {} \; \
         -exec gzip  --best --keep {} \;

# Production stage: fholzer/nginx-brotli incluye ngx_http_brotli_filter_module
# y ngx_http_brotli_static_module compilados. Imagen basada en nginx:mainline-alpine,
# tamaño ~30 MB (+0 MB respecto a nginx:alpine que es ~25 MB).
# Impacto: cambio de imagen base; no afecta el proceso de build ni puertos.
FROM fholzer/nginx-brotli:v1.28.3
COPY --from=build /app/frontend-angular/dist/frontend-angular/browser /usr/share/nginx/html
COPY frontend-angular/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
# SIN CMD propio: la imagen fholzer trae ENTRYPOINT nginx con sus argumentos.
# Redefinir CMD ["nginx", ...] producía `nginx nginx -g ...` → crash-loop
# (incidente 17-07-2026).
