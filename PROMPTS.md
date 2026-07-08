# PROMPTS.md — 이정표별 Claude Code 프롬프트

> 본 문서는 Claude Code에 던질 프롬프트 모음이다. 각 이정표 프롬프트는 자체 완결이며, 새 채팅에 복사·붙여넣으면 작업이 진행된다.
> 매 이정표는 CLAUDE.md를 자동으로 읽고, Phase A → B → C → D 플로우를 따른다.

---

## 사용법

1. 이정표 시작 시 새 Claude Code 채팅을 연다.
2. 본 문서에서 해당 이정표 프롬프트를 복사한다 (`---` 사이의 코드 블록 전체).
3. Claude Code에 붙여넣는다.
4. Claude Code가 Phase A 계획을 보고하고 GATE-A에서 멈춘다.
5. 계획 검토 후 승인 (또는 수정 요청).
6. Claude Code가 Phase B → C → D 자율 진행.
7. GATE-D에서 이정표 완료 보고.
8. 검토 후 다음 이정표로.

이정표 도중 중단 시: 새 채팅에서 다음 프롬프트로 시작.

```
docs/PROGRESS.md 를 먼저 읽고, 마지막 완료 항목 다음 작업부터 진행해주세요.
현재 진행 중인 이정표는 PROMPTS.md 의 §[N]을 따른다.
```

---

## 이정표 1 — 셋업 (Day 1)

### 프롬프트

```
CLAUDE.md 를 먼저 읽어주세요.

본 작업은 변화탐지 플랫폼의 셋업 이정표입니다. PROMPTS.md §1을 따릅니다.

### 본 이정표의 목적

빈 디렉토리에서 시작해 다음 상태에 도달:
- docker compose up -d 로 모든 컨테이너 정상 기동
- 빈 프론트엔드 페이지 표시 + 권위 문서 fetch 정상
- 백엔드 /health 엔드포인트 200 응답
- 더미 데이터 (도엽 2~3개분 변화탐지 폴리곤) 준비

### 권위 문서 (먼저 읽기)

- docs/PROJECT_BRIEF.md (전체)
- docs/DESIGN_SYSTEM.md (5장 절대 규칙)
- docs/FEATURE_SPEC.md (개요)

### 산출물

#### 1. 루트 파일

- docker-compose.yml (개발용)
  - frontend: Node 20 + Vite dev server, host `0.0.0.0:18210 -> container 5173`
  - backend: Python 3.11 + FastAPI, Docker 내부 8000
  - postgres: PostgreSQL 15 + PostGIS 3, Docker 내부 5432
  - redis: Redis 7, Docker 내부 6379
  - titiler: COG 타일 서버 (developmentseed/titiler 이미지), Docker 내부 8000
  - scripts: 일회성 작업용 (Python + GDAL + geopandas)
  - 볼륨: 호스트 ./frontend, ./backend 마운트로 HMR
- .gitignore (Node, Python, IDE, OS, Docker 표준)
- .env.example (DB 패스워드, JWT 시크릿 placeholder, 향후 백엔드 통합 대비)

#### 2. frontend/ 골조

- frontend/Dockerfile (Node 20 + npm install + dev server)
- frontend/package.json
  - 의존성: react@18, react-dom@18, react-router-dom, zustand, leaflet, react-leaflet, leaflet-side-by-side, react-leaflet-cluster, leaflet-draw, ag-grid-community, ag-grid-react, recharts, react-hot-toast, @radix-ui/react-alert-dialog, @radix-ui/react-popover, lucide-react, clsx, tailwind-merge, tus-js-client, shp-write, dxf-writer, jspdf, proj4
  - devDependencies: typescript, @types/react, @types/react-dom, @types/leaflet, @types/geojson, @types/proj4, vite, @vitejs/plugin-react, tailwindcss, postcss, autoprefixer, eslint, prettier
- frontend/vite.config.ts (alias @ → src, host 0.0.0.0)
- frontend/tsconfig.json (strict, paths @/*)
- frontend/tailwind.config.js (content 경로, **extend 비움**)
- frontend/postcss.config.js
- frontend/index.html
- frontend/src/main.tsx, App.tsx (HashRouter + 4개 라우트 빈 페이지)
- frontend/src/index.css (Pretendard CDN, Tailwind 3줄, 스크롤바·selection 스타일)

#### 3. frontend/src/types/ — 도메인 타입 (PROJECT_BRIEF 3장 그대로)

- sheet.ts: MapSheet, ReviewStatus, ObjectCategory, CompareType, SheetFilter
  - CompareType은 'image-image' 단일 값
- detection.ts: DetectionObject, ChangeType, ErrorClass, DetectionUpdatePayload, DetectionFilter
  - ChangeType: building_new/removed/updated/color, road_new/removed/updated
  - ErrorClass: TP, FP_shadow/vegetation/vehicle/relief/other, FN, on_hold
- dataset.ts: Dataset, DatasetSource, DatasetStatus, DatasetFilter, DatasetUploadMeta, UploadProgress
  - source: 'upload' | 'aerial' | 'external'
  - status: 'pending' | 'processing' | 'ready' | 'failed'
  - **type 필드 없음** (수치지도 비교는 별도 플랫폼)
- history.ts: ReviewHistory, HistoryAction
- task.ts: Task, TaskCreatePayload (compare_type은 'image-image' 단일)
- index.ts: 모두 re-export

#### 4. frontend/src/api/client.ts — 백엔드 호출 단일 접점

mock-first + swap-ready 구조. 함수 시그니처:

도엽:
- listSheets(): MapSheet[]
- getSheet(code): MapSheet
- updateSheetStatus(code, status): MapSheet

객체:
- listDetections(sheetCode): DetectionObject[]
- updateDetection(sheetCode, id, payload): DetectionObject
- createDetection(sheetCode, draft): DetectionObject (FN 미탐 신규 추가)
- setDetectionDeleted(sheetCode, id, deleted): DetectionObject

이력:
- listHistory(sheetCode): ReviewHistory[]
- appendHistory(sheetCode, entry): ReviewHistory
- popHistory(sheetCode, count): ReviewHistory[] (Undo)

데이터셋:
- listDatasets(): Dataset[]
- getDataset(id): Dataset
- registerUploadedDataset(meta, bbox, sheetCodes, tilePath): Dataset
- updateDatasetStatus(id, status): Dataset

작업:
- listTasks(): Task[]
- createTask(payload): Task
- getDatasetOverlapRatio(stdId, cmpId): { ratio, common_sheets }

액션별 헬퍼 (객체 변경 + 히스토리 동시 기록):
- classifyDetection(sheetCode, id, errorClass, memo)
- editDetectionGeometry(sheetCode, id, geometry, memo)
- editDetectionMeta(sheetCode, id, reviewerMemo)
- softDeleteDetection(sheetCode, id, deleted, memo)

1차 mock 구현은 public/data/*.json fetch + localStorage 임시 저장. 향후 백엔드 swap 시 본 파일 내부만 변경.

#### 5. frontend/src/utils/

- auth.ts: 단일 사용자라 항상 'reviewer' 모드 반환. 인터페이스만 유지.
- constants.ts: CHANGE_TYPES, ERROR_CLASSES, REVIEW_STATUSES, OBJECT_CATEGORY_LABEL, COMPARE_TYPE_LABEL, DATASET_SOURCE_LABEL, DATASET_STATUS_LABEL, HISTORY_ACTION_LABEL, REGIONS, CHART_COLORS, REVIEWER_MEMO_MAX_LENGTH, STORAGE_KEY 등
- geoUtils.ts: bboxToLeafletBounds, leafletBoundsToBbox, polygonAreaM2, centerOfPolygon
- formatters.ts: formatArea, formatDate, formatSheetCode, formatPercent

#### 6. frontend/src/services/

- upload.ts: 시그니처 + 1차 mock (setTimeout 시뮬레이션). tus-js-client 실 통합은 이정표 4에서.
- exporters/ (디렉토리만, 빈 상태): 이정표 5에서 채움

#### 7. frontend/src/stores/ (Zustand 골조)

- uiStore.ts (sidebarCollapsed + localStorage 영속)
- sheetsStore.ts (도엽 목록·필터)
- sheetDetailStore.ts (도엽 검수 상세 — 단일 진실 원천 필터)
- datasetsStore.ts (데이터셋 목록·위저드)

각 스토어는 골조만. action 시그니처 정의 + 빈 구현. 이후 이정표에서 채움.

#### 8. frontend/src/pages/, components/

- pages/: Landing.tsx, Sheets.tsx, SheetDetail.tsx, Datasets.tsx (모두 임시 라벨만)
- components/Common/: 빈 디렉토리 + index.ts (이정표 2에서 기초 컴포넌트 추가)
- components/Layout/, Landing/, Sheets/, SheetDetail/, Datasets/: 빈 디렉토리

#### 9. backend/ 골조

- backend/Dockerfile (Python 3.11 + uvicorn)
- backend/requirements.txt (fastapi, uvicorn[standard], gunicorn, sqlalchemy, alembic, psycopg2-binary, geoalchemy2, celery, redis, pydantic, pydantic-settings, python-multipart, shapely, rasterio, gdal — 향후 단계에서 사용)
- backend/app/__init__.py
- backend/app/main.py
  - FastAPI() 인스턴스
  - same-origin proxy 기준 CORS
  - GET /health → {"status": "ok"}
- backend/app/config.py (환경변수 로드)
- backend/app/database.py (SQLAlchemy engine, 1차에는 골조만)
- backend/app/api/, models/, schemas/, services/, workers/, utils/ (빈 디렉토리 + __init__.py)

이정표 1에서는 백엔드는 /health만 동작. 실제 API는 이정표 2부터.

#### 10. nginx.conf (개발용)

- frontend dev 는 host `0.0.0.0:18210 -> container 5173`으로 publish 하고, 브라우저는 `http://<서버 IP>:18210`으로 접근
- backend/titiler는 직접 host port 를 열지 않고 `/api`, `/health`, `/titiler`, `/vworld` same-origin 프록시 경유
- 배포는 `nginx.prod.conf`와 `0.0.0.0:18200 -> frontend/nginx:80` 단일 host publish 사용

본 이정표에서는 nginx.conf 골조만 작성, 컨테이너는 docker-compose에 포함 안 함 (이정표 6).

#### 11. scripts/

- generate_dummy_detections.py
  - Python + geopandas + shapely
  - 안양 도엽(37708034) bbox 안에 100~150개 폴리곤 무작위 분포
  - 변화 유형 비율: 신축 14, 소멸 6, 갱신 63, 색변화 39, 도로 신설 15, 도로 소멸 11
  - 폴리곤 모양: 5~8각형 무작위
  - 면적: 건물 30~500㎡, 도로 100~3000㎡
  - 행정구역: 만안구 41171, 동안구 41173 무작위
  - 출력: frontend/public/data/sheets/{code}/detections.json
- 두번째 도엽 1개 더 생성 (사용자가 SIGMS 도엽 인덱스 자산을 본 단계에 제공)
- 데이터셋 더미 (정사영상 5~6개): frontend/public/data/datasets/index.json
- 도엽 메타: frontend/public/data/sheets/index.json
- 작업 메타: frontend/public/data/tasks/index.json

도엽 인덱스 GeoJSON은 사용자가 frontend/public/data/regions/sheets-index.geojson 으로 제공할 예정. 본 스크립트는 그 파일이 있다고 가정하고 그 안의 도엽 bbox를 사용.

[가정]: 도엽 인덱스 GeoJSON 미제공 시 안양 도엽 bbox는 [126.92, 37.40, 126.99, 37.45] 하드코딩.

#### 12. docs/PROGRESS.md

빈 파일 생성 + 이정표 1 항목 시작.

### 제약·금지

CLAUDE.md 5·6절 절대 규칙·금지사항 모두 적용. 특히:
- 보라색·다크모드·이모지 금지
- font-semibold 남용 금지
- OpenLayers 금지
- 페이지·컴포넌트에서 직접 fetch 금지
- 4개 라우트 외 신규 라우트 금지

### Phase A에서 보고할 것

다음 형식으로 GATE-A에 제출:

```
📍 이정표 1 — 셋업 계획

📦 산출물 요약
[디렉토리·파일 트리]

🎯 핵심 결정 (Claude 측)
- ...

❓ 사용자 확인 필요
- 도엽 인덱스 GeoJSON 위치 (사용자 제공 예정)
- 안양 외 두 번째 도엽 코드 (서울 어느 도엽?)
- (그 외 발견된 결정 사항)
```

GATE-A 통과 후 Phase B 자율 진행.

### 이정표 1 종료 조건 (GATE-D 전 검증)

- [ ] docker compose up -d 후 5개 컨테이너 정상 (frontend, backend, postgres, redis, titiler)
- [ ] http://<서버 IP>:18210 빈 페이지 표시 (보라색·다크모드·이모지 0건)
- [ ] http://<서버 IP>:18210/health → {"status": "ok"}
- [ ] 4개 라우트(/, /sheets, /sheets/:code, /datasets) 진입 가능 (모두 임시 라벨)
- [ ] frontend/public/data/sheets/{code}/detections.json 2~3개 도엽분 생성됨
- [ ] frontend/src/api/client.ts 의 listSheets() 호출 시 정적 JSON에서 데이터 가져옴
- [ ] frontend/src/types/ 6개 파일 모두 컴파일 통과
- [ ] docker compose exec frontend npx tsc --noEmit 통과
- [ ] docs/PROGRESS.md 갱신 완료

GATE-D 통과 시 다음 이정표 진행 승인 요청.
```

---

## 이정표 2 — 도엽 목록 동작 (Day 2~3)

### 프롬프트

```
CLAUDE.md 를 먼저 읽어주세요. 그리고 docs/PROGRESS.md 를 읽고 이정표 1이 완료되었는지 확인해주세요.

본 작업은 변화탐지 플랫폼의 이정표 2 — 도엽 목록 동작입니다. PROMPTS.md §2를 따릅니다.

### 본 이정표의 목적

다음 상태에 도달:
- /sheets 진입 시 도엽 카드 리스트 + 한국 전도 지도 표시
- 좌측 필터 변경 시 카드와 지도가 동시 반응 (단일 진실 원천)
- 카드 클릭 → /sheets/:sheetCode 진입 (상세는 이정표 3)
- 기초 UI 컴포넌트 11종 + 레이아웃이 갖춰진 상태

### 권위 문서 (먼저 읽기)

- docs/PROJECT_BRIEF.md 2.2.2 (도엽 목록 화면 명세)
- docs/DESIGN_SYSTEM.md 1.2, 5장 (시각 절대 규칙)
- docs/FEATURE_SPEC.md (도엽 목록·지도 인터랙션)

### 산출물

#### 1. 기초 UI 컴포넌트 11종 (frontend/src/components/Common/)

CLAUDE.md 5.1 시각 절대 규칙 준수. 도메인 무지.

- Button.tsx — variant 'primary' | 'secondary' | 'ghost' | 'danger', size 'sm' | 'md' | 'lg'
- Card.tsx — DESIGN_SYSTEM 카드 단일 공식 (rounded-xl p-5 shadow-sm border-slate-100 hover:shadow-md)
- Input.tsx — rounded-md, focus:ring-2 focus:ring-blue-500
- Select.tsx — Input 동일 시각, native select
- Modal.tsx — DESIGN_SYSTEM 모달 단일 공식, Radix alert-dialog 기반
- Tabs.tsx — 활성 탭 border-b-2 border-blue-600
- Badge.tsx — variant 'slate' | 'blue' | 'emerald' | 'amber' | 'red', text-[10px] px-1.5 py-0.5 rounded-full
- Progress.tsx — value 0~100, h-1.5 rounded-full bg-slate-100 + bg-blue-600 fill
- Tooltip.tsx — Radix popover 기반
- Accordion.tsx — Radix 또는 자체 구현, 헤더 클릭 expand/collapse
- Common/index.ts — 11종 re-export

각 컴포넌트는 forwardRef 사용 (특히 Input, Button), ARIA 챙김.

#### 2. 레이아웃 (frontend/src/components/Layout/)

- Header.tsx — 높이 h-14, 좌측 메뉴 토글 + 로고 "변화탐지 플랫폼", 중앙 네비 (변화탐지 / 데이터셋), 우측 알림 벨
- Sidebar.tsx — 폭 260px (펼침) / 56px (접힘), localStorage nbm.ui.sidebarCollapsed 영속
- AppShell.tsx — Header + Sidebar + main flex-1 overflow-auto
- AuthModeToggle.tsx — 단일 사용자라 1차 출시 미노출 또는 빈 컴포넌트 (lib/auth.ts 호출만)

App.tsx 갱신: HashRouter + AppShell이 모든 라우트를 감싸도록.

#### 3. /sheets 페이지 (frontend/src/components/Sheets/, frontend/src/pages/Sheets.tsx)

레이아웃: 좌 사이드바 320px (필터·카드 리스트) + 우 메인 (한국 전도 지도)

- pages/Sheets.tsx — 페이지 셸. sheetsStore 구독 + 초기 로드.
- components/Sheets/SheetCard.tsx — 도엽 1매분 카드
  - 도엽코드, 도엽명, 권역, 검수 상태 배지, 메트릭 3종(F1·Recall·Precision)
  - hover 시 우측 지도 강조
  - 클릭 시 /sheets/:sheetCode 이동
- components/Sheets/SheetListFilter.tsx — 좌측 필터
  - 검색어 (도엽코드·도엽명)
  - 검수 상태 다중선택
  - 권역 단일선택 (Select)
  - 객체 카테고리 다중선택 (건물·도로)
- components/Sheets/SheetMap.tsx — React-Leaflet 지도
  - public/data/regions/sheets-index.geojson 로드 (api/client.ts 의 listSheetGrid 추가)
  - 도엽 격자 폴리곤 오버레이 (검수 상태별 색)
  - 도엽 hover 시 카드 하이라이트 동기화

#### 4. sheetsStore 채우기 (frontend/src/stores/sheetsStore.ts)

- filter: SheetFilter
- sheets: MapSheet[], grid: GeoJSON.FeatureCollection
- loading: boolean
- actions: setFilter(partial), loadSheets(), loadGrid()

단일 진실 원천: filter 변경 → SheetCard 리스트 + SheetMap 격자 색·표시 동시 반응.

#### 5. api/client.ts 확장

- listSheetGrid() — public/data/regions/sheets-index.geojson 로드해 FeatureCollection 반환

### 제약·금지

CLAUDE.md 5·6절 모두 적용. 특히:
- 카드 단일 공식 (rounded-xl p-5 shadow-sm border-slate-100 hover:shadow-md)
- 검수 상태 색상은 utils/constants 의 REVIEW_STATUSES 그대로
- 페이지·컴포넌트에서 직접 fetch 0건 (api/client 경유)
- 무한 스크롤은 본 이정표 범위 외 (단순 가상화 또는 단일 페이지)

### 이정표 2 종료 조건

- [ ] /sheets 진입 시 카드 리스트 + 지도 동시 표시
- [ ] 좌측 필터 변경 시 카드 리스트와 지도 격자 색 동시 반응
- [ ] 카드 클릭 시 /sheets/:sheetCode 진입 (sheetCode 표시)
- [ ] 사이드바 토글 후 새로고침해도 상태 유지
- [ ] components/Common/ 11종 갤러리 페이지 또는 Storybook에서 시각 검증
- [ ] dark: 검색 0건, 보라색 검색 0건, 이모지 UI 텍스트 0건
- [ ] tsc --noEmit 통과
- [ ] docs/PROGRESS.md 갱신

GATE-D 통과 시 이정표 3 진행 승인 요청.
```

---

## 이정표 3 — 도엽 검수 상세 동작 (Day 4~7)

이정표 중 가장 큰 작업. 시스템의 80%가 본 이정표에 들어간다. 사용자께서 가장 신경 써서 검토할 이정표.

### 프롬프트

```
CLAUDE.md 를 먼저 읽어주세요. 그리고 docs/PROGRESS.md 를 읽고 이정표 2가 완료되었는지 확인해주세요.

본 작업은 변화탐지 플랫폼의 이정표 3 — 도엽 검수 상세 동작입니다. PROMPTS.md §3를 따릅니다. 시스템의 80%가 본 이정표에 들어가므로 가장 신중하게 진행합니다.

### 본 이정표의 목적

/sheets/:sheetCode 화면이 검수자가 실제 작업 가능한 수준으로 동작:
- 폴리곤 시각화 + 4종 뷰어 모드
- 좌 사이드바 6개 영역 (분석 데이터·확신도·건물 변화·도로 변화·검수 액션·검수 히스토리)
- 폴리곤 단일·다중 선택 + 폴리곤 그리기·편집
- 오류분류 부여 (8종) + 검수 의견 입력
- 우 패널 객체 정보 / 검수 리포트 (도넛·통계표·AG Grid)
- 검수 히스토리 자동 기록 + Undo/Redo
- 도엽 검수 완료 처리

### 권위 문서 (먼저 읽기)

- docs/PROJECT_BRIEF.md 2.2.3 (도엽 검수 상세 전체) + 3.3 (오류분류) + 3.4 (변화 유형) + 3.6 (검수 이력) + 4.1 (검수자 워크플로우)
- docs/DESIGN_SYSTEM.md 5장 (시각 규칙)
- docs/FEATURE_SPEC.md (도엽 상세 모든 기능)

### 산출물

본 이정표는 분량이 크니 세 단계로 자율 진행한다 (Phase B 안에서 자체 분할).

#### Phase B-1: 시각화 기반 (읽기 모드)

- pages/SheetDetail.tsx — 페이지 셸, sheetDetailStore.load(sheetCode)
- components/SheetDetail/DetectionMap.tsx — 단일 지도 + 폴리곤 오버레이
  - filter 적용한 폴리곤만 렌더, 변화 유형 색상 (CHANGE_TYPE_BY_CODE)
  - 미분류 객체는 채도 낮춤 또는 점선 보더
  - 폴리곤 클릭 시 sheetDetailStore.selectObject
- components/SheetDetail/SheetSidebar.tsx — 좌 6개 아코디언 컨테이너
- components/SheetDetail/AnalysisDataAccordion.tsx — 1번: 기준영상·비교영상 파일명
- components/SheetDetail/ConfidenceSlider.tsx — 2번: 0~100 슬라이더
- components/SheetDetail/ChangeTypeFilter.tsx — 3·4번: 건물·도로 변화 유형 가시성·카운트
- components/SheetDetail/DetectionInfoPanel.tsx — 우 패널 (객체 정보 모드, 읽기)

#### Phase B-2: 4종 뷰어 모드 + 인터랙션

- components/SheetDetail/ViewerModeToolbar.tsx — 좌상단 4개 버튼 (단일/2분할/X스와이프/Y스와이프)
- DetectionMap.tsx 확장:
  - viewerMode === 'single': 비교영상 1개 (1차 mock 단계는 OpenStreetMap placeholder)
  - viewerMode === 'split': 좌우 분할
  - viewerMode === 'swipe-x': leaflet-side-by-side 가로 스와이프
  - viewerMode === 'swipe-y': 자체 구현 세로 스와이프
- components/SheetDetail/MapToolbar.tsx — 도구바
  - 단일선택 / 다중선택(lasso) / 폴리곤 그리기 / 폴리곤 편집
- DetectionMap.tsx — leaflet-draw 통합으로 폴리곤 생성·vertex 편집

#### Phase B-3: 오류분류·검수 액션·리포트·히스토리·Undo/Redo

- components/SheetDetail/ErrorClassCard.tsx — 우 패널 오류분류 부여 영역
  - ERROR_CLASSES 8종 라디오 카드
  - 검수 의견 textarea (REVIEWER_MEMO_MAX_LENGTH=100)
  - 적용 버튼 → classifyDetection (단건 또는 다중선택 일괄)
- components/SheetDetail/ReviewActionPanel.tsx — 좌 5번 영역
  - "도엽 검수 완료 처리", "검수 보류", "검수 재개" 버튼
  - 단일 사용자라 권한 분기 모두 통과
- components/SheetDetail/ReportPanel.tsx — 우 패널 리포트 모드
  - 탭 (건물 변화 / 도로 변화)
  - 분석결과 요약 (총 N건, 총 면적)
  - 도넛 1: 변화 유형 분포 (recharts)
  - 도넛 2: 오류분류 분포 (recharts)
  - 통계표: 변화 유형별 검출 면적·검출 건수
  - 누적 막대: 행정구역별 분포
  - AG Grid: 상세 객체 목록 (행 클릭 시 지도 이동·선택)
- components/SheetDetail/ReviewHistoryTable.tsx — 좌 6번 영역, 시간 역순
- Undo/Redo:
  - sheetDetailStore에 undoStack, redoStack: ReviewHistory[]
  - 좌 사이드바 상단 Undo/Redo 버튼 + Ctrl+Z/Ctrl+Shift+Z 단축키
  - lib/api 의 popHistory 활용

#### sheetDetailStore 완성 (frontend/src/stores/sheetDetailStore.ts)

단일 진실 원천 필터:
- filter: DetectionFilter (확신도, 변화 유형, 오류분류, 미분류만, 행정구역)
- viewerMode, selectedIds, undoStack, redoStack
- actions: load, setFilter, setViewerMode, selectObject, selectMany, clearSelection, applyClassify, applyEditGeometry, applyEditMeta, applySoftDelete, applyCreate, undo, redo

좌 필터 변경 → 지도 폴리곤 + 우 패널 차트·통계·Grid 모두 동시 반응.

### 제약·금지

- 단일 진실 원천 필터 동기화 절대 깨지지 않음
- 폴리곤 색상은 변화 유형 기준 (utils/constants CHANGE_TYPES)
- 오류분류 색상은 ERROR_CLASSES 그대로
- 다중선택 일괄 분류 시 confirm 모달 필수
- 차트 색상은 CHART_COLORS 그대로
- 직접 fetch 0건 (api/client 경유)
- B 시스템 와이어프레임 코드 그대로 복붙 금지

### 이정표 3 종료 조건

- [ ] /sheets/{유효한 도엽코드} 진입 시 100~150개 폴리곤 렌더
- [ ] 좌 사이드바 6개 아코디언 모두 동작
- [ ] 확신도 슬라이더 변경 시 지도·우 패널 동시 반응
- [ ] 변화 유형 가시성 토글 정상
- [ ] 4종 뷰어 모드 전환 정상
- [ ] 폴리곤 단일·다중 선택 정상
- [ ] 폴리곤 그리기·편집·삭제·복원 정상 (FN 신규 추가 포함)
- [ ] 8종 오류분류 부여·변경 정상
- [ ] 검수 의견 100자 초과 시 입력 차단
- [ ] 다중선택 일괄 분류 confirm 모달 동작
- [ ] 우 패널 리포트 모드: 도넛 2개·통계표·누적 막대·AG Grid 모두 좌 필터 반영
- [ ] AG Grid 행 클릭 시 지도 이동·강조
- [ ] 검수 히스토리 자동 기록 + 행 클릭 시 지도 이동
- [ ] Undo/Redo 동작 (Ctrl+Z, Ctrl+Shift+Z)
- [ ] 도엽 검수 완료 처리 후 /sheets에서 상태 반영
- [ ] dark: 0건, 보라색 0건, 이모지 UI 텍스트 0건
- [ ] tsc --noEmit 통과, F12 콘솔 에러 0건
- [ ] docs/PROGRESS.md 갱신

GATE-D 통과 시 이정표 4 진행 승인 요청.
```

---

(이정표 4·5·6은 다음 응답에서 이어집니다)

---

## 이정표 4 — 데이터셋·위저드 동작 (Day 8~10)

### 프롬프트

```
CLAUDE.md 를 먼저 읽어주세요. docs/PROGRESS.md 를 읽고 이정표 3이 완료되었는지 확인해주세요.

본 작업은 변화탐지 플랫폼의 이정표 4 — 데이터셋·위저드 동작입니다. PROMPTS.md §4를 따릅니다.

### 본 이정표의 목적

다음 상태에 도달:
- /datasets 카드 그리드 + 필터 동작
- 정사영상 직접 업로드 (tus-js-client 기반, 진행률 표시)
- 신규 변화탐지 작업 위저드 3단계 동작
- 백엔드 API 골조 + 읽기 API 구현 (도엽·객체·데이터셋·이력)

### 권위 문서 (먼저 읽기)

- docs/PROJECT_BRIEF.md 2.2.4 (데이터셋 화면 + 위저드)
- docs/FEATURE_SPEC.md (위저드 인터랙션 + 무한 스크롤)
- docs/BACKEND_API_SPEC.md (백엔드 API 명세 — 1차 구현 대상)

### 산출물

#### 1. /datasets 페이지 (frontend/src/pages/Datasets.tsx, components/Datasets/)

레이아웃:
- 상단 헤더: "신규 데이터셋 등록" 버튼 + "신규 변화탐지 작업" 버튼
- 좌 필터 사이드바 280px (출처·상태·플랫폼·검색어·일자 범위)
- 우 메인: 카드 그리드 3~4열 반응형

산출물:
- pages/Datasets.tsx
- components/Datasets/DatasetCard.tsx — 썸네일·display_name·platform·촬영기간·커버 도엽 수·상태 배지
- components/Datasets/DatasetFilterSidebar.tsx
- hooks/useInfiniteScroll.ts — IntersectionObserver 기반 (1차 mock 데이터 적어 단일 페이지)

#### 2. 데이터셋 업로드 모달

- components/Datasets/UploadModal.tsx
  - 파일 선택 (TIFF만 허용)
  - 메타 입력: display_name, platform, taken_start_at, taken_end_at
  - 업로드 시작 버튼 → services/upload.ts 의 uploadDataset 호출
  - 진행률 바 (UploadProgress.percent + stage 표시)
  - 완료 후 자동 닫힘 + 카드 그리드 갱신
- services/upload.ts 정식 구현
  - 1차 mock: setTimeout 시뮬레이션 (이정표 1에서 만든 기본 형태)
  - 백엔드 통합 시점에 tus-js-client 적용 가능하도록 placeholder 함수 분리

#### 3. 신규 변화탐지 작업 위저드

- components/Datasets/NewTaskWizard.tsx — Modal 활용 3단계
- components/Datasets/WizardStepResource.tsx — Step 1·2 공용 (label만 다름)
- components/Datasets/WizardStepMeta.tsx — Step 3 (작업명·설명·객체 카테고리)
- components/Datasets/OverlapBadge.tsx — 중첩률 표시 (>=70% emerald, 30~70% amber, <30% red)

흐름:
- Step 1: 기준 자원 선택 (status === 'ready' 인 정사영상만 활성)
- Step 2: 비교 자원 선택 — 선택 직후 getDatasetOverlapRatio 호출 + OverlapBadge 표시
- Step 3: 작업명·설명 입력 + 객체 카테고리 다중 선택 (건물/도로)
  - "등록" 버튼 → createTask 호출 → /sheets로 이동 (해당 task의 도엽 필터 적용)

#### 4. datasetsStore 완성

- datasets, filter, wizardStep, wizardSelection
- actions: loadDatasets, setFilter, setWizardStep, setWizardSelection, submitWizard, addUploadedDataset

#### 5. 백엔드 — Pydantic schemas + SQLAlchemy models + Alembic 초기 마이그레이션

backend/app/schemas/ — Pydantic 모델 (frontend/src/types/ 와 1:1)
- sheet.py — MapSheet, SheetFilter
- detection.py — DetectionObject, DetectionUpdatePayload
- dataset.py — Dataset, DatasetUploadMeta
- history.py — ReviewHistory
- task.py — Task, TaskCreatePayload

backend/app/models/ — SQLAlchemy 모델
- sheet.py — sheets 테이블 (geometry는 PostGIS Geometry(Polygon, 5186))
- detection.py — detections (geometry, foreign key sheet)
- dataset.py — datasets
- history.py — review_histories
- task.py — tasks
- 모든 좌표는 EPSG:5186 저장

backend/app/database.py — engine + SessionLocal + get_db dependency

backend/alembic/ — 초기 마이그레이션 1개로 모든 테이블 생성

#### 6. 백엔드 — 읽기 API 구현

backend/app/api/ 라우터:
- sheets.py — GET /api/v1/sheets, GET /api/v1/sheets/{code}
- detections.py — GET /api/v1/sheets/{code}/detections
- datasets.py — GET /api/v1/datasets, GET /api/v1/datasets/{id}, GET /api/v1/datasets/overlap
- history.py — GET /api/v1/sheets/{code}/history

응답 좌표는 EPSG:4326 (백엔드가 변환).

backend/app/main.py — 라우터 include + CORS.

#### 7. 시드 스크립트

backend/scripts/seed.py
- public/data/sheets/index.json + detections.json + datasets/index.json + tasks/index.json 을 PostGIS에 입력
- docker compose exec backend python scripts/seed.py 로 실행

#### 8. frontend/src/api/client.ts swap

- listSheets, getSheet, listDetections, listDatasets, getDataset, getDatasetOverlapRatio, listHistory, listTasks: 백엔드 호출로 swap
- createTask: 1차에는 mock 유지 (백엔드 쓰기 API는 이정표 5)
- registerUploadedDataset, updateDatasetStatus, updateDetection 등 쓰기 함수: mock 유지

환경변수 VITE_API_BASE_URL 도입 (없으면 정적 JSON fallback).

### 제약·금지

- 1차는 정사영상-정사영상만. 위저드에서 다른 type 자원 선택 자체 불가능
- 위저드 권한 분기는 단일 사용자라 모두 통과 (auth.canCreateTask)
- 백엔드는 본 이정표에서 읽기 API만. 쓰기는 이정표 5
- 좌표계: 파일 5186, API 응답 4326

### 이정표 4 종료 조건

- [ ] /datasets 카드 그리드 + 필터 + 카테고리(출처) 토글 정상
- [ ] 업로드 모달 동작 (파일 선택 → 메타 입력 → 진행률 표시 → 카드에 추가)
- [ ] 위저드 3단계 정상 (자원 선택 → 중첩률 표시 → 메타 입력 → 등록)
- [ ] 등록 후 /sheets 이동 + 새 작업의 도엽 필터 적용
- [ ] 백엔드 5개 읽기 엔드포인트 정상 (curl 또는 /docs로 검증)
- [ ] PostGIS에 시드 데이터 입력 정상
- [ ] frontend가 백엔드에서 데이터 가져옴 (mock JSON fallback도 동작)
- [ ] tsc --noEmit + 백엔드 테스트 통과
- [ ] docs/PROGRESS.md 갱신

GATE-D 통과 시 이정표 5 진행 승인 요청.
```

---

## 이정표 5 — 모델 통합 + Export (Day 11~12)

### 프롬프트

```
CLAUDE.md 를 먼저 읽어주세요. docs/PROGRESS.md 를 읽고 이정표 4가 완료되었는지 확인해주세요.

본 작업은 변화탐지 플랫폼의 이정표 5 — 모델 통합 + Export입니다. PROMPTS.md §5를 따릅니다.

### 본 이정표의 목적

다음 상태에 도달:
- 백엔드 쓰기 API 모두 구현 (검수 결과 영속화)
- Celery + Redis 통합 (변화탐지 작업 큐)
- 모델 호출 wrapper — 실제 엔진은 `innopam-PM2022004-digital` submodule, legacy mock은 `engines/change-detection/run.py`
- 위저드 등록 후 진행률 폴링 → 결과 도엽별 분할 → DB 적재
- 검수 결과 SHP/DXF/PDF Export
- End-to-end 흐름 검증

### 권위 문서 (먼저 읽기)

- docs/BACKEND_API_SPEC.md (5장 변화탐지 작업, 6장 자원 — 정사영상 타일)
- docs/INTEGRATION_PLAN.md (Phase γ — 쓰기 API + 작업 큐, 모델 호출)
- docs/PROJECT_BRIEF.md 4.3 (Export)

### 산출물

#### 1. 백엔드 쓰기 API

- PATCH /api/v1/detections/{id} — updateDetection (오류분류·검수 의견·폴리곤)
  - 트랜잭션: 객체 변경 + ReviewHistory 자동 추가
  - 액션 종류는 페이로드 내용에 따라 추론 (classify / edit_geometry / edit_meta)
- POST /api/v1/sheets/{code}/detections — createDetection (FN 신규 추가)
- PATCH /api/v1/detections/{id}/deletion — softDeleteDetection
- DELETE /api/v1/sheets/{code}/history/recent?count=N — popHistory (Undo, before 상태 복원)
- PATCH /api/v1/sheets/{code}/status — updateSheetStatus
- POST /api/v1/datasets — registerUploadedDataset
- POST /api/v1/uploads — tus-js-client 호환 업로드 엔드포인트
- PATCH /api/v1/datasets/{id}/status — updateDatasetStatus

frontend/src/api/client.ts 의 모든 쓰기 함수를 백엔드 호출로 swap.

#### 2. Celery + Redis 통합

backend/app/workers/celery_app.py — Celery 앱 인스턴스
- 브로커: Redis
- 백엔드: Redis (결과 저장)

backend/app/workers/tasks.py — Celery 작업 정의
- run_change_detection(task_id) — 변화탐지 작업 실행
  - 1단계: getCurrentState SET 'STARTED'
  - 2단계: 모델 호출 (건물 모델 + 도로 모델 각각, 2번 호출)
  - 3단계: 결과 폴리곤을 도엽 격자와 교차해 도엽별 분할
  - 4단계: PostGIS INSERT (DetectionObject 테이블)
  - 5단계: SET 'SUCCESS'
- update_dataset_after_upload(dataset_id) — COG 변환 (mock 또는 실 GDAL)

backend/app/api/tasks.py:
- POST /api/v1/tasks — createTask + Celery enqueue
- GET /api/v1/tasks — listTasks (celery_state, progress 포함)
- GET /api/v1/tasks/{id}/status — 진행률 폴링

docker-compose.yml 에 celery-worker 컨테이너 추가.

#### 3. 변화탐지 엔진

- 실제 엔진 소스: `innopam-PM2022004-digital` submodule
- Docker 런타임 경로: `/engines/pm`
- legacy mock 인터페이스: `engines/change-detection/run.py`
  - 입력: 정사영상 2장 경로 + 객체 카테고리 (building or road)
  - 출력: 변화 폴리곤 GeoJSON (EPSG:5186)
  - **mock 우회 시에만 사용** (가짜 폴리곤 생성)

mock 우회 시: 입력 정사영상의 bbox 안에 무작위 폴리곤 100~150개 생성. 변화 유형 비율은 PROJECT_BRIEF 안양 기준.

#### 4. Export — frontend/src/services/exporters/

- shp.ts — exportSheetAsShp(sheetCode)
  - api/client 의 listDetections + getSheet 호출
  - shp-write 로 zip 생성
  - 좌표계는 EPSG:5186으로 역변환 (proj4)
  - .prj 동봉
- dxf.ts — exportSheetAsDxf(sheetCode)
  - dxf-writer 로 layer 분리 (변화 유형별)
- pdf.ts — exportSheetAsPdf(sheetCode)
  - jsPDF 로 도엽 1매분 검수 결과 리포트
  - 표지·요약·도넛·통계표·상세 목록
  - 한글 폰트 임베드 (Pretendard subset 또는 NanumGothic)
- ExportButton.tsx — 우 패널 상단에 배치, dynamic import (`await import('@/services/exporters/shp')`)

#### 5. 위저드 → 진행률 폴링 통합

- NewTaskWizard 등록 후 /sheets로 이동 + toast로 task_id 안내
- /sheets 에 작업 진행률 표시 (도엽 카드 또는 별도 진행 패널)
- frontend/src/api/client.ts 에 getTaskStatus 함수 추가 (1~5초 폴링용)

### 제약·금지

- 모델 통합 시 막히면 즉시 mock으로 우회 (시간 안전망)
- 좌표계: 모델 출력 5186, DB 5186, API 응답 4326, Export 5186
- Export 함수는 dynamic import (라이브러리 무거움)
- 한글 폰트 인코딩 주의 (SHP CP949 또는 UTF-8 명시)

### 이정표 5 종료 조건

- [ ] 검수 결과 변경 → 백엔드 영속화 → 새로고침 후에도 유지 (localStorage 의존 0)
- [ ] 위저드 등록 → Celery 큐 enqueue → 진행률 폴링으로 도엽 카드 갱신
- [ ] task 완료 시 /sheets 에 새 도엽 + 폴리곤 노출
- [ ] SHP 다운로드 → QGIS 에서 EPSG:5186 좌표계 정상 확인
- [ ] DXF 다운로드 → AutoCAD 또는 QGIS 에서 layer 정상
- [ ] PDF 다운로드 → 한글 깨짐 없음
- [ ] 모델 통합 PoC 결과 (실 모델 동작 또는 mock 우회 명시)
- [ ] End-to-end 흐름: 데이터셋 업로드 → 작업 등록 → 추론 완료 → 검수 → 검수 완료 → Export 까지 한 번에 동작
- [ ] tsc --noEmit + 백엔드 테스트 통과
- [ ] docs/PROGRESS.md 갱신

GATE-D 통과 시 이정표 6 진행 승인 요청.
```

---

## 이정표 6 — 운영 배포 준비 (Day 13~14)

### 프롬프트

```
CLAUDE.md 를 먼저 읽어주세요. docs/PROGRESS.md 를 읽고 이정표 5가 완료되었는지 확인해주세요.

본 작업은 변화탐지 플랫폼의 이정표 6 — 운영 배포 준비입니다. PROMPTS.md §6를 따릅니다.

### 본 이정표의 목적

다음 상태에 도달:
- nginx + frontend 빌드 산출물 + 백엔드 reverse proxy 구성
- 운영용 docker-compose.prod.yml
- DB 백업 정책 + 운영 스크립트
- 시각·접근성·반응형 다듬기
- 1차 출시 가능 상태

### 권위 문서 (먼저 읽기)

- docs/INTEGRATION_PLAN.md (Phase δ — 운영 배포)
- CLAUDE.md 5·6절 (시각 절대 규칙·금지)

### 산출물

#### 1. 운영용 컨테이너 구성

- frontend/Dockerfile.prod — multi-stage (Vite build → Nginx 정적 서빙)
- backend/Dockerfile.prod — Gunicorn + Uvicorn worker
- docker-compose.prod.yml
  - frontend (Nginx 정적), backend (Gunicorn), postgres, redis, celery-worker, titiler, nginx (리버스 프록시)
  - 환경변수: .env.prod (시크릿 분리)
  - 볼륨: postgres-data, titiler-cache 영속

#### 2. nginx.prod.conf

- 프론트 정적 파일 / → frontend
- /api/v1/* → backend
- /cog/* → titiler
- /uploads/* → backend (tus 업로드)
- gzip, http2, cache 헤더

#### 3. 운영 스크립트 (scripts/)

Aerial Survey 패턴 차용:
- install.sh — 처음 설치
- healthcheck.sh — 컨테이너·DB·Redis·TiTiler 상태 점검
- collect-logs.sh — 로그 수집 압축
- inject-cog.sh — TIFF → COG 변환 일괄
- backup-db.sh — pg_dump cron용
- cleanup-storage.sh — 오래된 임시 파일 정리

#### 4. 다듬기 라운드 (frontend)

- 빈 상태 (empty state) 메시지
- 로딩 상태 Skeleton 또는 Spinner
- 에러 상태 toast + 페이지 내 에러 박스
- transition-colors 일관성
- focus 링 누락 점검
- ARIA — 아코디언·탭·모달·드롭다운
- 키보드 — 탭 순서·Enter/Space 작동
- 반응형 — 1280px 이하 시 우 패널 모달 전환 또는 접힘
- Lighthouse 접근성 점수 90+ 목표

#### 5. 사용자 매뉴얼 초안 (선택)

- docs/USER_MANUAL.md — 검수자 워크플로우 화면별 사용법

### 제약·금지

- 본 이정표는 신규 기능 추가 금지. 기존 기능 다듬기 + 운영 환경 구성만
- 시각 절대 규칙 위반 0건 재검증
- 콘솔 경고·에러 0건

### 이정표 6 종료 조건

- [ ] docker compose -f docker-compose.prod.yml up -d 로 운영 환경 기동
- [ ] 사내 IP 접속 시 정상 동작
- [ ] Lighthouse 접근성 점수 90+
- [ ] 1280·1440·1920 반응형 정상
- [ ] 빈 상태·로딩·에러 모두 적절히 표시
- [ ] dark: 0건, 보라색 0건, 이모지 UI 텍스트 0건, font-semibold 사용 최소화
- [ ] tsc --noEmit + 백엔드 테스트 통과 + npm run build 성공
- [ ] F12 콘솔 경고·에러 0건
- [ ] DB 백업 스크립트 동작 확인
- [ ] healthcheck.sh 실행 시 모든 컨테이너 OK
- [ ] docs/PROGRESS.md 갱신 + 1차 출시 완료 표시

GATE-D 통과 시 1차 출시 완료.
```

---

## 부록 — 막힘 대응

### Claude Code가 잘못된 방향으로 갈 때

증상: 보라색 등장 / 다크 모드 클래스 / 이모지 / 도메인 어휘 잘못됨 / 4개 라우트 외 신규 라우트.

대응: **새 채팅** 열고 다음 프롬프트:

```
CLAUDE.md를 다시 읽어주세요. 특히 5절 절대 규칙과 6절 금지사항을 확인합니다.
이전 작업에서 [구체적 위반 항목]이 발견되어 다시 작업합니다.
PROMPTS.md §[N]의 [어느 부분]을 따라 [어떤 작업]을 다시 진행합니다.
```

같은 채팅에서 수정 시도하면 컨텍스트 오염되어 같은 실수 반복됨.

### 단일 진실 원천 필터 동기화 깨짐

증상: 좌 사이드바 필터 변경 시 지도 또는 우 패널 어느 한쪽이 반응 안 함.

대응: sheetDetailStore의 selector 패턴 점검을 명시적으로 요청.

### 모델 통합 막힘

이정표 5에서 실 모델 통합 시도 후 막히면 즉시 mock으로 우회. 시간 손실 최소화. 1차 출시 후 실 모델 통합 가능.

### 결정 보류 사항 발생

Claude Code가 `[가정: ...]` 표기로 임시 결정하고 진행. 게이트(GATE-A 또는 GATE-D)에서 일괄 확정.

### 이정표 도중 중단·이어가기

새 채팅에서 다음 프롬프트:

```
docs/PROGRESS.md 를 먼저 읽고, 마지막 완료 항목 다음 작업부터 진행해주세요.
현재 진행 중인 이정표는 PROMPTS.md 의 §[N]을 따른다.
```

---

## 부록 — 자주 묻는 질문 (Claude Code용)

### Q. 페이지에서 데이터가 필요한데 api/client.ts 에 함수가 없습니다.

A. api/client.ts 에 함수를 추가합니다. 페이지·컴포넌트에서 직접 fetch 금지.

### Q. 백엔드 API가 아직 구현 안 된 항목인데 프론트가 먼저 필요합니다.

A. api/client.ts 에 mock 구현으로 둡니다. 정적 JSON fetch 또는 localStorage. 추후 백엔드 swap 시 본 함수만 변경.

### Q. PROJECT_BRIEF에 명시되지 않은 결정이 필요합니다.

A. `[가정: ...]` 표기 + 이유 명시 후 진행. 이정표 종료 GATE-D 에서 사용자에게 일괄 질의.

### Q. B 시스템 와이어프레임 코드를 거의 그대로 가져와도 되나요?

A. 안 됩니다. B 시스템은 OpenLayers + MUI 기반이고 디자인 시스템이 다릅니다. 패턴(레이아웃 구조·인터랙션 흐름)만 차용하고 처음부터 React-Leaflet + Tailwind 로 작성.

### Q. 모달이나 카드의 시각이 와이어프레임과 다릅니다.

A. 와이어프레임은 참고용. 시각의 단일 진실 원천은 DESIGN_SYSTEM.md 의 카드 단일 공식·모달 단일 공식.
