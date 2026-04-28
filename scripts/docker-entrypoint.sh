#!/bin/bash
set -e

if [ -n "$TAILSCALE_AUTH_KEY" ] && [ -n "$TAILSCALE_EXIT_NODE" ]; then
  echo "[tailscale] Starting daemon..."
  tailscaled --state=mem --tun=userspace-networking &
  sleep 3
  echo "[tailscale] Connecting..."
  tailscale up --auth-key="$TAILSCALE_AUTH_KEY" --exit-node="$TAILSCALE_EXIT_NODE"
  echo "[tailscale] Connected."
  tailscale status
fi

echo "[app] Starting..."
exec node --import tsx/esm index.ts
