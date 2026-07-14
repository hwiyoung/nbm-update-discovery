#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
IMAGE_TAR="${1:-$REPO_ROOT/images/docker-images.tar}"
IMAGE_LIST="$REPO_ROOT/images/IMAGES.txt"
MANIFEST="$REPO_ROOT/PACKAGE_MANIFEST.json"

[[ -f "$IMAGE_TAR" ]] || {
  printf 'ERROR: Docker image archive not found: %s\n' "$IMAGE_TAR" >&2
  exit 1
}

docker load -i "$IMAGE_TAR"

if [[ -f "$IMAGE_LIST" ]]; then
  while IFS= read -r image; do
    [[ -n "$image" ]] || continue
    docker image inspect "$image" >/dev/null
    printf 'loaded: %s\n' "$image"
  done < "$IMAGE_LIST"
fi

if [[ -f "$MANIFEST" ]]; then
  while IFS=$'\t' read -r image expected_id; do
    [[ -n "$image" ]] || continue
    actual_id="$(docker image inspect --format '{{.Id}}' "$image")"
    [[ "$actual_id" == "$expected_id" ]] || {
      printf 'ERROR: image ID mismatch for %s: expected %s, got %s\n' "$image" "$expected_id" "$actual_id" >&2
      exit 1
    }
  done < <(python3 - "$MANIFEST" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as stream:
    payload = json.load(stream)
for image in payload["images"]:
    print(f'{image["name"]}\t{image["id"]}')
PY
  )
fi
