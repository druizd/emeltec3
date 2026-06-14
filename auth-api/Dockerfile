FROM node:24-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY . .
# Correr como usuario no-root (incluido en la imagen node).
USER node
EXPOSE 3001
CMD ["node", "src/server.js"]
