# 변화탐지 플랫폼 운영 서버 설치 가이드

이 문서는 버전 태그에서 생성한 오프라인 배포 세트를 새 운영 서버에 설치하는 절차를 설명한다.
목표는 현재 개발/검증 서버와 동일하게 실제 백엔드, 실제 도로/건물 변화탐지 알고리즘, 오프라인 베이스맵, 결과물 저장 경로가 동작하도록 구성하는 것이다.

배포 세트는 다음 두 파일과 무결성 파일로 구성된다.

- `nbm-update-discovery-app-images-vX.Y.Z-linux-amd64.tar.gz`: 실행 코드와 모든 Docker 이미지
- `nbm-update-discovery-models-pm-XXXXXXXX-linux-amd64.tar.gz`: 실제 도로·건물 모델 가중치
- `PACKAGE_MANIFEST.json`, `SHA256SUMS`: 소스·submodule·이미지 버전과 파일 무결성

온라인 빌드 PC에서는 태그가 checkout된 깨끗한 작업트리에서 다음 명령으로 생성한다.

```bash
scripts/build-offline-package.sh X.Y.Z
```

생성물은 `releases/vX.Y.Z/`에 저장된다. 모델이 포함된 배포 세트는 공개 GitHub Release에 올리지 않고 승인된 저장소나 이동식 매체로 전달한다.

## 1. 설치 전 준비

### 서버 요구사항

- Ubuntu 계열 Linux 서버
- Docker Engine 및 Docker Compose plugin
- NVIDIA GPU, NVIDIA Driver, NVIDIA Container Toolkit
- Docker와 NVIDIA Container Toolkit 설치를 위한 OS별 오프라인 설치 매체 또는 사전 설치
- 운영 중 외부 인터넷 연결 불필요
- Docker 이미지와 모델 압축 해제 공간을 포함해 여유 디스크 50GB 이상 권장

설치 서버에서 먼저 확인한다.

```bash
docker --version
docker compose version
nvidia-smi
sudo systemctl enable --now docker
```

GPU 컨테이너 런타임은 이미지 적재 후 `celery-engine-worker`의 `nvidia-smi -L`로 확인한다. 완전 오프라인 서버에서는 테스트를 위해 `nvidia/cuda` 이미지를 새로 pull하지 않는다.

## 2. 배포 패키지 검증 및 해제

예시는 `/opt`에 설치하는 기준이다. 다른 경로에 설치해도 되지만 이후 명령은 해당 경로에서 실행해야 한다.

배포 세트 파일을 같은 디렉터리에 둔 뒤 먼저 checksum을 확인한다.

```bash
cd /path/to/release-set
sha256sum -c SHA256SUMS
```

애플리케이션과 모델 압축 파일은 동일한 설치 루트에 차례로 해제한다. 모델 압축 파일이 Git의 0바이트 placeholder를 실제 가중치로 덮어쓴다.

```bash
sudo mkdir -p /opt
sudo tar -xzf nbm-update-discovery-app-images-vX.Y.Z-linux-amd64.tar.gz -C /opt
sudo tar -xzf nbm-update-discovery-models-pm-XXXXXXXX-linux-amd64.tar.gz -C /opt
sudo chown -R "$USER:$USER" /opt/nbm-update-discovery
cd /opt/nbm-update-discovery
sha256sum -c MODEL_SHA256SUMS
```

패키지에는 다음이 포함되어야 한다.

- `docker-compose.prod.yml`
- `.env.prod.example`
- `frontend/`, `backend/`
- `innopam-PM2022004-digital/02_Road_CD`
- `innopam-PM2022004-digital/04_Building_CD`
- `images/docker-images.tar`, `images/IMAGES.txt`
- `scripts/load-images.sh`, `scripts/install-offline.sh`, `scripts/verify-offline.sh`
- `PACKAGE_MANIFEST.json`, `MODEL_SHA256SUMS`
- `docs/DEPLOY_INSTALL_GUIDE.md`

기존 소스 clone 폴더, `exports`, `.env`, `frontend/dist`는 배포 패키지에서 제외된다.

## 3. 운영 데이터 경로 준비

호스트의 실제 파일은 컨테이너 안에서 고정 경로로 마운트된다.

애플리케이션·이미지 패키지와 모델 패키지는 DEM, VWorld 타일, 초기 정사영상을 포함하지 않는다. 필요한 현장 데이터는 별도 저장 매체로 전달하고 아래 `HOST_*` 경로에 배치한다. 신규 설치에서 초기 정사영상이 필요하지 않다면 orthomosaic 디렉터리는 비어 있어도 된다.

| 용도 | 호스트 `.env.prod` 값 | 컨테이너 내부 경로 |
|---|---|---|
| 입력 정사영상 풀 및 웹 업로드 저장 | `HOST_ORTHOMOSAIC_DIR` | `/data/orthomosaic` |
| 변화탐지 결과물, SHP/DXF/PDF, 알고리즘 실행 산출물 | `HOST_EXPORT_OUTPUT_DIR` | `/data/storage/exports` |
| 3D DXF용 DEM `.img` 타일 | `HOST_DEM_DIR` | `/data/dem` |
| 오프라인 VWorld 타일 | `HOST_VWORLD_TILES_DIR` | `/data/vworld_tiles` |

권장 기본 경로는 다음과 같다.

```bash
sudo mkdir -p /data/nbm/orthomosaic
sudo mkdir -p /data/nbm/exports
sudo mkdir -p /data/nbm/dem
sudo mkdir -p /data/nbm/vworld_tiles
sudo chown -R "$USER:$USER" /data/nbm
```

현재 검증 서버와 최대한 동일한 경로를 쓰려면 설치 서버의 디스크 구성이 같은 경우에만 아래처럼 설정한다.

```env
HOST_ORTHOMOSAIC_DIR=/media/innopam/InnoPAM-8TB/orthomosaic
HOST_EXPORT_OUTPUT_DIR=/media/innopam/InnoPAM-8TB/smcho/code/nbm-update-discovery/exports
HOST_DEM_DIR=/media/innopam/InnoPAM-8TB/data/DEM/5m통합성과
HOST_VWORLD_TILES_DIR=/media/innopam/InnoPAM-8TB/data/vworld_tiles
```

설치 서버의 디스크 경로가 다르면 위 값을 그대로 쓰지 말고 실제 서버 경로로 바꾼다. 중요한 것은 컨테이너 내부 경로가 아니라 `.env.prod`의 `HOST_*` 값이 실제 존재하는 호스트 경로를 가리키는 것이다.

## 4. `.env.prod` 생성 및 수정

운영 설정 파일을 만든다.

```bash
cp .env.prod.example .env.prod
```

비밀번호와 시크릿을 생성한다.

```bash
python3 - <<'PY'
import secrets
print("POSTGRES_PASSWORD=" + secrets.token_urlsafe(24))
print("JWT_SECRET=" + secrets.token_urlsafe(48))
print("SECRET_KEY=" + secrets.token_urlsafe(48))
PY
```

`.env.prod`를 연다.

```bash
nano .env.prod
```

반드시 수정할 항목은 다음이다.

```env
COMPOSE_PROJECT_NAME=nbm_update
HOST_BIND=0.0.0.0
NBM_WEB_PORT=18200

POSTGRES_USER=nbm
POSTGRES_PASSWORD=<생성한 DB 비밀번호>
POSTGRES_DB=nbm
DATABASE_URL=postgresql+psycopg2://nbm:<생성한 DB 비밀번호>@postgres:5432/nbm

JWT_SECRET=<생성한 JWT_SECRET>
SECRET_KEY=<생성한 SECRET_KEY>

VITE_API_BASE_URL=/api/v1
VITE_USE_MOCK=false

HOST_ORTHOMOSAIC_DIR=/data/nbm/orthomosaic
HOST_EXPORT_OUTPUT_DIR=/data/nbm/exports
HOST_DEM_DIR=/data/nbm/dem
HOST_VWORLD_TILES_DIR=/data/nbm/vworld_tiles
```

`POSTGRES_PASSWORD`와 `DATABASE_URL` 안의 비밀번호는 반드시 같아야 한다. 최초 기동 후 DB 볼륨이 생성된 뒤에는 이 값을 임의로 바꾸지 않는다. 바꾸면 기존 DB 컨테이너가 인증 실패 상태가 될 수 있다.

일반적으로 유지할 항목은 다음이다.

```env
CHANGE_DETECTION_QUEUE=engine
CHANGE_DETECTION_ENGINE_MODE=algorithm
CHANGE_DETECTION_WORKSPACE_ROOT=/data/storage/exports
CHANGE_DETECTION_SHM_SIZE=16gb
CHANGE_DETECTION_BATCH_SIZE=1
CHANGE_DETECTION_PATCH_SIZE=1024
CHANGE_DETECTION_OVERLAP_RATIO=25

ROAD_CONFIDENCE_THRESHOLD=0.45
ROAD_MIN_AREA_M2=30
ROAD_SIMPLIFY_TOLERANCE=0.8

BUILDING_CONFIDENCE_THRESHOLD=0.7
BUILDING_MIN_AREA_M2=20
BUILDING_MIN_COMPONENT_PIXELS=200
BUILDING_SIMPLIFY_TOLERANCE=0.2

SHEET_INDEX_PATH=/data/seed/sheets_grid_5179.geojson
SHEET_CODE_FIELD=MAPIDCD_NO
DEM_DIR=/data/dem
DEM_FILENAME_PATTERN={sheet_code}.img
DEM_SAMPLE_METHOD=bilinear
DEM_TARGET_CRS=EPSG:5186
EXPORT_OUTPUT_ROOT=/data/storage/exports
ORTHOMOSAIC_DIR=/data/orthomosaic
```

도로/건물 threshold 값은 현재 검증된 값이다. 모델 동작을 재조율하기 전까지 변경하지 않는 것을 권장한다.

nbm-update 스택의 host publish 포트는 `HOST_BIND:NBM_WEB_PORT -> frontend/nginx:80` 하나만 사용한다. 내부망 다른 PC에서는 `http://배포PC_내부IP:18200`으로 접속한다.
Aerial-survey-manager는 `18100`을 사용하며 이 repo에서 변경하지 않는다. 같은 PC에서 개발 stack을 동시에 띄울 때는 기존 개발 데이터 volume을 보존하기 위해 개발용 `.env`의 `COMPOSE_PROJECT_NAME=nbm-update-discovery`, `NBM_DEV_HOST_BIND=0.0.0.0`, `NBM_DEV_WEB_PORT=18210`을 사용한다.

## 5. 오프라인 이미지 적재

완전 오프라인 서버에서는 이미지를 빌드하거나 pull하지 않는다. 패키지에 포함된 이미지 tar를 먼저 적재한다.

먼저 compose 설정이 유효한지 확인한다.

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod config --quiet
```

이미지를 적재한다.

```bash
scripts/load-images.sh
```

`images/IMAGES.txt`의 모든 이미지가 확인되어야 한다. 오프라인 서버에서 `docker compose build`를 실행하면 pip/npm/GitHub 및 외부 registry 접근 때문에 실패한다.

## 6. 최초 기동 및 DB 초기화

최초 설치에서는 DB·Redis만 먼저 시작하고, one-off backend 컨테이너로 마이그레이션과 seed를 적용한 다음 전체 서비스를 시작한다. 이렇게 해야 빈 DB에 backend가 먼저 접근하면서 일시적인 테이블 없음 오류를 남기지 않는다. 이미지가 없을 때 외부 registry로 접근하지 않도록 모든 기동 명령에 `--no-build`를 사용한다.

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod \
  up -d --no-build --wait postgres redis

docker compose -f docker-compose.prod.yml --env-file .env.prod \
  run --rm --no-deps backend alembic upgrade head

docker compose -f docker-compose.prod.yml --env-file .env.prod \
  run --rm --no-deps backend python scripts/seed.py

docker compose -f docker-compose.prod.yml --env-file .env.prod \
  up -d --no-build --wait
```

상태를 확인한다.

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod ps
```

서비스 헬스를 확인한다.

```bash
curl -fsS http://localhost:${NBM_WEB_PORT:-18200}/
curl -fsS http://localhost:${NBM_WEB_PORT:-18200}/health
```

이미지 적재부터 마이그레이션·seed·최소 검증까지 자동 실행하려면 다음 명령을 사용한다.

```bash
scripts/install-offline.sh
```

브라우저에서는 다음 주소로 접속한다.

```text
http://<서버 IP>:18200/
```

브라우저와 점검 스크립트는 backend/TiTiler host port 를 직접 호출하지 않는다. 항상 같은 origin 의 `/api`, `/health`, `/titiler`, `/vworld` 경로를 사용한다.

```text
http://<서버 IP>:18200/api/v1/...
http://<서버 IP>:18200/titiler/...
```

## 7. 알고리즘/데이터 경로 확인

GPU 워커가 GPU를 보는지 확인한다.

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod exec celery-engine-worker nvidia-smi -L
```

도로/건물 모델 가중치가 컨테이너에서 보이는지 확인한다.

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod exec celery-engine-worker \
  sh -lc 'test -s /engines/pm/02_Road_CD/workspace/model/best_road.pth && echo road-ok'

docker compose -f docker-compose.prod.yml --env-file .env.prod exec celery-engine-worker \
  sh -lc 'test -s /engines/pm/04_Building_CD/workspace/model/best_building.pth && echo building-ok'
```

호스트 저장 경로가 컨테이너에 제대로 마운트됐는지 확인한다.

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod exec backend \
  sh -lc 'python - <<PY
from pathlib import Path
for p in ["/data/orthomosaic", "/data/storage/exports", "/data/dem"]:
    x = Path(p)
    print(p, "exists=", x.exists(), "items=", len(list(x.glob("*"))) if x.exists() else "-")
PY'
```

입력 정사영상은 `HOST_ORTHOMOSAIC_DIR`에 `.tif` 또는 `.tiff`로 넣으면 백엔드가 주기적으로 스캔해 데이터셋으로 등록한다. 웹 업로드를 사용해도 같은 폴더에 저장된다.

## 8. 로그 확인

전체 로그:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod logs -f
```

주요 서비스별 로그:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod logs -f frontend
docker compose -f docker-compose.prod.yml --env-file .env.prod logs -f backend
docker compose -f docker-compose.prod.yml --env-file .env.prod logs -f celery-worker
docker compose -f docker-compose.prod.yml --env-file .env.prod logs -f celery-engine-worker
docker compose -f docker-compose.prod.yml --env-file .env.prod logs -f titiler-cache
```

변화탐지 실행 중 패치 생성, 추론, 재구성, 벡터화 진행 상황은 주로 `celery-engine-worker` 로그와 `HOST_EXPORT_OUTPUT_DIR/<task-id>/status.json`에서 확인한다.

## 9. 운영 중 재시작/중지

재시작:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod restart
```

중지:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod down
```

DB까지 삭제하는 명령은 운영 서버에서 사용하지 않는다.

```bash
# 운영 서버에서 금지: DB 볼륨 삭제
docker compose -f docker-compose.prod.yml --env-file .env.prod down -v
```

## 10. 업그레이드 절차

새 배포 패키지를 같은 서버에 반영할 때는 `.env.prod`, Docker volume, `HOST_*` 데이터 폴더를 유지한다.

```bash
cd /opt/nbm-update-discovery
docker compose -f docker-compose.prod.yml --env-file .env.prod down
```

기존 설정을 백업한다.

```bash
cp .env.prod ../nbm-update-discovery.env.prod.backup.$(date +%Y%m%d-%H%M%S)
```

새 패키지를 별도 위치에 풀거나 기존 소스를 교체한 뒤, 기존 `.env.prod`를 다시 배치한다.

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod config --quiet
docker compose -f docker-compose.prod.yml --env-file .env.prod build
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d
docker compose -f docker-compose.prod.yml --env-file .env.prod exec backend alembic upgrade head
```

프론트 파비콘, 대시보드 문구처럼 프론트 소스만 바뀐 경우에도 운영 이미지는 다시 빌드해야 한다.

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod build frontend
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d frontend
```

## 11. 설치 후 최소 테스트

설치 직후 다음 순서로 확인한다.

1. 브라우저에서 메인 화면 접속
2. 데이터셋 목록에 `HOST_ORTHOMOSAIC_DIR`의 정사영상이 표시되는지 확인
3. 신규 변화탐지 작업 생성
4. 요청 모델이 건물/도로 각각 또는 둘 다 선택되는지 확인
5. 메인 화면 좌측 작업 목록에서 진행률이 갱신되는지 확인
6. `docker compose ... logs -f celery-engine-worker`에서 패치 생성/추론/재구성/벡터화 로그 확인
7. 완료 후 상세 화면에서 건물 변화/도로 변화 레이어 on/off 확인
8. `HOST_EXPORT_OUTPUT_DIR/<task-id>`에 산출물이 생성되는지 확인
9. SHP/DXF/PDF/3D DXF export 동작 확인

## 12. 자주 나는 설정 오류

### 웹은 뜨는데 데이터셋이 안 보임

- `HOST_ORTHOMOSAIC_DIR` 경로가 실제로 존재하는지 확인
- `.tif`/`.tiff` 파일이 해당 폴더에 있는지 확인
- backend 로그에서 orthomosaic scan 메시지 확인

### 변화탐지 작업이 계속 대기 상태

- `CHANGE_DETECTION_QUEUE=engine`인지 확인
- `celery-engine-worker`가 떠 있는지 확인
- `celery-engine-worker`가 GPU를 보는지 `nvidia-smi -L`로 확인

### 추론이 바로 실패

- 도로/건물 가중치 파일이 있는지 확인
- 입력 T1/T2 영상 좌표계와 겹치는 영역이 있는지 확인
- `HOST_EXPORT_OUTPUT_DIR`에 쓰기 권한이 있는지 확인

### 3D DXF가 실패

- `HOST_DEM_DIR`에 `{sheet_code}.img` 형식의 DEM 파일이 있는지 확인
- `DEM_FILENAME_PATTERN={sheet_code}.img`가 실제 파일명 규칙과 맞는지 확인

### 포트 충돌

- NBM 배포 진입점은 `NBM_WEB_PORT=18200`으로 고정한다.
- `18200`이 이미 사용 중이면 다른 NBM stack 또는 잘못 뜬 개발 stack을 먼저 확인한다. Aerial-survey-manager의 `18100`은 이 repo에서 변경하지 않는다.
- 개발 stack은 `0.0.0.0:18210`으로 분리되어야 하며, 브라우저에서는 `http://<서버 IP>:18210`으로 접속한다. 배포 stack의 `18200`은 사용하지 않는다.

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod ps
docker compose ps
```
