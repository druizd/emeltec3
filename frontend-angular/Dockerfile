# Build stage: workspaces npm + Angular productivo
FROM node:20-alpine AS build
WORKDIR /app

# Manifests primero para mejor cache de capa npm install
COPY package.json package-lock.json* ./
COPY shared/package.json ./shared/
COPY frontend-angular/package.json ./frontend-angular/
COPY main-api/package.json ./main-api/
COPY auth-api/package.json ./auth-api/

# npm install (no npm ci) para que regenere binarios opcionales por plataforma
RUN npm install --no-audit --no-fund

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
