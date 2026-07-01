#! /bin/sh

# Unset problematic npm config that causes warnings/failures on some platforms
unset npm_config_before

export NODE_OPTIONS="--max-old-space-size=512 --expose-gc --optimize-for-size"


while true; do
  # Stash local changes (plugins, configs, etc.) instead of destroying them
  # Use `git stash pop` to restore them after a restart if needed
  git stash --include-untracked
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
