# 현재 구현/검증 보고서

작성일: 2026-05-28  
대상: `/media/innopam/InnoPAM-8TB/smcho/code/nbm-update-discovery`

## 1. 결론

현재 코드는 단순 목업 단계를 넘어, 개발 환경에서 다음 흐름이 실제로 연결되어 있다.

1. 정사영상 데이터셋 등록
2. 데이터셋 겹침 도엽 계산
3. 변화탐지 작업 생성
4. Celery GPU 워커의 실제 도로/건물 변화탐지 실행
5. 결과 폴리곤 DB 저장
6. 대시보드/지도/상세 화면 조회
7. 객체 편집/삭제/추가/이력 저장
8. SHP, 2D DXF, PDF, 3D DXF 내보내기

다만 배포 안정성 관점에서는 아직 정리해야 할 부분이 있다.

- 설치 가이드에 잘못된 헬스체크 경로가 있다. 실제는 `/health`, 문서 일부는 `/api/v1/health`를 안내한다.
- 배포 패키지를 항상 같은 방식으로 만드는 단일 스크립트가 없다.
- 운영 코드 옆에 런타임 산출물, 실험 GeoJSON, 중복 모델 소스가 섞여 있다.
- 문서 일부가 오래된 목업 단계 표현을 유지하고 있어 현재 구현과 불일치한다.

## 2. 구현된 기능

### 2.1 실행 구성

- 개발 compose: `docker-compose.yml`
  - frontend: host `0.0.0.0:18210 -> container 5173`
  - backend: FastAPI/Uvicorn, Docker 내부 `8000` only
  - postgres: PostGIS
  - redis: Celery broker/result backend
  - celery-worker: 일반 Celery worker
  - celery-engine-worker: GPU 변화탐지 worker, queue `engine`
  - titiler: COG 타일 서버
  - titiler-cache: TiTiler 캐시 nginx + VWorld 타일 정적 서버

- 배포 compose: `docker-compose.prod.yml`
  - frontend nginx static build, host `0.0.0.0:18200 -> container 80`
  - backend gunicorn/uvicorn worker
  - Postgres/Redis healthcheck
  - `restart: unless-stopped`
  - host path mount: orthomosaic, exports, DEM, VWorld tiles

### 2.2 메인 화면

진입점은 `frontend/src/pages/Landing.tsx`이다.

- 좌측: 변화탐지 프로젝트 목록
- 중앙: 대한민국 권역/도엽 처리 현황 지도
- 중앙 하단: 통계 카드, 월별/권역/상태 차트
- 우측: 데이터셋 목록
- 좌우 패널 폭 조절 및 localStorage 저장
- 진행 중 작업은 1.5초 간격으로 상태 폴링

현재 활성 라우트는 다음이다.

- `/`: 통합 대시보드
- `/tasks/:taskId`: 프로젝트 상세
- `/sheets/:sheetCode`: 레거시 도엽 상세
- `/sheets`, `/datasets`: `/`로 redirect

### 2.3 데이터셋 관리

백엔드 라우터: `backend/app/api/datasets.py`, `backend/app/api/uploads.py`, `backend/app/api/filesystem.py`

구현된 기능:

- 데이터셋 목록/단건 조회
- source/status/platform 필터
- 두 데이터셋의 도엽 교집합 비율 계산
- 데이터셋 삭제
  - 참조 중인 task가 있으면 409로 차단
- multipart TIFF 업로드
  - 저장 위치: `ORTHOMOSAIC_DIR`, 기본 컨테이너 경로 `/data/orthomosaic`
  - rasterio로 bbox/CRS 읽기
  - EPSG:5186 변환
  - PostGIS 도엽 격자와 교집합 계산
  - 성공 시 `datasets` row 생성
- 서버 파일 브라우저
  - `/media`, `/data/storage`, `/data/orthomosaic` 하위만 허용
  - 서버에 이미 있는 TIFF를 복사 없이 dataset으로 등록
- 정사영상 폴더 자동 스캔
  - FastAPI startup 1회
  - 1시간 주기
  - 수동 API: `POST /api/v1/datasets/rescan-orthomosaic`
  - 사라진 파일의 dataset row 자동 정리
  - task 참조 중인 dataset은 삭제하지 않고 보존

### 2.4 변화탐지 작업

백엔드 라우터: `backend/app/api/tasks.py`  
worker: `backend/app/workers/tasks.py`

구현된 기능:

- 작업 목록/단건 조회
- 작업 생성
  - 기준/비교 데이터셋 존재 확인
  - 공통 도엽이 없으면 생성 차단
  - `auto_run=true`면 Celery enqueue
- 작업 시작/재시작
- 작업 중단
  - Celery revoke 요청
  - DB status를 `canceled`로 변경
- 작업 삭제
  - Celery revoke 요청
  - task 산출물 디렉터리 삭제
  - 관련 sheet 메타 reset
  - 관련 detection 삭제
- 작업 메타 수정
  - name, description, models, standard/compare resource id
- progress file 저장
  - `EXPORT_OUTPUT_ROOT/<task_id>/progress.json`

### 2.5 실제 변화탐지 엔진

엔진 adapter: `backend/app/services/change_detection_engine.py`  
엔진 코드/모델: `engines/change-detection`

구현된 기능:

- 도로/건물 카테고리별 알고리즘 실행
- 기준/비교 TIFF CRS/밴드/겹침 검증
- 입력 영상이 정렬되어 있으면 symlink로 직접 사용
- 필요 시 overlap crop 생성
- 알고리즘 status.json을 읽어 progress/message/stage 반영
- 알고리즘 결과 GeoJSON을 읽어 EPSG:5186으로 정규화
- 폴리곤을 도엽에 배정
- 기존 엔진 산출 detection은 성공 후에만 purge
- 사용자가 직접 추가한 FN detection은 재실행 시 보존

라이브 로그에서 확인한 최근 작업:

- task `26bce945b558b9a104cc08b7bcb9fd7b`
  - building + road 실제 알고리즘 실행
  - road parsed records: 41
  - total inserted: 152
  - elapsed: 약 392초
  - status: `succeeded`

### 2.6 객체 검수/편집

백엔드 라우터: `backend/app/api/detections.py`, `backend/app/api/history.py`  
프론트 상세 화면: `frontend/src/pages/TaskDetail.tsx`, `frontend/src/stores/sheetDetailStore.ts`, `frontend/src/components/SheetDetail`

구현된 기능:

- task 단위 detection 조회
- sheet 단위 detection 조회
- `building_color`는 현재 응답 path에서 제외
- task_id가 없는 legacy detection은 task 화면에서 제외
- 객체 메모 수정
- 객체 model/change_type 수정
- 객체 geometry 수정 API
- 객체 soft delete/restore
- 객체 hard delete
- 신규 객체 추가
  - sheet 단위 추가
  - task 단위 추가
  - task 단위는 centroid 기준으로 sheet 자동 매칭
- 처리 이력 저장
- task 단위 처리 이력 조회
- sheet 단위 최근 이력 pop/undo

프론트에서 구현된 상세 화면 기능:

- 단일/split/swipe-x/swipe-y 지도 모드
- 변화 유형별 폴리곤 렌더링
- 객체 선택, 다중 선택, lasso box
- 신규 폴리곤 그리기
- 메모/model/change_type 수정
- soft/hard delete
- 작업 재시작/중단/삭제
- 우측 리포트 패널

남은 부분:

- vertex 단위 폴리곤 편집 UI는 코드상 아직 완성된 기능으로 보기 어렵다. `edit` 모드는 남아 있지만 주석상 추후 통합으로 표시되어 있다.

### 2.7 내보내기

프론트 exporter: `frontend/src/services/exporters/task.ts`  
백엔드 3D exporter: `backend/app/api/exports.py`, `backend/app/services/dem_z_export.py`

구현된 기능:

- SHP zip export
  - 클라이언트에서 task detections를 EPSG:5186으로 변환
  - `.prj`를 EPSG:5186으로 덮어씀
  - `shp-write` polygon record 버그는 patch-package로 보정
- 2D DXF export
  - 변화 유형별 layer
- PDF report export
  - 현재 한글 폰트 미임베드. 영문 라벨 기반
- 3D DXF export
  - 백엔드에서 detection -> 임시 GPKG
  - DEM 도엽 탐색
  - VRT 생성
  - vertex별 Z 샘플링
  - DXF 생성 및 다운로드

실제 API 검증:

- `POST /api/v1/tasks/26bce945b558b9a104cc08b7bcb9fd7b/export/dxf-3d`
- 결과:
  - total_objects: 152
  - total_vertices: 1344
  - sheets_used: 4
  - missing_sheets: 0
  - nodata_vertex_count: 0
  - elapsed_seconds: 약 0.48초
  - 생성 파일: `exports/26bce945b558b9a104cc08b7bcb9fd7b/3d_changes_20260528_092138.dxf`

### 2.8 GeoJSON import

라우터: `backend/app/api/imports.py`

구현된 기능:

- `POST /api/v1/tasks/{task_id}/import-geojson`
- 표준 FeatureCollection import
- `model`, `type`, `accuracy`, `area`, `address`, `region_code`, `memo` 정규화
- Polygon/MultiPolygon 처리
- centroid 기준 task sheet 내 도엽 매칭
- detection 일괄 insert
- sheet stats 재계산

## 3. 현재 라이브 상태

현재 포트 정책은 다음과 같다.

- frontend 개발 진입점: `http://<서버 IP>:18210`
- backend: Docker 내부 `backend:8000`, 브라우저는 `/api`와 `/health` same-origin 경유
- postgres: running
- redis: running
- celery-worker: running
- celery-engine-worker: running
- titiler: Docker 내부 `titiler:8000`
- titiler-cache: Docker 내부 `titiler-cache:8000`, 브라우저는 `/titiler`와 `/vworld` same-origin 경유

GPU 확인:

- GPU 0: NVIDIA GeForce RTX 3090
- GPU 1: NVIDIA GeForce RTX 3090

모델 파일 확인:

- `/engines/change-detection/Road_CD/workspace/model/best_road.pth`: OK
- `/engines/change-detection/Building_CD/workspace/model/best_building.pth`: OK
- road predict.py: OK
- building predict.py: OK

DB 카운트:

- sheets: 17,034
- tasks: 3
- datasets: 11
- detections: 97,173
- active task detections: 5,808
- review histories: 56
- task_id가 NULL인 legacy/mock detection: 48,807

API 확인:

- `GET /health`: 200 OK
- `GET /`: 200 OK
- `GET /api/v1/sheets`: 200 OK, 기본 응답 13개
- `GET /api/v1/tasks`: 200 OK, 3개
- `GET /api/v1/datasets`: 200 OK, 11개
- `GET /api/v1/health`: 404 Not Found

## 4. 검증 결과

PASS:

- `docker compose config --quiet`
- `docker compose -f docker-compose.prod.yml --env-file .env.prod.example config --quiet`
- `docker compose exec -T frontend npm run typecheck`
- `docker compose exec -T frontend npm run build`
- `docker compose exec -T backend pytest -q tests`
  - 18 passed
- `docker compose -f docker-compose.prod.yml --env-file .env.prod.example build frontend backend`
  - cache 사용, 성공
- live backend API smoke
- live GPU/model visibility
- live 3D DXF export

주의:

- frontend production build에서 1.09MB chunk 경고가 있다. 기능 실패는 아니지만 배포 최적화 후보다.
- prod engine image 전체 재빌드는 이번에 다시 돌리지 않았다. 기존 image는 존재한다.
  - `nbm-update-discovery-celery-engine-worker-prod:latest`
  - size: 약 14.6GB

## 5. 배포 패키지만 설치했을 때 개발 기능이 안 되는 원인

반복적으로 발생할 수 있는 원인은 다음이다.

1. 개발 compose와 prod compose가 서로 다르게 동작한다.
   - 개발은 Vite proxy, bind mount, live source를 쓴다.
   - 배포는 nginx static build, build-time env, image 안 소스를 쓴다.

2. 배포 패키지 생성 절차가 고정되어 있지 않다.
   - 어떤 파일이 포함/제외되는지 사람이 매번 판단하면 누락이 생긴다.
   - 특히 `frontend/public/favicon.png`, `frontend/patches`, `engines/change-detection`, 모델 파일, `.env.prod.example`, 설치 가이드 누락 위험이 있다.

3. 프론트 env는 runtime이 아니라 build-time이다.
   - `VITE_API_BASE_URL`, `VITE_USE_MOCK`은 image build 시 들어간다.
   - `.env.prod`를 바꿔도 frontend image를 다시 build하지 않으면 화면 동작이 바뀌지 않는다.

4. 운영 서버 host path가 개발 서버와 다르다.
   - `HOST_ORTHOMOSAIC_DIR`
   - `HOST_EXPORT_OUTPUT_DIR`
   - `HOST_DEM_DIR`
   - `HOST_VWORLD_TILES_DIR`
   - 이 경로가 비어 있거나 권한이 없으면 업로드, 스캔, 타일, 3D DXF가 깨진다.

5. GPU worker는 별도 조건이 있다.
   - NVIDIA driver
   - NVIDIA Container Toolkit
   - `gpus: all`
   - 모델 파일 존재
   - Docker image build 시 `urban_cd_v1` 다운로드 가능 여부

6. DB 마이그레이션과 seed를 배포 후 실행하지 않으면 화면은 떠도 데이터가 없다.

7. 설치 가이드 일부 경로가 코드와 맞지 않는다.
   - `/api/v1/health`는 현재 없다.

## 6. 권장 관리 방식

### 6.1 브랜치/버전 규칙

이 디렉터리는 현재 `.git` 작업트리가 아니다. 우선 git 저장소로 관리하는 것이 필요하다.

권장:

- `develop`: 개발/검증 서버용
- `release/prod`: 배포 후보
- tag: `vYYYY.MM.DD-N`
- 배포 패키지 이름: `nbm-update-discovery-deploy-vYYYY.MM.DD-N.tar.gz`

배포 패키지는 tag 기준으로만 만든다.

### 6.2 배포 전 게이트

배포 패키지를 만들기 전 반드시 같은 명령을 통과시킨다.

```bash
docker compose config --quiet
docker compose -f docker-compose.prod.yml --env-file .env.prod.example config --quiet
docker compose exec -T frontend npm run typecheck
docker compose exec -T frontend npm run build
docker compose exec -T backend pytest -q tests
docker compose -f docker-compose.prod.yml --env-file .env.prod.example build frontend backend
```

GPU/엔진 검증:

```bash
docker compose exec -T celery-engine-worker nvidia-smi -L
docker compose exec -T celery-engine-worker sh -lc 'test -s /engines/change-detection/Road_CD/workspace/model/best_road.pth'
docker compose exec -T celery-engine-worker sh -lc 'test -s /engines/change-detection/Building_CD/workspace/model/best_building.pth'
```

배포 서버 최초 설치 후:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d
docker compose -f docker-compose.prod.yml --env-file .env.prod exec backend alembic upgrade head
docker compose -f docker-compose.prod.yml --env-file .env.prod exec backend python scripts/seed.py
curl -fsS http://localhost:${APP_PORT:-80}/
curl -fsS http://localhost:${APP_PORT:-80}/health
```

### 6.3 배포 패키지 생성 원칙

패키지에는 반드시 포함:

- `docker-compose.prod.yml`
- `.env.prod.example`
- `README.md`
- `docs/DEPLOY_INSTALL_GUIDE.md`
- `backend/`
- `frontend/`
- `frontend/patches/`
- `frontend/public/favicon.png`
- `engines/change-detection/Road_CD`
- `engines/change-detection/Building_CD`
- 모델 파일

패키지에서 제외:

- `.env`
- `.env.prod`
- `frontend/dist`
- `frontend/node_modules`
- `backend/**/__pycache__`
- `backend/.pytest_cache`
- `.cache`
- `exports`
- 실험 GeoJSON
- 중복 원본 저장소 `innopam-PM2022004-digital`

### 6.4 설치 후 기능 검증 순서

배포 서버에서 최소한 다음 순서로 확인한다.

1. 메인 화면 접근
2. `/health` 200
3. dataset 목록 로드
4. `HOST_ORTHOMOSAIC_DIR` 파일 자동 등록
5. 신규 변화탐지 작업 생성
6. progress가 pending -> running -> succeeded로 변하는지 확인
7. celery-engine-worker 로그에서 patch/inference/reconstruct/vectorize 확인
8. task 상세에서 detection 렌더링 확인
9. SHP export
10. 2D DXF export
11. PDF export
12. 3D DXF export

## 7. 정리 후보

삭제 전 사용자 확인이 필요하다.

### 7.1 바로 정리해도 되는 생성물 후보

- `backend/**/__pycache__/`
- `backend/.pytest_cache/`
- `frontend/dist/`
- `.cache/`
- `frontend/vite.config.ts.timestamp-1778123123425-68537b2368aaf.mjs`
- `frontend/fabicon.png`
  - `frontend/public/favicon.png`와 SHA256이 동일하다.
  - 실제 배포/브라우저 참조는 `/favicon.png`이다.

### 7.2 런타임 산출물

- `exports/`
  - 현재 약 22MB
  - 실제 작업 결과물과 이번 검증으로 생성한 3D DXF가 들어 있다.
  - 삭제하면 기존 작업 산출물/로그/DXF가 사라진다.
  - DB task 자체는 남지만 export/log evidence는 사라진다.

이번 검증으로 추가 생성한 파일:

- `exports/26bce945b558b9a104cc08b7bcb9fd7b/3d_changes_20260528_092138.dxf`
- `exports/26bce945b558b9a104cc08b7bcb9fd7b/latest.dxf`

### 7.3 수동/실험 데이터로 보이는 파일

- `data.geojson`
  - 1,825 features
  - 표준 import 형식에 가까운 테스트 데이터로 보인다.
- `demo_balanced_excess_inspection_result.geojson`
  - 691 features
  - demo/evaluation 결과로 보인다.
- `demo_balanced_missing_inspection_result.geojson`
  - 64 features
  - demo/evaluation 결과로 보인다.
- `_edge.png`
  - 용도 미확인 이미지

삭제 여부는 확인 필요.

### 7.4 중복/대형 원본 후보

- `innopam-PM2022004-digital/`
  - 약 5.6GB
  - 내부에 `.git`만 약 494MB
  - `engines/change-detection`와 도로/건물 모델 및 predict.py가 중복된다.
  - 현재 compose는 이 폴더를 mount하지 않는다.
  - 패키지에는 포함하지 않는 것이 맞다.
  - 로컬 보관 필요가 없으면 별도 아카이브 후 삭제 후보.

- `engines/change-detection/*/workspace/input/`
  - sample input TIFF가 들어 있다.
  - Building 쪽은 약 310MB 수준.
  - Road 쪽은 0 byte TIFF 2개가 있다.
  - 실제 운영 경로는 task별 workspace/export 쪽에서 입력을 준비하므로, sample input은 배포 패키지에서 제외 가능하다.

### 7.5 DB 정리 후보

현재 DB에 `task_id IS NULL`인 detection이 48,807건 있다.

분포:

- building_updated: 20,097
- building_color: 12,441
- road_new: 4,785
- building_new: 4,466
- road_removed: 3,509
- building_removed: 1,914
- road_updated: 1,595

현재 API는 task 화면에서 이 legacy/mock detection을 제외한다. 즉 화면 동작에는 직접 필요하지 않다. 다만 DB에서 삭제하면 과거 seed/mock 데이터는 복구가 어렵다. 삭제하려면 먼저 DB 백업 후 진행해야 한다.

현재 dataset 중 task 참조가 없는 항목:

- dataset 50: `전라서부_권역_20B_피라미드.tif`
- dataset 51: `jeju_moseulpo_2023.tif`
- dataset 52: `jeju_moseulpo_2024.tif`
- dataset 55: `2025_Anyang.tif`
- dataset 58: `전라서부_권역_Project_20260527152523.tif`
- dataset 60: `수도권남부_권역_2024_6B.tif`
- dataset 61: `수도권남부_권역_2025_5B_test.tif`

이 파일들은 실제 orthomosaic 폴더에 존재한다. 테스트/수동 등록 데이터일 수 있으므로 삭제 전 확인이 필요하다.

## 8. 수정 우선순위

1. 설치 가이드의 `/api/v1/health`를 `/health`로 수정
2. 배포 패키지 생성 스크립트 추가
   - include/exclude 고정
   - SHA256SUMS 생성
   - tarball 내용 검사
   - 가능하면 `docker save` 이미지 패키지도 별도 지원
3. 문서 최신화
   - 모델 mock 표현 제거
   - 실제 알고리즘/3D DXF/통합 대시보드 기준으로 정리
4. 정리 후보 파일 삭제
   - 캐시/빌드 산출물부터
   - 수동 데이터와 DB row는 사용자 확인 후
5. frontend chunk split 검토
   - 현재 build는 성공하지만 1MB chunk 경고가 있다.
6. vertex 편집 UI 완성 여부 결정
   - 기능 요구라면 구현
   - 불필요하면 edit mode 관련 잔여 UI/문구 제거
