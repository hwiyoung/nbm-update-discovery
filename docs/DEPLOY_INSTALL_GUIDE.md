# 변화탐지 플랫폼 운영 서버 설치 가이드

이 문서는 `nbm-update-discovery-deploy-*.tar.gz` 배포 패키지를 새 운영 서버에 설치하는 절차를 설명한다.
목표는 현재 개발/검증 서버와 동일하게 실제 백엔드, 실제 도로/건물 변화탐지 알고리즘, 오프라인 베이스맵, 결과물 저장 경로가 동작하도록 구성하는 것이다.

## 1. 설치 전 준비

### 서버 요구사항

- Ubuntu 계열 Linux 서버
- Docker Engine 및 Docker Compose plugin
- NVIDIA GPU, NVIDIA Driver, NVIDIA Container Toolkit
- 설치 및 이미지 빌드 시점의 인터넷 연결
- 운영 중에는 내부망/오프라인 동작 가능
- 배포 패키지 5GB 이상, Docker 이미지/모델/산출물을 포함해 여유 디스크 30GB 이상 권장

설치 서버에서 먼저 확인한다.

```bash
docker --version
docker compose version
nvidia-smi
sudo systemctl enable --now docker
```

GPU 컨테이너 런타임도 확인한다. 이 명령은 설치 시점에 인터넷이 필요할 수 있다.

```bash
docker run --rm --gpus all nvidia/cuda:12.1.1-base-ubuntu22.04 nvidia-smi
```

위 명령이 실패하면 변화탐지 GPU 워커가 뜨지 않는다. Docker/NVIDIA Container Toolkit 설정을 먼저 복구해야 한다.

## 2. 배포 패키지 해제

예시는 `/opt`에 설치하는 기준이다. 다른 경로에 설치해도 되지만 이후 명령은 해당 경로에서 실행해야 한다.

```bash
sudo mkdir -p /opt
sudo tar -xzf /path/to/nbm-update-discovery-deploy-YYYYMMDD-HHMMSS.tar.gz -C /opt
sudo chown -R "$USER:$USER" /opt/nbm-update-discovery
cd /opt/nbm-update-discovery
```

패키지에는 다음이 포함되어야 한다.

- `docker-compose.prod.yml`
- `.env.prod.example`
- `frontend/`, `backend/`
- `innopam-PM2022004-digital/02_Road_CD`
- `innopam-PM2022004-digital/04_Building_CD`
- `docs/DEPLOY_INSTALL_GUIDE.md`

기존 소스 clone 폴더, `exports`, `.env`, `frontend/dist`는 배포 패키지에서 제외된다.

## 3. 운영 데이터 경로 준비

호스트의 실제 파일은 컨테이너 안에서 고정 경로로 마운트된다.

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

## 5. 설치 시점 빌드

운영 중 오프라인으로 사용할 예정이라도, 아래 빌드는 인터넷이 가능한 설치 시점에 반드시 끝내야 한다. 특히 GPU 알고리즘 워커 이미지는 `urban_cd_v1` 공통 코드를 빌드 중 다운로드한다.

먼저 compose 설정이 유효한지 확인한다.

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod config --quiet
```

이미지를 빌드한다.

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod build
```

빌드가 완료되면 외부 네트워크 연결 없이도 이미 빌드된 Docker 이미지로 운영할 수 있다. 단, 이미지를 삭제하거나 새 서버로 옮긴 뒤 다시 빌드해야 하는 경우에는 인터넷 또는 별도의 `docker save/load` 이미지 전달 절차가 필요하다.

## 6. 최초 기동 및 DB 초기화

서비스를 시작한다.

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d
```

상태를 확인한다.

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod ps
```

DB 마이그레이션과 도엽 seed를 적용한다.

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod exec backend alembic upgrade head
docker compose -f docker-compose.prod.yml --env-file .env.prod exec backend python scripts/seed.py
```

서비스 헬스를 확인한다.

```bash
curl -fsS http://localhost:${NBM_WEB_PORT:-18200}/
curl -fsS http://localhost:${NBM_WEB_PORT:-18200}/health
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
