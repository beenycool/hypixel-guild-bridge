#!/usr/bin/env bash
set -euo pipefail

APP="${1:-safe-citadel-79898}"
LOG_FILE="/tmp/heroku-logs-${APP}.txt"

exec > >(tee -a "$LOG_FILE") 2>&1

heroku logs -t --app "$APP"