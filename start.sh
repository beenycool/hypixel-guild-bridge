#! /bin/sh

# Unset problematic npm config that causes warnings/failures on some platforms
unset npm_config_before

# Start Tailscale (if env vars are set)
if [ -n "$TAILSCALE_AUTH_KEY" ] && [ -n "$TAILSCALE_EXIT_NODE" ]; then
  TS_DIR=/tmp/tailscale
  mkdir -p "$TS_DIR"

  if [ ! -f "$TS_DIR/tailscale" ]; then
    curl -fsSL https://pkgs.tailscale.com/stable/tailscale_latest_amd64.tgz \
      | tar xz -C "$TS_DIR" --strip-components=1
  fi

  "$TS_DIR/tailscaled" --state=mem --tun=userspace-networking --socket="$TS_DIR/ts.sock" &
  sleep 3
  "$TS_DIR/tailscale" up --auth-key="$TAILSCALE_AUTH_KEY" --exit-node="$TAILSCALE_EXIT_NODE"
fi

while true; do
  # Delete any temporarily changes such as from package-lock.json
  # This will not delete logs or configurations
  # But might delete any custom plugins if they are not in in logs or config dir
  git reset --hard
  # Auto update the application after every restart
  git pull

  # Install all dependencies after any potential application update
  npm install
  # Update packages that need to be always up to date
  npm update skyhelper-networth

  # Start the application
  # An alternative way is to "npm start" the application
  node --import tsx/esm index.ts

  echo "Server crashed.  Respawning.." >&2
  sleep 10
done
