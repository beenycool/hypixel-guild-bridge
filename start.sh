#! /bin/sh

unset npm_config_before

export NODE_OPTIONS="--max-old-space-size=512 --expose-gc --optimize-for-size"


while true; do
  git stash --include-untracked
  git pull

  npm install
  npm update skyhelper-networth

  node --import tsx/esm index.ts

  echo "Server crashed.  Respawning.." >&2
  sleep 10
done
