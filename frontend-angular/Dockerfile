# Build stage: workspaces npm + Angular productivo
FROM node:20-alpine AS build
WORKDIR /app

# Manifests primero para mejor cache de capa npm install.
# No copiamos package-lock.json: fue generado en Windows y omite binarios
# nativos Linux (lightningcss-linux-x64-musl, etc). Resolver desde registry.
COPY package.json ./
COPY shared/package.json ./shared/
COPY frontend-angular/package.json ./frontend-angular/
COPY main-api/package.json ./main-api/
COPY auth-api/package.json ./auth-api/

RUN npm install --no-package-lock --no-audit --no-fund

# Fuentes solo de lo necesario para build del frontend
COPY shared/ ./shared/
COPY frontend-angular/ ./frontend-angular/

WORKDIR /app/frontend-angular
RUN npm run build

# Production stage: nginx sirve el bundle
FROM nginx:alpine
COPY --from=build /app/frontend-angular/dist/frontend-angular/browser /usr/share/nginx/html
COPY frontend-angular/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
