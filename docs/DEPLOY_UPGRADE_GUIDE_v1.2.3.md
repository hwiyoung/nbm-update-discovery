# NBM Update Discovery v1.2.3 기존 PC 업데이트 가이드

이 문서는 기존 `v1.2.0`~`v1.2.2` 설치 PC를 오프라인 `v1.2.3` 패키지로 업데이트하는 절차다.

## 핵심 원칙

- 실행 중인 변화탐지 작업이 있으면 완료 후 진행한다.
- 기존 `.env.prod`, DB/Redis/storage named volume과 `HOST_*` 외부 데이터를 유지한다.
- 새 패키지는 새 버전 폴더에 해제하고 기존 폴더에 덮어쓰지 않는다.
- `docker compose down -v`와 오프라인 PC의 `docker compose build`는 실행하지 않는다.
- 성공 확인 전까지 기존 폴더, 기존 이미지, DB 백업을 보관한다.

## 1. 경로 설정

아래부터 설치 완료까지 같은 터미널에서 실행한다.

```bash
OLD_VERSION=1.2.2
OLD_DIR="$HOME/nbm-update-discovery_v${OLD_VERSION}/install/nbm-update-discovery"
NEW_ROOT="$HOME/nbm-update-discovery_v1.2.3"
NEW_DIR="$NEW_ROOT/install/nbm-update-discovery"
BACKUP_DIR="$HOME/nbm-backups"
```

실제 기존 버전과 설치 경로가 다르면 `OLD_VERSION`과 `OLD_DIR`을 맞춘다.

## 2. 업데이트 전 중단 조건

```bash
cd "$OLD_DIR"
curl -fsS http://127.0.0.1:18200/health | python3 -m json.tool
docker compose -f docker-compose.prod.yml --env-file .env.prod ps
docker compose -f docker-compose.prod.yml --env-file .env.prod \
  exec -T celery-engine-worker \
  celery -A app.workers.celery_app.celery_app inspect active --timeout 8
```

활성 작업이 있거나 DB·Redis·외부 데이터 경로가 정상 상태가 아니면 중단한다.

`v1.2.0` 또는 `v1.2.1`에서 바로 올리는 경우 기존 `road_updated` 행도 확인한다.

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod \
  exec -T postgres psql -U nbm -d nbm -c \
  "SELECT id, task_id FROM detections WHERE change_type='road_updated';"
```

행이 나오면 임의로 변경하지 말고 `DEPLOY_UPGRADE_GUIDE_v1.2.2.md`의 점검 절차를 먼저 적용한다.

과거 히스토리 오표기 가능 건수는 다음 읽기 전용 SQL로 확인할 수 있다.

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod \
  exec -T postgres psql -U nbm -d nbm -c "
SELECT count(*) AS legacy_classification_history
FROM review_histories
WHERE action='edit_meta'
  AND (
    before->>'model' IS DISTINCT FROM after->>'model'
    OR before->>'change_type' IS DISTINCT FROM after->>'change_type'
  );"
```

결과가 0보다 크면 해당 과거 분류 변경 이력이 새 화면에서 `의견`으로 보일 수 있다. 데이터 손상은 아니며 이번 릴리스는 이를 자동 변환하지 않는다.

## 3. 패키지 검사와 해제

```bash
cd "$NEW_ROOT"
sha256sum -c SHA256SUMS
mkdir -p install
tar -xzf nbm-update-discovery-app-images-v1.2.3-linux-amd64.tar.gz -C install
tar -xzf nbm-update-discovery-models-pm-6015d9a6-linux-amd64.tar.gz -C install
cd "$NEW_DIR"
test "$(cat VERSION)" = "1.2.3"
sha256sum -c MODEL_SHA256SUMS
```

모든 checksum이 `OK`가 아니면 중단한다.

## 4. 설정과 DB 백업

```bash
mkdir -p "$BACKUP_DIR"
STAMP="$(date +%Y%m%d-%H%M%S)"
cp "$OLD_DIR/.env.prod" "$BACKUP_DIR/env.prod-v${OLD_VERSION}-before-v1.2.3-${STAMP}"

cd "$OLD_DIR"
docker compose -f docker-compose.prod.yml --env-file .env.prod \
  exec -T postgres pg_dump -U nbm -d nbm -Fc \
  > "$BACKUP_DIR/nbm-v${OLD_VERSION}-before-v1.2.3-${STAMP}.dump"

test -s "$BACKUP_DIR/nbm-v${OLD_VERSION}-before-v1.2.3-${STAMP}.dump"
```

마지막 명령이 실패하면 업데이트를 중단한다.

기존 설정을 복사하고 버전만 변경한다.

```bash
cp "$OLD_DIR/.env.prod" "$NEW_DIR/.env.prod"
sed -i 's/^APP_VERSION=.*/APP_VERSION=1.2.3/' "$NEW_DIR/.env.prod"
unset APP_VERSION

cd "$NEW_DIR"
docker compose -f docker-compose.prod.yml --env-file .env.prod config --quiet
APP_VERSION=1.2.3 docker compose \
  -f docker-compose.prod.yml --env-file .env.prod config --images
```

`COMPOSE_PROJECT_NAME=nbm_update`, 기존 비밀번호·시크릿·`HOST_*` 경로가 그대로인지 확인한다.

## 5. 이미지 적재와 버전 전환

기존 서비스 실행 중 새 이미지를 먼저 적재한다.

```bash
cd "$NEW_DIR"
chmod +x scripts/*.sh
scripts/load-images.sh
```

이후 짧은 서비스 중단 구간이다.

```bash
cd "$OLD_DIR"
docker compose -f docker-compose.prod.yml --env-file .env.prod down

cd "$NEW_DIR"
scripts/install-offline.sh --skip-load --skip-seed
```

다음 문구가 나와야 한다.

```text
offline verification passed: version=1.2.3 url=http://127.0.0.1:18200/
```

## 6. 설치 후 확인

```bash
cd "$NEW_DIR"
docker compose -f docker-compose.prod.yml --env-file .env.prod ps
curl -fsS http://127.0.0.1:18200/health | python3 -m json.tool
docker compose -f docker-compose.prod.yml --env-file .env.prod \
  exec -T postgres psql -U nbm -d nbm -c "
SELECT
  (SELECT count(*) FROM tasks) AS tasks,
  (SELECT count(*) FROM datasets) AS datasets,
  (SELECT count(*) FROM detections) AS detections,
  (SELECT count(*) FROM review_histories) AS histories;"
```

업데이트 전후 개수가 유지되는지 확인하고 브라우저에서 `Ctrl+Shift+R` 또는 `Ctrl+F5`로 새로고침한다.

## 7. 롤백

이번 릴리스는 DB migration을 추가하지 않았으므로 새 스택을 일반 `down`으로 중지하고 기존 폴더의 스택을 다시 시작할 수 있다.

```bash
cd "$NEW_DIR"
docker compose -f docker-compose.prod.yml --env-file .env.prod down

cd "$OLD_DIR"
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --no-build --wait
curl -fsS http://127.0.0.1:18200/health | python3 -m json.tool
```

`down -v`는 롤백 시에도 절대 사용하지 않는다. DB 내용까지 되돌려야 하는 별도 사고가 있었다면 애플리케이션 버전만 내리지 말고 업데이트 직전 dump 복원 절차를 사용한다.
