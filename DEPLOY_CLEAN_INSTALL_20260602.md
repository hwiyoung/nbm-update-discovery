# NBM Update Discovery 클린 설치 가이드

이 문서는 기존 배포 버전을 Docker volume까지 삭제한 뒤, 새 배포 패키지를 설치하는 절차입니다.

## 배포 패키지

현재 배포 패키지는 생성 보류 상태입니다. 검증이 완전히 끝난 뒤 새 timestamp로 생성해야 합니다.

```bash
/media/innopam/InnoPAM-8TB/smcho/code/nbm-update-discovery-deploy-YYYYMMDD-HHMMSS.tar.gz
/media/innopam/InnoPAM-8TB/smcho/code/nbm-update-discovery-deploy-YYYYMMDD-HHMMSS.tar.gz.sha256
```

배포 PC 접속 포트:

```text
http://배포PC_IP:18200/
```

## 1. 패키지 복사

로컬 PC에서 배포 PC로 복사합니다.

```bash
scp /media/innopam/InnoPAM-8TB/smcho/code/nbm-update-discovery-deploy-YYYYMMDD-HHMMSS.tar.gz user@배포PC:/opt/
scp /media/innopam/InnoPAM-8TB/smcho/code/nbm-update-discovery-deploy-YYYYMMDD-HHMMSS.tar.gz.sha256 user@배포PC:/opt/
```

## 2. 배포 PC 접속

```bash
ssh user@배포PC
cd /opt
```

## 3. 패키지 무결성 확인

```bash
sha256sum -c nbm-update-discovery-deploy-YYYYMMDD-HHMMSS.tar.gz.sha256
```

정상이라면 `OK`가 출력됩니다.

## 4. 기존 버전 종료 및 볼륨 삭제

기존 설치 폴더로 이동합니다.

```bash
cd /opt/기존_nbm_update_discovery_설치폴더
```

기존 컨테이너와 Docker volume을 삭제합니다.

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod down -v --remove-orphans
```

주의:

- 이 명령은 기존 DB, Redis, storage, titiler cache volume을 삭제합니다.
- 기존 프로젝트, 검출 결과, DB 데이터가 사라집니다.
- 원천 정사영상, DEM, VWorld tile 같은 host bind mount 데이터는 이 명령으로 삭제되지 않습니다.

남은 NBM 관련 volume을 확인합니다.

```bash
docker volume ls | grep nbm
```

이전 배포가 다른 project name으로 떠 있었으면 volume이 남을 수 있습니다. 실제 삭제 대상인지 확인한 뒤에만 삭제합니다.

```bash
docker volume rm nbm_update_postgres-data nbm_update_redis-data nbm_update_storage-data nbm_update_titiler-cache-data
```

## 5. 새 패키지 압축 해제

```bash
cd /opt
tar -xzf nbm-update-discovery-deploy-YYYYMMDD-HHMMSS.tar.gz
cd nbm-update-discovery-deploy-YYYYMMDD-HHMMSS
```

## 6. 환경파일 생성

```bash
cp .env.prod.example .env.prod
nano .env.prod
```

필수 값 확인:

```env
COMPOSE_PROJECT_NAME=nbm_update
HOST_BIND=0.0.0.0
NBM_WEB_PORT=18200
VITE_API_BASE_URL=/api/v1
VITE_USE_MOCK=false
```

NBM 배포 진입점은 `18200`으로 고정합니다. Aerial-survey-manager의 `18100`은 이 repo에서 변경하지 않습니다. 개발 stack을 같은 PC에서 동시에 띄울 때는 기존 개발 데이터 volume을 보존하기 위해 개발용 `.env`의 `COMPOSE_PROJECT_NAME=nbm-update-discovery`, `NBM_DEV_HOST_BIND=0.0.0.0`, `NBM_DEV_WEB_PORT=18210`을 사용합니다.

배포 PC 실제 경로에 맞게 수정해야 하는 값:

```env
HOST_ORTHOMOSAIC_DIR=/실제/정사영상/경로
HOST_DEM_DIR=/실제/DEM/경로
HOST_EXPORT_OUTPUT_DIR=/실제/결과저장/경로
HOST_VWORLD_TILES_DIR=/실제/브이월드타일/경로
```

주의:

- `HOST_ORTHOMOSAIC_DIR`는 정사영상이 있는 실제 host 경로여야 합니다.
- `HOST_DEM_DIR`는 DEM 파일이 있는 실제 host 경로여야 합니다.
- `HOST_EXPORT_OUTPUT_DIR`는 결과 파일 저장 경로입니다.
- `HOST_VWORLD_TILES_DIR`는 배경 타일 경로입니다.

배포 PC에서 외장하드 경로가 실제로 보이는지 먼저 확인합니다.

```bash
test -d "$HOST_ORTHOMOSAIC_DIR" && find "$HOST_ORTHOMOSAIC_DIR" -type f \( -iname '*.tif' -o -iname '*.tiff' \) | head
test -d "$HOST_DEM_DIR" && find "$HOST_DEM_DIR" -type f | head
test -d "$HOST_VWORLD_TILES_DIR" && find "$HOST_VWORLD_TILES_DIR" -type f | head
```

정사영상 경로가 없거나 외장하드가 마운트되지 않았으면 Docker가 빈 폴더를 자동 생성하지 않고 시작 단계에서 실패하도록 설정되어 있습니다.

## 7. Compose 설정 검증

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod config --quiet
```

frontend 포트가 `0.0.0.0:18200 -> 80` 하나로 잡히는지 확인하려면:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod config | grep -A10 'frontend:'
```

## 8. 이미지 빌드

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod build
```

## 9. 서비스 실행

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d
```

## 10. DB 마이그레이션 및 운영 도엽 시드

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod exec backend alembic upgrade head
docker compose -f docker-compose.prod.yml --env-file .env.prod exec backend python scripts/seed.py
```

`scripts/seed.py`는 운영 기본값으로 전체 도엽 격자만 등록합니다. 데모 datasets/tasks/detections는 넣지 않습니다.

## 11. 정사영상 폴더 스캔

`.env.prod`의 `HOST_ORTHOMOSAIC_DIR`에 설정한 실제 정사영상 폴더를 스캔해 데이터셋 자원에 등록합니다.

```bash
curl -fsS -X POST http://localhost:18200/api/v1/datasets/rescan-orthomosaic
```

정상이라면 `scanned`, `registered`, `skipped`, `failed` 건수가 JSON으로 출력됩니다.

## 12. 상태 확인

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod ps
curl -fsS http://localhost:18200/
curl -fsS http://localhost:18200/health
```

브라우저 접속:

```text
http://배포PC_IP:18200/
```

브라우저와 운영 점검은 backend/TiTiler host port 를 직접 호출하지 않고 같은 origin 의 `/api`, `/health`, `/titiler`, `/vworld` 경로를 사용합니다.

## 13. GPU 및 모델 확인

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod exec celery-engine-worker nvidia-smi -L
```

도로 모델 확인:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod exec celery-engine-worker sh -lc 'test -s /engines/change-detection/Road_CD/workspace/model/best_road.pth'
```

건물 모델 확인:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod exec celery-engine-worker sh -lc 'test -s /engines/change-detection/Building_CD/workspace/model/best_building.pth'
```

위 두 명령은 출력 없이 종료되면 정상입니다.

## 14. 로그 확인

전체 로그:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod logs -f
```

서비스별 로그:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod logs -f frontend
docker compose -f docker-compose.prod.yml --env-file .env.prod logs -f backend
docker compose -f docker-compose.prod.yml --env-file .env.prod logs -f celery-worker
docker compose -f docker-compose.prod.yml --env-file .env.prod logs -f celery-engine-worker
docker compose -f docker-compose.prod.yml --env-file .env.prod logs -f titiler-cache
```

## 15. 설치 후 최소 기능 확인

브라우저에서 다음을 확인합니다.

1. `http://배포PC_IP:18200/` 접속
2. 데이터셋 목록에 실제 `/media/dell/data/Data/orthomosaic` 정사영상이 등록됐는지 확인
3. 프로젝트 생성 화면에서 과년도/당해년도 선택
4. 중첩률 표시
5. 프로젝트 상세보기 진입
6. 리포트 PDF 다운로드
7. PDF가 건물변화/도로변화 페이지로 나뉘고 그래프가 표시되는지 확인

## 참고

이번 패키지 생성 전 확인된 사항:

- frontend typecheck 통과
- dev Vite build 통과
- prod compose config 통과
- prod frontend build 통과
- prod backend build 통과
- prod 전체 compose build 통과
- backend 컨테이너 내부 `tests/test_dataset_preflight_api.py` 통과
- `tile_path` 없는 시드 데이터셋은 bbox 기준 metadata preflight fallback 적용
- 정사영상 폴더 스캔은 하위 폴더까지 재귀 스캔
- 운영 seed 기본값은 demo datasets/tasks/detections 제외, 전체 도엽 격자 등록
- 배포 패키지를 다시 풀어서 prod frontend/backend build 통과
- prod frontend build에서 `patch-package`가 `dbf@0.1.4`, `shp-write@0.3.2` 패치를 적용하는 것 확인
