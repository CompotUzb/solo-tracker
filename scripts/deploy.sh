#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/home/hbai-academy/workspaces/projects/my/solo-tracker}"
BRANCH="${BRANCH:-main}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:3333/api/health}"
DATABASE_PATH="${DATABASE_PATH:-./data/solo-system.sqlite}"
BACKUP_DIR="${BACKUP_DIR:-./data/backups}"

echo "== Solo Tracker deploy started =="

cd "$APP_DIR"

echo "== Current git status =="
git status --short

if [ -n "$(git status --porcelain)" ]; then
  echo "ERROR: Local changes found. Commit/stash them before deploy."
  git status --short
  exit 1
fi

echo "== Pull latest code =="
git fetch origin "$BRANCH"
git pull --ff-only origin "$BRANCH"

echo "== Latest commit =="
git log --oneline -1

if [ -f "$DATABASE_PATH" ]; then
  echo "== Backup production database =="
  mkdir -p "$BACKUP_DIR"
  cp "$DATABASE_PATH" "$BACKUP_DIR/solo-system-$(date +%Y%m%d-%H%M%S).sqlite"
fi

echo "== Verify and build app artifacts with Node 22 inside Docker =="
docker run --rm \
  -u "$(id -u):$(id -g)" \
  -v "$PWD:/app" \
  -w /app \
  -e COREPACK_HOME=/tmp/corepack \
  -e PNPM_HOME=/tmp/pnpm \
  node:22-bookworm \
  bash -lc 'mkdir -p /tmp/corepack /tmp/pnpm /tmp/bin && corepack enable --install-directory /tmp/bin && export PATH="/tmp/bin:/tmp/pnpm:$PATH" && pnpm install --frozen-lockfile && pnpm lint && pnpm test && pnpm build'

echo "== Rebuild and restart Docker container =="
docker compose up --build -d

echo "== Waiting for app health =="
for i in {1..20}; do
  if curl -fsS "$HEALTH_URL" > /tmp/solo-health.json; then
    echo "Health OK:"
    cat /tmp/solo-health.json
    echo
    echo "== Deploy completed successfully =="
    exit 0
  fi

  echo "Health check failed, retrying... ($i/20)"
  sleep 3
done

echo "ERROR: App did not become healthy."
echo "== Docker status =="
docker compose ps

echo "== Last logs =="
docker compose logs --tail=100 solo-system-tracker

exit 1
