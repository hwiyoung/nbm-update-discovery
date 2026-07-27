# NBM Update Discovery v1.2.2 빠른 업데이트 가이드

Ubuntu 배포 PC에 설치된 `v1.2.0` 또는 `v1.2.1`을 `v1.2.2`로 업데이트하는 요약 절차다. 자세한 설명과 오류 해결은 [상세 업데이트 가이드](./DEPLOY_UPGRADE_GUIDE_v1.2.2.md)를 참고한다.

## 1. 주의사항

> - `docker compose down -v`를 절대 실행하지 않는다.
> - 기존 설치 폴더에 새 버전을 덮어쓰지 않는다.
> - 기존 `.env.prod`와 Docker volume을 그대로 사용한다.
> - 오프라인 PC에서 `docker compose build`를 실행하지 않는다.
> - 실행 중인 변화탐지 작업이 있으면 완료 후 업데이트한다.
> - 성공 확인 전까지 기존 버전 폴더와 이미지를 삭제하지 않는다.

## 2. 주요 변경 내용

| 구분 | 내용 |
|---|---|
| 화면 비교 | 과년도·당해년도 분할 화면과 지도 이동·확대/축소 동기화 |
| 영상 경계 | 원본 영상 footprint와 공통 처리영역 바운더리 표시 |
| SHP | UTF-8 DBF, `.cpg`, EPSG:5186을 포함한 서버 생성 방식 |
| 다중 영상 | 과년도·당해년도 복수 영상 선택 및 VRT 결합 처리 |
| 재실행 안정화 | 이전 Celery 작업의 중복·지연 전달로 인한 재실행 방지 |
| v1.2.1 | 오프라인 패키지와 자동 설치·검증 스크립트 추가 |
| v1.2.2 | 도로 수동 편집에서 지원하지 않는 `road_updated` 옵션 제거 |

앞의 다섯 기능은 공식 `v1.2.0` 태그에도 포함되어 있으며 `v1.2.2` 패키지에서도 그대로 제공된다.

## 3. 경로 설정

아래 명령부터 설치 완료까지 같은 터미널에서 진행한다.

```bash
# 현재 설치된 버전에 맞게 1.2.0 또는 1.2.1 중 하나를 입력한다.
OLD_VERSION=1.2.1

OLD_DIR="$HOME/nbm-update-discovery_v${OLD_VERSION}/install/nbm-update-discovery"
NEW_ROOT="$HOME/nbm-update-discovery_v1.2.2"
NEW_DIR="$NEW_ROOT/install/nbm-update-discovery"
BACKUP_DIR="$HOME/nbm-backups"
DATA_ROOT="/media/innopam/Innopam_4TB"

echo "기존 설치: $OLD_DIR"
echo "새 설치:   $NEW_DIR"
test -d "$OLD_DIR" && echo "기존 설치 폴더 OK" || echo "기존 설치 폴더 없음"
```

`기존 설치 폴더 없음`이 나오면 경로를 수정한 후 진행한다. 터미널을 새로 열었다면 위 변수 설정부터 다시 실행한다.

## 4. 업데이트 전 점검

```bash
cd "$OLD_DIR"

curl -fsS http://127.0.0.1:18200/health | python3 -m json.tool
docker compose -f docker-compose.prod.yml --env-file .env.prod ps

findmnt "$DATA_ROOT"
ls -ld \
  "$DATA_ROOT/orthomosaic" \
  "$DATA_ROOT/exports" \
  "$DATA_ROOT/dem" \
  "$DATA_ROOT/vworld_tiles"
```

외장 디스크가 마운트되지 않았거나 데이터 폴더가 없으면 중단한다.

실행 중인 변화탐지 작업을 확인한다.

```bash
docker compose \
  -f docker-compose.prod.yml \
  --env-file .env.prod \
  exec -T celery-engine-worker \
  celery -A app.workers.celery_app.celery_app inspect active --timeout 8
```

작업이 표시되면 완료될 때까지 기다린다.

기존 `road_updated` 행을 확인한다.

```bash
docker compose \
  -f docker-compose.prod.yml \
  --env-file .env.prod \
  exec -T postgres \
  psql -U nbm -d nbm -c "
SELECT id, task_id, model, change_type
FROM detections
WHERE change_type = 'road_updated';
"
```

결과가 반드시 `(0 rows)`여야 한다. 행이 발견되면 업데이트를 중단하고 [상세 가이드의 정리 절차](./DEPLOY_UPGRADE_GUIDE_v1.2.2.md#6-2단계-기존-road_updated-데이터-점검)를 수행한다.

## 5. 패키지 검사 및 압축 해제

`$NEW_ROOT`에 다음 네 파일이 있어야 한다.

```text
PACKAGE_MANIFEST.json
SHA256SUMS
nbm-update-discovery-app-images-v1.2.2-linux-amd64.tar.gz
nbm-update-discovery-models-pm-6015d9a6-linux-amd64.tar.gz
```

```bash
cd "$NEW_ROOT"
sha256sum -c SHA256SUMS

mkdir -p install
tar -xzf nbm-update-discovery-app-images-v1.2.2-linux-amd64.tar.gz -C install
tar -xzf nbm-update-discovery-models-pm-6015d9a6-linux-amd64.tar.gz -C install

cd "$NEW_DIR"
cat VERSION
sha256sum -c MODEL_SHA256SUMS
```

외부 패키지 세 항목과 모든 모델 파일이 `OK`이고, `VERSION`이 `1.2.2`여야 한다.

## 6. 설정과 DB 백업

기존 서비스가 실행 중인 상태에서 백업한다.

```bash
mkdir -p "$BACKUP_DIR"
STAMP="$(date +%Y%m%d-%H%M%S)"

cp "$OLD_DIR/.env.prod" \
  "$BACKUP_DIR/env.prod-v${OLD_VERSION}-before-v1.2.2-${STAMP}"
chmod 600 "$BACKUP_DIR/env.prod-v${OLD_VERSION}-before-v1.2.2-${STAMP}"

cd "$OLD_DIR"
docker compose \
  -f docker-compose.prod.yml \
  --env-file .env.prod \
  exec -T postgres \
  pg_dump -U nbm -d nbm -Fc \
  > "$BACKUP_DIR/nbm-v${OLD_VERSION}-before-v1.2.2-${STAMP}.dump"

test -s "$BACKUP_DIR/nbm-v${OLD_VERSION}-before-v1.2.2-${STAMP}.dump" \
  && echo "DB backup OK" \
  || echo "DB backup FAILED"
```

`DB backup OK`가 나오지 않으면 중단한다.

## 7. 새 버전 설정과 이미지 준비

기존 설정을 복사하고 버전만 변경한다.

```bash
cp "$OLD_DIR/.env.prod" "$NEW_DIR/.env.prod"
sed -i 's/^APP_VERSION=.*/APP_VERSION=1.2.2/' "$NEW_DIR/.env.prod"
chmod 600 "$NEW_DIR/.env.prod"

grep -E \
  '^(COMPOSE_PROJECT_NAME|APP_VERSION|HOST_BIND|NBM_WEB_PORT|HOST_.*_DIR)=' \
  "$NEW_DIR/.env.prod"

cd "$NEW_DIR"
docker compose -f docker-compose.prod.yml --env-file .env.prod config --quiet
```

다음을 확인한다.

- `COMPOSE_PROJECT_NAME=nbm_update`
- `APP_VERSION=1.2.2`
- `NBM_WEB_PORT=18200`
- 모든 `HOST_*` 경로가 `/media/innopam/Innopam_4TB` 아래의 실제 경로

기존 서비스가 실행 중일 때 새 이미지를 미리 적재한다.

```bash
cd "$NEW_DIR"
chmod +x scripts/*.sh
scripts/load-images.sh
```

마지막에 모든 이미지가 `loaded:`로 표시되어야 한다.

## 8. 기존 버전 중지 및 v1.2.2 실행

여기서부터 웹 서비스가 잠시 중단된다.

```bash
cd "$OLD_DIR"
docker compose -f docker-compose.prod.yml --env-file .env.prod down

docker volume ls --filter name=nbm_update
```

`nbm_update_postgres-data` 등의 volume이 남아 있어야 한다.

새 버전을 실행한다.

```bash
cd "$NEW_DIR"
scripts/install-offline.sh --skip-load --skip-seed
```

다음 문구가 나오면 기본 검증까지 성공한 것이다.

```text
offline verification passed: version=1.2.2 url=http://127.0.0.1:18200/
```

## 9. 최종 확인

```bash
cd "$NEW_DIR"

docker compose -f docker-compose.prod.yml --env-file .env.prod ps
curl -fsS http://127.0.0.1:18200/health | python3 -m json.tool

docker compose \
  -f docker-compose.prod.yml \
  --env-file .env.prod \
  exec -T postgres \
  psql -U nbm -d nbm -c "
SELECT
  (SELECT count(*) FROM tasks) AS tasks,
  (SELECT count(*) FROM datasets) AS datasets,
  (SELECT count(*) FROM detections) AS detections;
"
```

브라우저에서 `http://192.168.10.201:18200/#/`에 접속하고 `Ctrl+Shift+R` 또는 `Ctrl+F5`로 강력 새로고침한다.

확인 항목:

- 기존 프로젝트와 폴리곤이 유지된다.
- 프로젝트 상세 화면이 흰 화면 없이 열린다.
- 과년도·당해년도 영상과 바운더리가 보인다.
- 도로 수동 편집에는 `신설`, `소멸`만 보인다.
- SHP의 한글 속성이 정상적으로 열린다.

## 10. 문제 발생 시 롤백

```bash
# v1.2.2 중지
cd "$NEW_DIR"
docker compose -f docker-compose.prod.yml --env-file .env.prod down

# 기존 버전 재기동
cd "$OLD_DIR"
docker compose \
  -f docker-compose.prod.yml \
  --env-file .env.prod \
  up -d --no-build --wait

curl -fsS http://127.0.0.1:18200/health | python3 -m json.tool
```

롤백할 때도 `down -v`는 절대 사용하지 않는다.

## 핵심 전환 명령

사전 점검과 백업을 마친 후 실제 전환에 사용하는 명령은 다음 세 단계다.

```bash
cd "$NEW_DIR" && scripts/load-images.sh
cd "$OLD_DIR" && docker compose -f docker-compose.prod.yml --env-file .env.prod down
cd "$NEW_DIR" && scripts/install-offline.sh --skip-load --skip-seed
```
