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

# Install production dependencies
RUN npm ci --omit=dev

# Stage 2: Tailscale download
FROM node:22-bookworm-slim AS tailscale

RUN apt-get update && apt-get install -y curl ca-certificates && rm -rf /var/lib/apt/lists/* && \
    mkdir -p /ts && \
    curl -fsSL https://pkgs.tailscale.com/stable/tailscale_latest_amd64.tgz | tar xz -C /ts --strip-components=1

# Stage 3: Runtime
FROM node:22-bookworm-slim

LABEL authors="aidn5, HyxonQz"
ENV NODE_ENV=production
# Fix npm warning about invalid 'before' config often injected by hosting platforms
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

# Copy Tailscale binaries
COPY --from=tailscale /ts/tailscale /usr/local/bin/tailscale
COPY --from=tailscale /ts/tailscaled /usr/local/bin/tailscaled

# Copy node_modules from builder
COPY --from=builder /app/node_modules ./node_modules

# Copy application source
COPY . .

# Create necessary directories and set permissions
RUN mkdir -p logs config/backup plugins && \
    chown -R node:node /app

# Use non-root user for security
# USER node

COPY scripts/docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

ENTRYPOINT ["/docker-entrypoint.sh"]
