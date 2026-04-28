#!/bin/bash
set -e

TS_DIR=/tmp/tailscale
mkdir -p "$TS_DIR"

echo "[tailscale] Downloading..."
if [ ! -f "$TS_DIR/tailscale" ]; then
    curl -fsSL https://pkgs.tailscale.com/stable/tailscale_latest_amd64.tgz \
        | tar xz -C "$TS_DIR" --strip-components=1
fi

echo "[tailscale] Starting daemon..."
"$TS_DIR/tailscaled" \
    --state=mem \
    --tun=userspace-networking \
    --socket="$TS_DIR/ts.sock" &

sleep 3

echo "[tailscale] Connecting to tailnet..."
"$TS_DIR/tailscale" up \
    --auth-key="$TAILSCALE_AUTH_KEY" \
    --exit-node="$TAILSCALE_EXIT_NODE" \
    --socket="$TS_DIR/ts.sock"

echo "[tailscale] Connected. Exit node: $TAILSCALE_EXIT_NODE"
"$TS_DIR/tailscale" status --socket="$TS_DIR/ts.sock"

echo "[app] Starting..."
exec node --import tsx/esm index.ts
