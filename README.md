# 변화탐지 플랫폼

> 공간정보품질관리원의 AI 기반 품질검증 지원 시스템 — 변화탐지 모듈
> 항공·위성 정사영상 2장으로 변화탐지 후, 도엽 단위로 검수해 수시갱신 대상 산출

---

## 무엇을 하는 시스템인가

기준 정사영상과 비교 정사영상 2장을 입력받아 AI 모델로 변화 객체(폴리곤)를 산출하고, 각 폴리곤에 검수자가 오류분류를 부여해 품질이 보증된 변화탐지 결과를 만든다.

- **1차 사용자**: 품관원 검수자
- **출력**: SHP / DXF / PDF로 검수 결과 다운로드
- **운영 환경**: 사내 내부망, 단일 사용자
- **사업 기간**: 2025.12 ~ 2026.6

---

## 시작하기

본 프로젝트의 모든 셋업·개발은 **Claude Code로 진행**한다. 사용자는 Docker만 설치하고 Claude Code에 프롬프트를 던지면 된다.

### 사전 요구사항

- Docker Desktop 또는 Docker Engine + Docker Compose
- (모델 추론용) NVIDIA GPU + CUDA Driver
- Claude Code 사용 가능 환경

### 첫 번째 작업

1. 본 리포지토리를 빈 디렉토리에 클론한다.
2. `docs/PROJECT_BRIEF.md`, `docs/DESIGN_SYSTEM.md`, `docs/FEATURE_SPEC.md` 가 배치되어 있는지 확인.
3. Claude Code를 열고 `PROMPTS.md`의 **이정표 1 — 셋업** 프롬프트를 복사·붙여넣는다.
4. Claude Code가 셋업을 진행한다 (Docker 설정·시작점 코드·더미 데이터까지).
5. 셋업 완료 후 `docker compose up -d` 로 전체 시스템 기동.
6. 다음 이정표로 진행.

이정표 6개 — 약 14일 작업.

| # | 이정표 | 완료 시점 | 검증 |
|---|---|---|---|
| 1 | 셋업 | Day 1 | `docker compose up`으로 모든 컨테이너 정상, 빈 프론트엔드 페이지 표시 |
| 2 | 도엽 목록 동작 | Day 3 | `/sheets`에서 도엽 카드·지도 표시 |
| 3 | 도엽 검수 상세 동작 | Day 7 | 폴리곤 시각화 + 오류분류 부여 가능 |
| 4 | 데이터셋·위저드 동작 | Day 10 | 정사영상 업로드 + 변화탐지 작업 등록 |
| 5 | 모델 통합 + Export | Day 12 | End-to-end 흐름 + SHP/DXF/PDF 다운로드 |
| 6 | 운영 배포 준비 | Day 14 | Nginx + 배포용 설정 완료 |

---

## 시스템 구성

```
[브라우저]
    │  HTTP
    ▼
[Nginx] ─────► 정적 프론트엔드 (React 빌드 산출물)
    │
    ├──► [FastAPI]
    │       ├── PostgreSQL + PostGIS (도엽·폴리곤·이력)
    │       ├── Redis ──► Celery worker (변화탐지 모델 추론)
    │       └── Storage (TIFF 원본·COG)
    │
    └──► [TiTiler] ──► COG 정사영상 → XYZ 타일
```

### 기술 스택

- **프론트엔드**: React 18 + TypeScript + Vite + Tailwind 3.4 + Zustand + React-Leaflet + recharts + AG Grid
- **백엔드**: FastAPI + SQLAlchemy + Alembic + Pydantic
- **DB**: PostgreSQL 15 + PostGIS 3
- **큐**: Celery + Redis
- **영상 서빙**: TiTiler (COG 기반)
- **컨테이너**: Docker + Docker Compose
- **리버스 프록시**: Nginx

---

## 디렉토리 구조

```
nbm-update-discovery/
├── README.md                      본 문서
├── CLAUDE.md                      Claude Code 작업 규칙 (매 세션 자동 참조)
├── PROMPTS.md                     이정표별 Claude Code 프롬프트 모음
│
├── docker-compose.yml
├── docker-compose.prod.yml
├── nginx.conf
│
├── docs/
│   ├── PROJECT_BRIEF.md           권위 문서 — 도메인·데이터·워크플로우
│   ├── DESIGN_SYSTEM.md           권위 문서 — 시각
│   ├── FEATURE_SPEC.md            권위 문서 — 기능
│   ├── INTEGRATION_PLAN.md        백엔드 통합 트랙 (이정표 4·5·6 활성)
│   ├── BACKEND_API_SPEC.md        백엔드 API 명세 (이정표 4·5 활성)
│   └── PROGRESS.md                Claude Code 진행 상황 누적
│
├── frontend/                      React + TypeScript
│   ├── Dockerfile
│   ├── Dockerfile.prod
│   ├── nginx.prod.conf
│   ├── package.json
│   ├── vite.config.ts
│   ├── tailwind.config.js
│   ├── tsconfig.json
│   ├── index.html
│   ├── public/
│   │   └── data/                  더미 GeoJSON·JSON (이정표 1 mock)
│   └── src/
│       ├── api/                   백엔드 API 호출 단일 접점
│       ├── components/
│       │   ├── Common/            기초 UI 컴포넌트
│       │   ├── Layout/            Header, Sidebar, AppShell
│       │   ├── Landing/           랜딩 페이지
│       │   ├── Sheets/            /sheets
│       │   ├── SheetDetail/       /sheets/:code
│       │   └── Datasets/          /datasets
│       ├── stores/                Zustand
│       ├── services/              upload, exporters
│       ├── utils/                 auth, constants, geoUtils, formatters
│       ├── types/                 도메인 타입
│       ├── pages/                 라우트 진입점
│       └── hooks/
│
├── backend/                       FastAPI
│   ├── Dockerfile
│   ├── Dockerfile.prod
│   ├── requirements.txt
│   ├── alembic/
│   ├── alembic.ini
│   └── app/
│       ├── main.py
│       ├── config.py
│       ├── database.py
│       ├── api/                   라우터
│       ├── models/                SQLAlchemy
│       ├── schemas/               Pydantic
│       ├── services/              비즈니스 로직
│       ├── workers/               Celery 작업
│       └── utils/
│
├── engines/
│   └── change-detection/          변화탐지 모델 호출 wrapper
│       ├── Dockerfile
│       └── (모델 코드 또는 호출 인터페이스)
│
└── scripts/
    ├── inject-cog.sh
    ├── generate_dummy_detections.py
    └── healthcheck.sh
```

---

## 일상적 명령

```bash
# 전체 기동 (개발)
docker compose up -d

# 개발 브라우저 진입점. 같은 PC는 localhost, LAN 다른 PC는 서버 IP:18210 사용.
curl -fsS http://127.0.0.1:${NBM_DEV_WEB_PORT:-18210}/health

# 로그 확인
docker compose logs -f frontend
docker compose logs -f backend
docker compose logs -f celery-worker
docker compose logs -f celery-engine-worker

# 특정 서비스 재시작
docker compose restart frontend

# 컨테이너 안에서 명령 실행
docker compose exec backend alembic upgrade head
docker compose exec backend python scripts/seed.py

# 변화탐지 엔진 런타임 확인
docker compose exec celery-engine-worker nvidia-smi -L
docker compose exec celery-engine-worker python /engines/pm/02_Road_CD/workspace/predict.py --help
docker compose exec celery-engine-worker python /engines/pm/04_Building_CD/workspace/predict.py --help

# 전체 종료
docker compose down

# 볼륨 포함 완전 정리 (DB 데이터 삭제됨)
docker compose down -v
```

---

## 배포 전 점검

개발/검증은 기본 `docker-compose.yml`을 쓰고, 계속 켜둘 운영 서버는 `docker-compose.prod.yml`을 쓴다.
설치 시 인터넷이 가능한 환경에서 이미지를 빌드해 두면, 실제 운영 중에는 외부 네트워크 없이 내부망에서 동작한다.

포트 정책은 다음을 기준으로 한다. Aerial-survey-manager는 `18100`을 쓰며 이 repo에서 변경하지 않는다. NBM 배포는 `COMPOSE_PROJECT_NAME=nbm_update`, `HOST_BIND=0.0.0.0`, `NBM_WEB_PORT=18200`으로 고정한다. 기존 개발 데이터는 `COMPOSE_PROJECT_NAME=nbm-update-discovery` volume에 있으므로 개발 stack은 이 project name을 유지하고 `NBM_DEV_HOST_BIND=0.0.0.0`, `NBM_DEV_WEB_PORT=18210`을 쓴다. 브라우저는 개발 `http://<서버 IP>:18210`, 배포 `http://<서버 IP>:18200`으로만 접속하고 backend/TiTiler 직접 포트 대신 `/api`, `/health`, `/titiler`, `/vworld` same-origin 경로를 사용한다.

새 운영 서버 설치 순서와 `.env.prod` 작성 방법은 `docs/DEPLOY_INSTALL_GUIDE.md`를 따른다.

다른 서버에 배포할 때는 `.env.prod.example`을 `.env.prod`로 복사한 뒤 호스트 경로와 비밀값을 먼저 바꾼다.

```bash
cp .env.prod.example .env.prod
# HOST_ORTHOMOSAIC_DIR, HOST_EXPORT_OUTPUT_DIR, HOST_DEM_DIR, HOST_VWORLD_TILES_DIR 수정
# POSTGRES_PASSWORD, DATABASE_URL, JWT_SECRET, SECRET_KEY 수정
```

설치/빌드 시점 점검:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod config --quiet
docker compose -f docker-compose.prod.yml --env-file .env.prod build
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d
docker compose -f docker-compose.prod.yml --env-file .env.prod exec backend alembic upgrade head
docker compose -f docker-compose.prod.yml --env-file .env.prod exec backend python scripts/seed.py
curl -fsS http://localhost:${NBM_WEB_PORT:-18200}/
docker compose -f docker-compose.prod.yml --env-file .env.prod exec celery-engine-worker nvidia-smi -L
docker compose -f docker-compose.prod.yml --env-file .env.prod exec celery-engine-worker sh -lc 'test -s /engines/pm/02_Road_CD/workspace/model/best_road.pth'
docker compose -f docker-compose.prod.yml --env-file .env.prod exec celery-engine-worker sh -lc 'test -s /engines/pm/04_Building_CD/workspace/model/best_building.pth'
```

현재 기본 런타임은 실제 백엔드/실제 변화탐지 알고리즘이다. 프론트 mock은 `VITE_USE_MOCK=true`로 명시한 경우에만 켠다.

---

## 검수자 워크플로우 (1차 출시 시점)

1. `/datasets`에서 정사영상 2장을 업로드 또는 기존 자원 선택
2. "신규 변화탐지 작업" 위저드로 작업 등록 (자원 2개 + 객체 카테고리 선택)
3. 백엔드가 Celery로 모델 추론 (건물 모델 + 도로 모델 각각, 진행률 폴링)
4. 결과 폴리곤이 도엽별로 분할되어 DB에 저장
5. `/sheets`에서 검수할 도엽 선택
6. `/sheets/:code`에서 폴리곤 검토 + 오류분류 부여
7. 도엽 검수 완료 처리
8. SHP/DXF/PDF로 검수 결과 export

---

## 주요 결정사항

| 항목 | 결정 |
|---|---|
| 비교 유형 | 정사영상-정사영상만. 수치지도-정사영상은 별도 플랫폼 |
| 인증 | 1차 출시 미적용 (단일 사용자, 내부망) |
| 데이터 보존 | PostGIS DB. mock 단계의 localStorage는 셋업 직후만 |
| 좌표계 | 파일 EPSG:5186, 프론트 런타임 EPSG:4326 |
| 지도 라이브러리 | React-Leaflet (OpenLayers 금지) |
| Export | SHP / DXF / PDF 클라이언트 측 생성 |

---

## 권위 문서

본 프로젝트의 단일 진실 원천:

| 영역 | 문서 |
|---|---|
| 도메인 의미·데이터 스키마·워크플로우 | `docs/PROJECT_BRIEF.md` |
| 시각 표현 (색·폰트·간격·radius·shadow) | `docs/DESIGN_SYSTEM.md` |
| 화면 구조·인터랙션·상태 전이 | `docs/FEATURE_SPEC.md` |
| 백엔드 통합 트랙 (이정표 4·5·6) | `docs/INTEGRATION_PLAN.md` |
| 백엔드 API 명세 (이정표 4·5) | `docs/BACKEND_API_SPEC.md` |
| Claude Code 작업 규칙·게이트 플로우 | `CLAUDE.md` |
| Claude Code에 던질 프롬프트 | `PROMPTS.md` |

문서 충돌 시: 도메인은 PROJECT_BRIEF 우선 → 시각은 DESIGN_SYSTEM 우선 → 기능은 FEATURE_SPEC 우선 → 작업 규칙은 CLAUDE.md.

---

## License

내부 사용 전용.
