FROM node:22-bookworm-slim AS builder

RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    libcairo2-dev \
    libpango1.0-dev \
    libjpeg-dev \
    libgif-dev \
    librsvg2-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./

RUN npm ci

RUN npm run build

RUN npm prune --omit=dev

FROM node:22-bookworm-slim

LABEL authors="aidn5, HyxonQz"
ENV NODE_ENV=production
ENV npm_config_before=null
WORKDIR /app

RUN apt-get update && apt-get install -y \
    libcairo2 \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libjpeg62-turbo \
    libgif7 \
    librsvg2-2 \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/node_modules ./node_modules

COPY --from=builder /app/build ./build

COPY --from=builder /app/package.json ./
COPY --from=builder /app/resources ./resources

RUN mkdir -p logs config/backup && \
    chown -R node:node /app

USER node

ENV NODE_OPTIONS="--max-old-space-size=512 --expose-gc --optimize-for-size"

RUN printf '#!/bin/sh\nif [ -f /app/build/index.js ]; then exec node /app/build/index.js "$@"; else exec node --import tsx/esm /app/index.ts "$@"; fi\n' > /app/entrypoint.sh && chmod +x /app/entrypoint.sh
ENTRYPOINT ["/app/entrypoint.sh"]
