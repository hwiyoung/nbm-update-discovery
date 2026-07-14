#!/usr/bin/env bash
set -Eeuo pipefail

usage() {
  cat <<'EOF'
Usage: scripts/install-offline.sh [options]

Options:
  --env-file FILE   Production env file (default: .env.prod)
  --skip-load       Do not load images before starting services.
  --skip-seed       Do not run the initial sheet seed command.
  -h, --help        Show this help.
EOF
}

die() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

ENV_FILE="$REPO_ROOT/.env.prod"
SKIP_LOAD=0
SKIP_SEED=0
while (($#)); do
  case "$1" in
    --env-file)
      shift
      (($#)) || die "--env-file requires a path"
      ENV_FILE="$(realpath -m "$1")"
      ;;
    --skip-load)
      SKIP_LOAD=1
      ;;
    --skip-seed)
      SKIP_SEED=1
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      die "unknown option: $1"
      ;;
  esac
  shift
done

[[ -f "$ENV_FILE" ]] || die "missing env file: $ENV_FILE (copy .env.prod.example and edit it)"
VERSION="$(tr -d '[:space:]' < VERSION)"
ENV_VERSION="$(sed -n 's/^APP_VERSION=//p' "$ENV_FILE" | tail -n 1 | tr -d '[:space:]')"
[[ "$ENV_VERSION" == "$VERSION" ]] || die "APP_VERSION=$ENV_VERSION does not match VERSION=$VERSION"

MODEL_FILES=(
  "innopam-PM2022004-digital/02_Road_CD/workspace/model/best_road.pth"
  "innopam-PM2022004-digital/04_Building_CD/workspace/model/best_building.pth"
  "innopam-PM2022004-digital/02_Road_CD/workspace/model/dinov3-vitl16-pretrain-lvd1689m/model.safetensors"
  "innopam-PM2022004-digital/04_Building_CD/workspace/model/dinov3-vitl16-pretrain-lvd1689m/model.safetensors"
)
for model in "${MODEL_FILES[@]}"; do
  [[ -s "$model" ]] || die "required model is missing or empty: $model"
done
if [[ -f MODEL_SHA256SUMS ]]; then
  sha256sum -c MODEL_SHA256SUMS
fi

if ((SKIP_LOAD == 0)); then
  "$SCRIPT_DIR/load-images.sh"
fi

COMPOSE=(docker compose -f docker-compose.prod.yml --env-file "$ENV_FILE")
"${COMPOSE[@]}" config --quiet
"${COMPOSE[@]}" up -d --no-build --wait --wait-timeout 180 postgres redis
"${COMPOSE[@]}" run --rm --no-deps backend alembic upgrade head
if ((SKIP_SEED == 0)); then
  "${COMPOSE[@]}" run --rm --no-deps backend python scripts/seed.py
fi
"${COMPOSE[@]}" up -d --no-build --wait --wait-timeout 180
"$SCRIPT_DIR/verify-offline.sh" --env-file "$ENV_FILE"
