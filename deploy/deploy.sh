#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────
# One-command deploy/update for the Lightsail single-instance stack.
# Builds images, runs DB migrations, seeds (idempotent), and (re)starts.
# Safe to run repeatedly — this is also your "update" command after `git pull`.
#
#   ./deploy/deploy.sh
# ─────────────────────────────────────────────────────────────────────────
set -euo pipefail

cd "$(dirname "$0")/.."
COMPOSE="docker compose -f docker-compose.prod.yml"

if [ ! -f .env ]; then
  echo "❌ .env not found. Run:  cp .env.production.example .env  and edit it."
  exit 1
fi

echo "==> [1/5] Building images…"
$COMPOSE build

echo "==> [2/5] Starting Postgres & Redis…"
$COMPOSE up -d postgres redis

echo "==> [3/5] Waiting for Postgres to be ready…"
until $COMPOSE exec -T postgres pg_isready -U "${POSTGRES_USER:-hrms}" >/dev/null 2>&1; do
  printf '.'; sleep 2;
done
echo " ready."

echo "==> [4/5] Applying migrations + seeding…"
$COMPOSE run --rm api npx prisma migrate deploy
$COMPOSE run --rm api node prisma/seed.js

echo "==> [5/5] Starting all services…"
$COMPOSE up -d

echo ""
echo "✅ Deployed. Current status:"
$COMPOSE ps
echo ""
echo "   Test:  curl http://localhost/health"
echo "   Docs:  http://<your-static-ip>/api/v1/docs"
