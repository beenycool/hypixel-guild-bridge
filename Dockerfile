# Stage 1: Build native dependencies
FROM node:22-bookworm-slim AS builder

# Install build dependencies for native modules (canvas)
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

# Copy package files
COPY package*.json ./

# Install ALL dependencies (including devDeps for build)
RUN npm ci

# Build TypeScript
RUN npm run build

# Remove devDependencies after build
RUN npm prune --omit=dev

# Stage 2: Runtime
FROM node:22-bookworm-slim

LABEL authors="aidn5, HyxonQz"
ENV NODE_ENV=production
ENV npm_config_before=null
WORKDIR /app

# Install runtime libraries for canvas
RUN apt-get update && apt-get install -y \
    libcairo2 \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libjpeg62-turbo \
    libgif7 \
    librsvg2-2 \
    && rm -rf /var/lib/apt/lists/*

# Copy node_modules from builder (production only after prune)
COPY --from=builder /app/node_modules ./node_modules

# Copy build output from builder
COPY --from=builder /app/build ./build

# Copy only the necessary source files
COPY --from=builder /app/package.json ./
COPY --from=builder /app/resources ./resources
COPY --from=builder /app/plugins ./plugins

# Create necessary directories and set permissions
RUN mkdir -p logs config/backup plugins && \
    chown -R node:node /app

# Use non-root user for security
USER node

ENV NODE_OPTIONS="--max-old-space-size=512 --expose-gc --optimize-for-size"

RUN printf '#!/bin/sh\nif [ -f /app/build/index.js ]; then exec node /app/build/index.js "$@"; else exec node --import tsx/esm /app/index.ts "$@"; fi\n' > /app/entrypoint.sh && chmod +x /app/entrypoint.sh
ENTRYPOINT ["/app/entrypoint.sh"]
