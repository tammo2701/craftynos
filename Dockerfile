FROM node:24-alpine

WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev --no-audit --no-fund

COPY src ./src
COPY public ./public

ENV NODE_ENV=production \
    PORT=8080 \
    DATA_DIR=/data \
    CRAFTY_ROOT=/crafty

VOLUME /data
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/api/health || exit 1

# Läuft als root, damit auf die von Crafty (root) angelegten Server-Dateien geschrieben werden kann.
CMD ["node", "src/server.js"]
