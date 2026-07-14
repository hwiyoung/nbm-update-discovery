#!/usr/bin/env bash
set -Eeuo pipefail

usage() {
  cat <<'EOF'
Usage: scripts/build-offline-package.sh [VERSION] [options]

Build a reproducible offline deployment set from the current tagged commit.

Options:
  --skip-build         Reuse existing versioned Docker images.
  --output-dir DIR     Output root (default: releases).
  --force              Replace an existing output directory for this version.
  -h, --help           Show this help.

The current HEAD must be clean and tagged as vVERSION. Real PM model files must
already be installed at the paths documented in innopam-PM2022004-digital/MODEL_SETUP.md.
EOF
}

die() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

REQUESTED_VERSION=""
OUTPUT_ROOT="$REPO_ROOT/releases"
SKIP_BUILD=0
FORCE=0

while (($#)); do
  case "$1" in
    --skip-build)
      SKIP_BUILD=1
      ;;
    --output-dir)
      shift
      (($#)) || die "--output-dir requires a directory"
      OUTPUT_ROOT="$(realpath -m "$1")"
      ;;
    --force)
      FORCE=1
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    -* )
      die "unknown option: $1"
      ;;
    *)
      [[ -z "$REQUESTED_VERSION" ]] || die "version specified more than once"
      REQUESTED_VERSION="${1#v}"
      ;;
  esac
  shift
done

VERSION="$(tr -d '[:space:]' < VERSION)"
[[ -n "$VERSION" ]] || die "VERSION is empty"
[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+([.-][0-9A-Za-z.-]+)?$ ]] || die "invalid version: $VERSION"
if [[ -n "$REQUESTED_VERSION" && "$REQUESTED_VERSION" != "$VERSION" ]]; then
  die "requested version $REQUESTED_VERSION does not match VERSION=$VERSION"
fi

TAG="v$VERSION"
HEAD_COMMIT="$(git rev-parse HEAD)"
git rev-parse -q --verify "refs/tags/$TAG" >/dev/null || die "missing local tag $TAG"
[[ "$(git cat-file -t "refs/tags/$TAG")" == "tag" ]] || die "$TAG must be an annotated tag"
TAG_COMMIT="$(git rev-list -n 1 "$TAG")"
[[ "$TAG_COMMIT" == "$HEAD_COMMIT" ]] || die "$TAG points to $TAG_COMMIT, not HEAD $HEAD_COMMIT"

DIRTY="$(git status --porcelain --untracked-files=all --ignore-submodules=dirty)"
[[ -z "$DIRTY" ]] || die "working tree is not clean; commit or remove changes before packaging"

PM_PATH="innopam-PM2022004-digital"
PM_RECORDED_COMMIT="$(git ls-tree HEAD "$PM_PATH" | awk '{print $3}')"
PM_COMMIT="$(git -C "$PM_PATH" rev-parse HEAD)"
[[ -n "$PM_RECORDED_COMMIT" ]] || die "submodule pointer is missing for $PM_PATH"
[[ "$PM_COMMIT" == "$PM_RECORDED_COMMIT" ]] || die "submodule HEAD $PM_COMMIT does not match recorded $PM_RECORDED_COMMIT"

MODEL_FILES=(
  "$PM_PATH/02_Road_CD/workspace/model/best_road.pth"
  "$PM_PATH/04_Building_CD/workspace/model/best_building.pth"
  "$PM_PATH/02_Road_CD/workspace/model/dinov3-vitl16-pretrain-lvd1689m/model.safetensors"
  "$PM_PATH/04_Building_CD/workspace/model/dinov3-vitl16-pretrain-lvd1689m/model.safetensors"
)
for model in "${MODEL_FILES[@]}"; do
  [[ -s "$model" ]] || die "required model is missing or empty: $model"
done

COMPOSE=(docker compose -f docker-compose.prod.yml --env-file .env.prod.example)
APP_IMAGES=(
  "nbm-update-discovery-backend-prod:$VERSION"
  "nbm-update-discovery-celery-engine-worker-prod:$VERSION"
  "nbm-update-discovery-frontend-prod:$VERSION"
)
BASE_IMAGES=(
  "postgis/postgis:15-3.4"
  "redis:7-alpine"
  "ghcr.io/developmentseed/titiler:0.22.0"
  "nginx:alpine"
)
ALL_IMAGES=("${APP_IMAGES[@]}" "${BASE_IMAGES[@]}")

[[ "$(uname -s)" == "Linux" && "$(uname -m)" == "x86_64" ]] || \
  die "this package profile currently supports Linux x86_64 only"

APP_VERSION="$VERSION" "${COMPOSE[@]}" config --quiet
if ((SKIP_BUILD == 0)); then
  APP_VERSION="$VERSION" "${COMPOSE[@]}" build backend celery-engine-worker frontend
fi
for image in "${ALL_IMAGES[@]}"; do
  docker image inspect "$image" >/dev/null 2>&1 || die "required Docker image is unavailable: $image"
done

PACKAGE_BASENAME="nbm-update-discovery"
OUTPUT_DIR="$OUTPUT_ROOT/$TAG"
if [[ -e "$OUTPUT_DIR" ]]; then
  ((FORCE == 1)) || die "output already exists: $OUTPUT_DIR (use --force to replace it)"
  rm -rf -- "$OUTPUT_DIR"
fi
mkdir -p "$OUTPUT_DIR"

STAGE_ROOT="$OUTPUT_DIR/.staging-$$"
APP_STAGE="$STAGE_ROOT/app/$PACKAGE_BASENAME"
MODEL_STAGE="$STAGE_ROOT/models/$PACKAGE_BASENAME"
cleanup() {
  rm -rf -- "$STAGE_ROOT"
}
trap cleanup EXIT
mkdir -p "$APP_STAGE" "$MODEL_STAGE"

git archive --format=tar HEAD | tar -xf - -C "$APP_STAGE"
mkdir -p "$APP_STAGE/$PM_PATH"
git -C "$PM_PATH" archive --format=tar HEAD | tar -xf - -C "$APP_STAGE/$PM_PATH"

mkdir -p "$APP_STAGE/images"
printf '%s\n' "${ALL_IMAGES[@]}" > "$APP_STAGE/images/IMAGES.txt"
docker save -o "$APP_STAGE/images/docker-images.tar" "${ALL_IMAGES[@]}"

for model in "${MODEL_FILES[@]}"; do
  install -D -m 0644 "$model" "$MODEL_STAGE/$model"
done
(
  cd "$MODEL_STAGE"
  sha256sum "${MODEL_FILES[@]}" > MODEL_SHA256SUMS
)

IMAGE_METADATA="$STAGE_ROOT/image-metadata.tsv"
: > "$IMAGE_METADATA"
for image in "${ALL_IMAGES[@]}"; do
  image_id="$(docker image inspect --format '{{.Id}}' "$image")"
  printf '%s\t%s\n' "$image" "$image_id" >> "$IMAGE_METADATA"
done

MANIFEST="$STAGE_ROOT/PACKAGE_MANIFEST.json"
python3 - "$MANIFEST" "$VERSION" "$TAG" "$HEAD_COMMIT" "$PM_COMMIT" "$IMAGE_METADATA" <<'PY'
from __future__ import annotations

import json
import platform
import sys
from datetime import datetime, timezone
from pathlib import Path

output, version, tag, commit, pm_commit, image_metadata = sys.argv[1:]
images = []
for line in Path(image_metadata).read_text().splitlines():
    name, image_id = line.split("\t", 1)
    images.append({"name": name, "id": image_id})

payload = {
    "product": "nbm-update-discovery",
    "version": version,
    "git_tag": tag,
    "git_commit": commit,
    "pm_submodule_commit": pm_commit,
    "platform": f"{platform.system().lower()}/{platform.machine()}",
    "built_at_utc": datetime.now(timezone.utc).isoformat(),
    "site_data_included": False,
    "models_in_separate_archive": True,
    "images": images,
}
Path(output).write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n")
PY
install -m 0644 "$MANIFEST" "$APP_STAGE/PACKAGE_MANIFEST.json"

APP_ARCHIVE="$OUTPUT_DIR/${PACKAGE_BASENAME}-app-images-$TAG-linux-amd64.tar.gz"
MODEL_ARCHIVE="$OUTPUT_DIR/${PACKAGE_BASENAME}-models-pm-${PM_COMMIT:0:8}-linux-amd64.tar.gz"
GZIP=(gzip -1)
if command -v pigz >/dev/null 2>&1; then
  GZIP=(pigz -1)
fi

tar -cf - -C "$STAGE_ROOT/app" "$PACKAGE_BASENAME" | "${GZIP[@]}" > "$APP_ARCHIVE.tmp"
mv "$APP_ARCHIVE.tmp" "$APP_ARCHIVE"
tar -cf - -C "$STAGE_ROOT/models" "$PACKAGE_BASENAME" | "${GZIP[@]}" > "$MODEL_ARCHIVE.tmp"
mv "$MODEL_ARCHIVE.tmp" "$MODEL_ARCHIVE"

install -m 0644 "$MANIFEST" "$OUTPUT_DIR/PACKAGE_MANIFEST.json"
(
  cd "$OUTPUT_DIR"
  sha256sum "$(basename "$APP_ARCHIVE")" "$(basename "$MODEL_ARCHIVE")" PACKAGE_MANIFEST.json > SHA256SUMS
)

printf 'Offline deployment set created:\n'
du -h "$APP_ARCHIVE" "$MODEL_ARCHIVE" "$OUTPUT_DIR/PACKAGE_MANIFEST.json" "$OUTPUT_DIR/SHA256SUMS"
printf 'Output: %s\n' "$OUTPUT_DIR"
