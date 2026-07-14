#!/usr/bin/env bash
set -Eeuo pipefail

die() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

ENV_FILE="$REPO_ROOT/.env.prod"
if [[ "${1:-}" == "--env-file" ]]; then
  [[ -n "${2:-}" ]] || die "--env-file requires a path"
  ENV_FILE="$(realpath -m "$2")"
  shift 2
fi
(($# == 0)) || die "unknown argument: $1"
[[ -f "$ENV_FILE" ]] || die "missing env file: $ENV_FILE"

VERSION="$(tr -d '[:space:]' < VERSION)"
WEB_PORT="$(sed -n 's/^NBM_WEB_PORT=//p' "$ENV_FILE" | tail -n 1 | tr -d '[:space:]')"
WEB_PORT="${WEB_PORT:-18200}"
COMPOSE=(docker compose -f docker-compose.prod.yml --env-file "$ENV_FILE")

"${COMPOSE[@]}" ps
HEALTH="$(curl -fsS "http://127.0.0.1:$WEB_PORT/health")"
grep -Fq "\"version\":\"$VERSION\"" <<< "$HEALTH" || die "health response does not report version $VERSION: $HEALTH"
curl -fsS -o /dev/null "http://127.0.0.1:$WEB_PORT/"
"${COMPOSE[@]}" exec -T celery-worker celery -A app.workers.celery_app.celery_app inspect ping --timeout 8
"${COMPOSE[@]}" exec -T celery-engine-worker nvidia-smi -L
"${COMPOSE[@]}" exec -T celery-engine-worker sh -lc \
  'test -s /engines/pm/02_Road_CD/workspace/model/best_road.pth &&
   test -s /engines/pm/04_Building_CD/workspace/model/best_building.pth &&
   test -s /engines/pm/02_Road_CD/workspace/model/dinov3-vitl16-pretrain-lvd1689m/model.safetensors &&
   test -s /engines/pm/04_Building_CD/workspace/model/dinov3-vitl16-pretrain-lvd1689m/model.safetensors'
printf 'offline verification passed: version=%s url=http://127.0.0.1:%s/\n' "$VERSION" "$WEB_PORT"
