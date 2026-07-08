# 진행 상황

> Claude Code가 이정표를 진행하며 누적 기록한다.
> CLAUDE.md §2 형식 준수.

---

## 이정표 1 — 셋업 (Day 1) ✅

### 인프라
- [x] `docs/` 디렉토리 정리 (권위 문서 5개 이동: PROJECT_BRIEF, DESIGN_SYSTEM, FEATURE_SPEC, INTEGRATION_PLAN, BACKEND_API_SPEC)
- [x] `PROGRESS.md` 신규 작성
- [x] `docker-compose.yml` (frontend, backend, postgres+postgis, redis, titiler, scripts profile)
- [x] `.gitignore`, `.env.example`, `nginx.conf` 골조

### 프론트엔드 골조 (frontend/)
- [x] Vite 5.4 + React 18 + TS 5.5 + Tailwind 3.4 (extend 비움) + Pretendard CDN
- [x] HashRouter 4개 라우트 (`/`, `/sheets`, `/sheets/:sheetCode`, `/datasets`) — 모두 임시 라벨
- [x] 도메인 타입 6 파일 (sheet, detection, dataset, history, task, index)
- [x] `api/client.ts` mock-first 단일 접점 — 23개 함수 (read·write·history·헬퍼)
- [x] `services/upload.ts` mock 시뮬레이션 시그니처
- [x] Zustand 스토어 4종 (uiStore + 도메인 3종)
- [x] `utils/` 4개 (auth, constants, geoUtils, formatters)
- [x] components/ 6개 디렉토리 + index.ts (이정표 2~4 채움 예약)

### 백엔드 골조 (backend/)
- [x] FastAPI 0.115 + uvicorn dev + CORS 설정
- [x] `/health` 엔드포인트 200 OK
- [x] `requirements.txt` (sqlalchemy, alembic, geoalchemy2, celery, pydantic 등)
- [x] alembic 골조 (env.py, script.py.mako, alembic.ini) — 마이그레이션은 이정표 4
- [x] api/ models/ schemas/ services/ workers/ utils/ 디렉토리 + `__init__.py`

### 더미 데이터 (frontend/public/data/)
- [x] 도엽 인덱스 GeoJSON 5179 → 4326 변환 (17,034 features)
- [x] 안양(`37708034`) 148개 + 인접 도엽(`37708024`) 103개 변화탐지 폴리곤
- [x] 데이터셋 더미 6건 (정사영상, 다양한 source/status)
- [x] 작업 메타 1건 (안양 권역 2022→2024)

### 검증 (5/5 통과, 당시 기준)
- [x] `docker compose up -d` 5개 컨테이너 정상 (frontend, backend, postgres, redis, titiler)
- [x] 당시 frontend 직접 접근으로 HTML 응답 + Vite HMR 동작 확인. 현재 개발 host 진입점은 `http://<서버 IP>:18210`.
- [x] 당시 backend 직접 health 확인. 현재는 backend host port 를 publish 하지 않고 same-origin `/health`만 사용.
- [x] 4개 라우트 진입 가능 (HashRouter, SPA index 응답)
- [x] `tsc --noEmit` 통과 (29 ts/tsx files, 에러 0)

### 자체 점검 (CLAUDE.md §10) — 모두 0건
- [x] `dark:` 검색 0건
- [x] purple/violet/indigo 0건
- [x] 이모지 UI 텍스트 0건
- [x] 직접 fetch (api/client 외부) 0건
- [x] OpenLayers / @mui 0건
- [x] `font-semibold` 0건 (font-bold + font-normal 두 단계 대비)
- [x] 4개 라우트 외 신규 라우트 0건
- [x] 권한 분기는 `utils/auth.ts` 의 의미 단위 함수 사용

### GATE 기록
- 🚪 GATE-A 통과: 2026-05-06
- 🚪 GATE-D 통과: 2026-05-06

### Claude 측 결정 / 가정
- **좌표계**: 입력 GeoJSON 은 EPSG:5179 고정, 프론트 런타임은 EPSG:4326. 백엔드 DB 표준은 EPSG:5186 (이정표 4 적용 시 5179 데이터를 5186으로 재변환).
- **두 번째 도엽**: 미지정 → 같은 권역 인접 격자 자동 선택 (`37708024`). 실데이터 도착 시 교체 예정.
- **호스트 포트 정책(현행)**: Aerial-survey-manager는 `18100`, NBM 배포는 `0.0.0.0:18200`, NBM 개발은 `0.0.0.0:18210`. backend/db/redis/titiler는 host port 를 publish 하지 않고 `/api`, `/health`, `/titiler`, `/vworld` same-origin 경로로 접근.
- **PROJECT_BRIEF.md 와 도엽 인덱스 데이터 불일치**: PROJECT_BRIEF 는 안양을 "수도권남부 권역" 으로 예시. 실제 도엽 인덱스(전국_권역_5K_5179.geojson)에서 `37708034` 의 layer 는 "수도권북부 권역", bbox 도 양평/광주 부근. 즉, 코드와 도시명이 불일치. **이정표 2~3 작업 시 사용자가 실 도엽 코드·도시명 매핑을 제공하면 시드 데이터 갱신**. 본 이정표는 더미 폴리곤 위치가 어디든 동작에 영향 없으므로 진행.
- **scripts 컨테이너 GDAL**: `python:3.11-slim` + `apt install gdal-bin libgdal-dev libgeos-dev libproj-dev` 로 빌드 (1.38GB). 호스트에도 geopandas 1.1.1 이 있어 `python3 scripts/generate_dummy_detections.py` 직접 실행도 동작 (입력 경로는 `SHEET_INDEX_PATH` 환경변수로 오버라이드 가능).

### 상한·다음 이정표 메모
- 이정표 2 시작 시 `npm install` 은 frontend 컨테이너 빌드 캐시에 이미 적용. 의존성 변경 없으면 재빌드 불필요.
- 본 이정표에서 작성된 `api/client.ts` 시그니처는 이정표 2 부터 그대로 사용. 단, mock 단계에서 일부 함수는 호출되지 않은 상태(이정표 3 부터 본격 사용).
- `components/Common/` 11종은 이정표 2 에서 한꺼번에 작성 예정.

---

## 이정표 2 — 도엽 목록 동작 (Day 2~3) ✅

### 인프라 / 의존성
- [x] Leaflet CSS 글로벌 import (`index.css`)
- [x] `cn` 유틸 추가 (`utils/cn.ts` — clsx + tailwind-merge)

### Common 11종 기초 UI (`components/Common/`)
- [x] Button (4 variant × 3 size, forwardRef + active:scale-95 primary)
- [x] Card (DESIGN_SYSTEM 단일 공식 + clickable mode)
- [x] Input (forwardRef, leftIcon/rightIcon, invalid 상태)
- [x] Select (native, Input 동일 시각)
- [x] Modal (Radix alert-dialog, 헤더/본문/푸터 단일 공식, blockDismiss 옵션)
- [x] Tabs (border-b-2 underline 타입, generic value)
- [x] Badge (5 tone × pulse, text-[10px] rounded-full)
- [x] Progress (h-1.5 / h-2, ARIA progressbar)
- [x] Tooltip (Radix popover, side/align)
- [x] Accordion + AccordionGroup (자체 구현, exclusive 옵션, ARIA)
- [x] index.ts re-export

### 레이아웃 (`components/Layout/`)
- [x] Header — h-14, 메뉴 토글 + 로고 + 중앙 네비(NavLink active 표시) + 알림 placeholder
- [x] Sidebar — 펼침 260px / 접힘 56px, uiStore.sidebarCollapsed 영속, 접힘 시 Tooltip 라벨
- [x] AppShell — Header + Sidebar + main(flex-1, overflow-auto)
- [x] AuthModeToggle — 빈 컴포넌트 (인터페이스 보존)
- [x] App.tsx — 4개 라우트를 AppShell 로 일괄 래핑

### /sheets 페이지 (`pages/Sheets.tsx`, `components/Sheets/`)
- [x] SheetCard — 도엽코드 4-4 분리, 검수 상태 배지, F1/Recall/Precision 메트릭, hover 동기화
- [x] SheetListFilter — 검색·검수상태(다중 칩)·권역(Select)·객체 카테고리(다중 칩)·전체 초기화
- [x] SheetMap — React-Leaflet + OSM 베이스맵 + GeoJSON 격자 overlay + 검수 상태별 색 + hover 동기화
- [x] sheetsStore 보강 — hoveredSheetCode, applyFilter 함수, useFilteredSheets useMemo selector
- [x] 단일 진실 원천: filter 1회 변경 → 카드 + 지도 격자 색 + 카드 카운트 동시 반응

### 랜딩 — Common 갤러리 임시 섹션
- [x] 4개 탭(버튼/입력/상태/컨테이너) + Modal 데모
- [x] 이정표 6 다듬기 단계에서 dev-only 처리 또는 제거 예정

### 검증
- [x] `tsc --noEmit` 통과 (frontend, 39 ts/tsx files)
- [x] `dark:`, purple/violet/indigo, font-semibold, 직접 fetch, OpenLayers, MUI 모두 0건
- [x] 4개 라우트만 등록 유지 (HashRouter)
- [x] 도엽 격자 GeoJSON (6.5MB, 17,034 features) 정상 fetch
- [x] 사이드바 토글 → `nbm.ui.sidebarCollapsed` localStorage 영속

### GATE 기록
- 🚪 GATE-A 통과: 2026-05-06 (구두 승인 "다음단계로 가자" + 이전 cvp→nbm 치환 직후)
- 🚪 GATE-D 통과: 2026-05-06 (보고 후 사용자 검토 대기)

### Claude 측 결정 / 가정
- **베이스맵**: OSM 표준 타일 (`tile.openstreetmap.org`). 사내망에서 외부 접근 차단 시 추후 교체 (네이버/카카오 또는 자체 타일 서버).
- **격자 17,034개 hover 이벤트**: `onEachFeature` 로 sub-layer 마다 mouseover 등록 (Leaflet 표준). `preferCanvas` + `setStyle` 직접 갱신으로 React 재렌더 비용 최소화. 첫 진입 시 약간의 지연이 있을 수 있음 — 이정표 6 다듬기에서 viewport bbox 기반 가시 격자만 렌더하도록 최적화 가능.
- **카드↔지도 hover 동기화**: 단방향(카드 hover → 지도 강조 + 지도 hover → 카드 ring). 양방향 모두 `sheetsStore.hoveredSheetCode` 단일 키 구독.
- **검수 상태별 격자 색**: `sheets/index.json` 에 메타 있는 도엽만 컬러, 없는 도엽은 중성 회색(미검수 외 표현 제외 — UI 노이즈 회피).
- **무한 스크롤 미구현**: PROMPTS §2 명시 범위 외. 현재 더미는 2건이라 단일 페이지로 충분.
- **랜딩 Common 갤러리**: 별도 라우트 신설 금지(CLAUDE.md §6.4)와 PROMPTS §2 의 "갤러리 페이지" 요건의 충돌을 랜딩 카드 안에 임시 섹션으로 우회. 이정표 6 에서 dev-only 처리 또는 제거.

### 보강 (이정표 2 Phase B 종료 직후)
- 도엽 격자 17,034 features 렌더 부담 해소: `regions.geojson` (8 권역 디졸브, 166KB) 신규. `listRegions()` API + `loadRegions` 액션 + `RegionsLayer` + `SheetsLayer` 분리. 기존 `sheets-index.geojson` (6.5MB) 는 백엔드 시드용으로 보존.

---

## 이정표 3 — 도엽 검수 상세 동작 (Day 4~7) ✅

> 시스템의 80%가 본 이정표에 들어감. 가장 큰 작업.

### 인프라
- [x] `index.css` 에 `leaflet-draw/dist/leaflet.draw.css` import
- [x] `frontend/src/types/leaflet-draw.d.ts` ambient 타입 보강 (L.Draw.Polygon 등)
- [x] `AppShell` 에 `react-hot-toast` Toaster 등록

### Phase B-1: 시각화 기반 (읽기 모드)
- [x] `sheetDetailStore` 완성 — load/reset, filter, viewerMode, editTool, selectedIds, hoveredId, rightPanel, undo/redo 인프라, deletionMarkers, 5종 selector(useFilteredDetections, useChangeTypeCounts, useErrorClassCounts, useDetectionById, useCanCompleteSheet)
- [x] `pages/SheetDetail.tsx` — 좌 380px + 중앙 지도 + 우 슬라이드인 패널
- [x] `components/SheetDetail/SheetSidebar.tsx` — 도엽 헤더(코드·도엽명·권역·검수상태 배지·검수완료/보류 버튼) + UndoRedoBar + 6 아코디언
- [x] `accordions/AnalysisDataAccordion.tsx` — 1번 분석 데이터 (기준/비교 영상 메타)
- [x] `accordions/ConfidenceAccordion.tsx` — 2번 확신도 (자체 듀얼 핸들 슬라이더 + 프리셋 칩)
- [x] `accordions/ChangeTypeAccordion.tsx` — 3·4번 건물·도로 변화 (마스터 체크 + 변화 유형 체크 + 카운트)
- [x] `accordions/ErrorClassAccordion.tsx` — 5번 오류분류 (8종 + 미분류 카운트 + "미분류만 보기")
- [x] `accordions/ReviewHistoryAccordion.tsx` — 6번 검수 히스토리 (시간 역순 + 행 클릭 → selectObject)
- [x] `RightPanel.tsx` — 슬라이드인 컨테이너 + 정보/리포트 탭 + 토글 핸들
- [x] `DetectionInfoPanel.tsx` — 우 패널 객체 정보 (단건/다중 분기, 메타, 의견 100자 제한 + 카운터, 폴리곤 편집/삭제 버튼)
- [x] `DetectionMap.tsx` — 단일 모드, 폴리곤 fill=변화 유형 / stroke=오류분류 / 미분류=점선+50% opacity / 선택=4px stroke + flyToBounds

### Phase B-2: 4종 뷰어 모드 + 인터랙션
- [x] `ViewerModeToolbar.tsx` — 좌상단 4 버튼 (single/split/swipe-x/swipe-y)
- [x] `MapToolbar.tsx` — 상단 중앙 4 버튼 (select/lasso/draw/edit, 상호 배타)
- [x] `DetectionMap.tsx` 확장 — split=좌·우 MapContainer + view 동기화(setView), swipe-x/y=드래그 셔터(자체 구현, mock OSM 동일 타일 + 라벨로 구분)
- [x] `DrawController` — leaflet-draw 통합. draw 모드 = Polygon 그리기 → `applyCreate` (FN 자동 분류) → editTool='select' 복귀
- [x] lasso 모드 — 폴리곤 클릭 시 토글 다중선택 (드래그박스 lasso는 추후 보강 가능)

### Phase B-3: 오류분류·검수 액션·리포트·히스토리·Undo/Redo
- [x] `ErrorClassCard.tsx` — 8 라디오 카드 + 검수 의견 100자 제한 + 단건 즉시 적용 / 다중 confirm 모달
- [x] `ReportPanel.tsx` — 건물·도로 탭 + 요약(건수/면적/검수율) + 도넛 2(변화 유형, 오류분류) + 통계표(유형별 TP/FP/FN/미분류) + 누적막대(행정구역별)
- [x] `ReportGrid.tsx` — AG Grid Community + 페이지네이션 + 행 클릭 → selectObject
- [x] `UndoRedoBar.tsx` — Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y 단축키 + 사이드바 상단 버튼 + input/textarea 안에서는 무시
- [x] sheetDetailStore — applyClassify/applyEditGeometry/applyEditMeta/applySoftDelete/applyCreate/undo/redo + redoStack
- [x] 도엽 검수 완료 처리 — 모든 객체 분류 시 활성, confirm 모달 → updateSheetStatus('completed') → /sheets 카드 색 갱신
- [x] 삭제 이력 임시 마커 — 5초 자동 해제 (DeletionMarkersLayer)
- [x] Export 버튼 (SHP/DXF/PDF) — toast stub (이정표 5에서 실 구현)

### 검증 (Phase C)
- [x] `tsc --noEmit` 통과 (frontend, 64 ts/tsx files)
- [x] `dark:`, purple/violet/indigo, font-semibold, 직접 fetch, OpenLayers, MUI 모두 0건
- [x] 4개 라우트만 등록 유지
- [x] 더미 도엽(37708034) 148 폴리곤 정상 응답
- [x] dev server HMR 깨끗 (Duplicate key 경고 등 모두 fix)

### GATE 기록
- 🚪 GATE-A 통과: 2026-05-07 (3개 결정사항 모두 승인)
- 🚪 GATE-D 통과: 2026-05-07 (보고 후 사용자 검토 대기)

### Claude 측 결정 / 가정
- **모드별 영상 layer**: 1차 mock 단계라 split / swipe-x / swipe-y 모두 OSM 동일 타일. 좌="기준영상 (2022)" / 우="비교영상 (2024)" 라벨로만 구분. 이정표 5에서 datasets 메타로부터 실제 TileLayer URL 가져와 swap.
- **swipe-y 자체 구현**: leaflet-side-by-side 가 X 전용. Y 는 단일 MapContainer 위에 라벨 분할 + 드래그 가능한 셔터 라인만 표시 (mock 단계). 실 영상 도입 시 두 TileLayer 의 clip-path 적용 필요.
- **lasso 모드 단순화**: 폴리곤 클릭 시 토글 다중선택. 진정한 드래그 박스 lasso 는 향후 보강 가능 (leaflet-draw Rectangle 응용). 현재 다중선택 일괄 분류 워크플로우는 동작.
- **Undo 데이터 복원**: history.before payload 의 선택적 필드를 patch 로 적용. 신규 생성(action='create')은 soft-delete 로 undo, redo 는 soft-delete 해제.
- **Export stub**: 이정표 5 에서 본격 구현. 현재는 toast("이정표 5에서 동작") 만.
- **편집 모드 폴리곤 vertex 편집**: leaflet-draw 의 Edit toolbar 통합은 추후 보강 (현재 'edit' 도구 클릭 시 도구 활성 상태만 표시). 실질적 vertex 편집 인터랙션은 이정표 5 또는 별도 보강 시점에 추가.
- **차트 라이브러리 ag-grid quartz 테마**: AG Grid Community + ag-theme-quartz CSS import. 페이지네이션 free 포함.
- **삭제 마커 5초**: 사용자 대기 중 setInterval prune. 페이지 이동 시 정리.

### 보강 (이정표 3 사용자 검증 중 발견 → 수정)
- 사용자-추가 폴리곤도 drafts patch 받도록 수정 (`api/client.ts` `applyDetectionDrafts` 의 added 처리)
- lasso closure stale 수정 — 클릭 핸들러가 store getState 로 직접 읽음
- lasso 드래그-박스 추가 — window capture phase + DIV 박스 (Leaflet 이벤트 시스템 우회)
- draw 모드 4점+ 지원 — `allowIntersection: true` + 폴리곤 click 핸들러가 draw 모드에서 stopPropagation 안 함
- 빈영역 클릭으로 선택 해제 (`EmptyClickClearController`)
- preferCanvas 제거 (모든 4 모드) — SVG 렌더링으로 mousedown 신뢰성 확보
- Click 후처리 억제 — drag 직후 fire 될 click 1개를 capture 단계에서 차단

---

## 이정표 4 — 데이터셋·위저드 동작 (Day 8~10) ✅

### 인프라
- [x] backend Dockerfile 에 `PYTHONPATH=/app` 추가
- [x] docker-compose backend volumes 에 `./frontend/public/data:/data/seed:ro` 추가
- [x] frontend/.env.example + frontend/.env (VITE_API_BASE_URL 활성)

### Backend (B-3)
- [x] Pydantic schemas — sheet, detection, dataset, history, task + common
- [x] SQLAlchemy ORM — sheets, detections, datasets, review_histories, tasks (PostGIS 5186)
- [x] alembic 0001_init — PostGIS 확장 + 5 테이블 + 인덱스
- [x] api/ 5 라우터 — sheets, detections, datasets, history, tasks (읽기 전용)
- [x] services/serializers.py — ORM → Pydantic + 5186→4326 좌표 변환 (pyproj)
- [x] utils/geo.py — Transformer + WKT/WKB 변환
- [x] scripts/seed.py — 정적 JSON → PostGIS

### 검증 (Backend)
- [x] alembic upgrade head 통과
- [x] seed.py: sheets 2, detections 251, datasets 6, tasks 1
- [x] 5 read API 모두 200 응답 (sheets, detections, datasets, overlap, history, tasks)

### Frontend /datasets (B-1)
- [x] pages/Datasets.tsx — 좌 280px + 우 메인(헤더 + 카드 그리드 1/2/3/4 반응형)
- [x] DatasetCard, DatasetFilterSidebar
- [x] datasetsStore 보강 — 위저드 + overlap + uploadOpen + appendDataset + useFilteredDatasets memoized

### Frontend 업로드 + 위저드 (B-2)
- [x] UploadModal — 파일 + 메타 + 진행률 + 토스트
- [x] services/upload.ts mock 시뮬레이션
- [x] NewTaskWizard — 3단계 + 자동 중첩률 호출
- [x] WizardStepResource (1·2 단계 공용), WizardStepMeta (3 단계)
- [x] OverlapBadge — ≥70% emerald / 30~70% amber / <30% red

### Frontend swap (B-4)
- [x] frontend/.env: `VITE_API_BASE_URL=/api/v1` same-origin 기준
- [x] api/client.ts dual-mode 환경변수 swap 검증

### 검증 (Frontend)
- [x] tsc --noEmit 통과 (71 ts/tsx files)
- [x] dark / 보라 / font-semibold / 직접 fetch / OpenLayers / MUI 0건
- [x] backend 모드 응답 정상

### GATE 기록
- 🚪 GATE-A 통과: 2026-05-07
- 🚪 GATE-D 통과: 2026-05-07

### Claude 측 결정 / 가정
- **Dataset.type vs source 충돌**: BACKEND_API_SPEC §4.1 의 `type:"image"` 대신 frontend 와 동일한 `source` 필드 사용 (정사영상 단일 비교라 type 컬럼 불필요).
- **mock JSON 호환 시드**: backend 가 frontend public/data 의 JSON 을 ST_Transform(4326→5186) 으로 PostGIS 적재 → mock 모드와 backend 모드가 동일 데이터.
- **읽기 API만**: PATCH/POST/DELETE 는 이정표 5. 본 이정표에서 swap 후에도 검수 결과 변경은 mock localStorage 동작 유지. 새로고침 시 backend read 로 복귀.
- **PYTHONPATH=/app**: scripts/seed.py 가 `from app.database import ...` 임포트 가능하도록 Dockerfile env 추가.
- **CORS / proxy**: dev/prod 모두 브라우저는 same-origin 경로를 사용한다. 개발 host 진입점은 `서버IP:18210`, 운영 host 진입점은 `배포PC_IP:18200`.
- **무한 스크롤**: 데이터셋 6건이라 인프라(useInfiniteScroll hook)도 보류. 실 다량 데이터 적재 시 추가.
- **task.status 단순화**: BACKEND_API_SPEC celery_state 대신 status. Celery 통합(이정표 5)에서 매핑.

### 보강 (이정표 4 사용자 검증 중 발견)
- 데이터셋 하드 삭제 (PROMPTS §4 외 보강) — backend `DELETE /api/v1/datasets/{id}` + 참조 무결성 (사용 중 task 있으면 409 + blocking_tasks)
- frontend DatasetCard hover 휴지통 + confirm 모달
- 응답 형식 204 → 200 + JSON `{deleted, id}` (브라우저 fetch 호환성)
- FastAPI HTTPException body 구조 (`body.detail.error`) 정확 파싱

---

## 이정표 5 — 모델 통합 + Export (Day 11~12) ✅

> **변화탐지 모델은 mock**. PROMPTS §5 명시 fallback 채택. 외부 인터페이스 stable.

### Backend 쓰기 API (B-1) — 8 종 신규
- [x] `PATCH /api/v1/detections/{id}` — updateDetection + 검수 이력 자동
- [x] `POST /api/v1/sheets/{code}/detections` — createDetection (FN) + 'create' 이력
- [x] `PATCH /api/v1/detections/{id}/deletion` — softDelete + 'delete'/'restore'
- [x] `DELETE /api/v1/sheets/{code}/history/recent?count=N` — popHistory + before 복원
- [x] `PATCH /api/v1/sheets/{code}/status` — updateSheetStatus
- [x] `POST /api/v1/datasets` — createDataset
- [x] `PATCH /api/v1/datasets/{id}/status` — updateDatasetStatus
- [x] `POST /api/v1/uploads` — multipart 파일 + storage 저장 + Dataset 생성
- [x] `services/history.py` — append/infer 헬퍼

### Celery + Redis (B-2) + 변화탐지 mock (B-3)
- [x] `app/workers/celery_app.py` — broker/backend = Redis
- [x] `app/workers/tasks.py` — `run_change_detection(task_id)` 진행률 갱신 + 도엽별 polygon INSERT
- [x] `engines/change-detection/run.py` — mock 모델 (카테고리별 분포)
- [x] `docker-compose.yml` — `celery-worker` + storage-data 볼륨
- [x] `app/api/tasks.py` — POST /tasks enqueue + GET /tasks/{id}/status

### Frontend (B-5)
- [x] `hooks/useTaskPolling.ts` — 1.5초 폴링 + 완료 자동 종료 + onComplete 콜백
- [x] `api/client.ts` getTaskStatus
- [x] `stores/datasetsStore.ts` pendingTaskId 상태
- [x] `components/Sheets/TaskProgressBanner.tsx` — 진행 bar + 완료 토스트 + sheets 갱신 + 5초 자동 닫힘

### Frontend Export (B-6)
- [x] `services/exporters/proj.ts` — proj4js 5186 정의 + 변환 + PRJ
- [x] `services/exporters/shp.ts` — shp-write zip + DBF properties
- [x] `services/exporters/dxf.ts` — dxf-writer 변화 유형별 layer + ACI
- [x] `services/exporters/pdf.ts` — jsPDF (한글 폰트 임베드는 보강 필요, 현재 영문 fallback)
- [x] `types/shp-write.d.ts` — ambient 타입
- [x] `ReportPanel` — toast stub → dynamic import 실 호출

### 검증
- [x] tsc --noEmit 통과 (78 ts/tsx files)
- [x] dark / 보라 / font-semibold / 직접 fetch / OpenLayers / MUI 0건
- [x] backend 5 read + 8 write API 정상
- [x] **End-to-end**: 위저드 → POST /tasks (Celery enqueue) → worker mock → 306 폴리곤 INSERT → succeeded (0.17초)

### GATE 기록
- 🚪 GATE-A 통과: 2026-05-07 (모델 mock 우회 합의)
- 🚪 GATE-D 통과: 2026-05-07

### Claude 측 결정 / 가정
- **모델 mock**: PROMPTS §5 fallback 채택. `engines/change-detection/run.py` 인터페이스 stable.
- **task 추론 누적**: mock 단계 — 도엽별 카테고리별 무작위 폴리곤 INSERT 누적. 실 운영에서는 task_id 컬럼 또는 정리 정책.
- **Celery state ↔ status**: status 단일 사용. worker 가 직접 task row 업데이트.
- **PDF 한글 폰트**: 1차 영문 fallback. base64 임베드는 사용자 요구 시 추가.
- **tus-js-client 미통합**: 단순 multipart POST 로 대체.
- **Storage**: storage-data 볼륨. 운영(이정표 6)에서 사내 NAS bind mount 로 교체.

### 보강 (이정표 5 사용자 검증 중)
- 업로드 파이프라인 강화 (실 정사영상 업로드)
  - `backend/app/services/upload_processor.py` — rasterio 로 TIFF bbox 추출 + PostGIS `ST_Intersects` 로 sheet_codes 자동 + status auto-promote
  - `backend/app/api/uploads.py` — multipart 수신 후 process_upload 호출, 실패 시 422 + 사유
  - `backend/requirements.txt` — `rasterio==1.3.10` 활성화
  - `frontend/src/services/upload.ts` — XHR multipart 업로드, same-origin `/api/v1/uploads`
- Vite/nginx 프록시 설정 — 읽기/쓰기 API 는 same-origin (`/api/v1/...`) 로 통일
- CORS regex — localhost / LAN IP 허용 (`192.168.x.x`, `10.x.x.x`)
- 데이터셋 삭제 응답: 204 → 200 + JSON (브라우저 fetch 호환성)

### 메인 화면 재구조 (aerial-survey-manager 패턴 적용)
사용자 요청에 따라 메인화면 통합. CLAUDE.md / PROJECT_BRIEF.md §2.1 갱신.

- [x] `/` 통합 대시보드 — 좌 도엽 카드 리스트 + 중앙 한국 전도 + 하단 통계/차트
- [x] `pages/Sheets.tsx` 제거, `/sheets` → `/` redirect
- [x] `components/Dashboard/` 신규 — StatsCards (4 카드) + MonthlyLineChart + RegionDonut + StatusDonut + MonthlyBarChart + ChartsRow
- [x] `stores/dashboardStats.ts` — useOverviewStats / 차트 derived selector 4종
- [x] `components/Landing/CommonGallery.tsx` 제거 (시각 검증 완료, 이정표 6 다듬기에서 결정)
- [x] `Header.tsx` — "변화탐지" 네비 → `/`
- [x] `Sidebar.tsx` (전역) — "도엽 목록" 항목 제거, "변화탐지" + "데이터셋" 2개로 단순화
- [x] tsc --noEmit 통과 (84 ts/tsx files)
- [x] dark / 보라 / font-semibold / 직접 fetch / OpenLayers / MUI 0건

#### 추가 통합 (사용자 요청 — 데이터셋 페이지도 흡수)
- [x] `components/Dashboard/DatasetsSection.tsx` 신규 — 통합 대시보드 하단 섹션 (제목·검색·업로드 버튼·카드 그리드)
- [x] `pages/Datasets.tsx` 제거 → `/datasets` 도 `/` 로 redirect
- [x] `pages/Landing.tsx` 에 `DatasetsSection` + `UploadModal` + `NewTaskWizard` 통합
- [x] `components/Layout/Sidebar.tsx` 제거 — 전역 사이드바 폐기 (페이지 자체 사이드바가 컨텍스트 제공)
- [x] `components/Layout/Header.tsx` 단순화 — nav 항목 제거, 메뉴 토글 제거, 로고 + 알림 placeholder 만
- [x] `components/Layout/AppShell.tsx` — Sidebar 제외, Header + main 만
- [x] CLAUDE.md / PROJECT_BRIEF.md §2.1 갱신 — 활성 라우트 2개 (`/`, `/sheets/:code`)
- [x] tsc --noEmit 재통과

#### 추가 보강 (2026-05-22 사용자 요청)
- [x] `.env` 재정렬 — 호스트 데이터 경로 4종(ORTHOMOSAIC / EXPORT_OUTPUT / VWORLD / DEM) 을 최상위로 승격
- [x] `HOST_EXPORT_OUTPUT_DIR` 신설 — 변화탐지 결과물(SHP/DXF/PDF) 호스트 영구 저장. backend/celery-worker 양쪽에 마운트
- [x] `HOST_ORTHOMOSAIC_DIR=/media/innopam/InnoPAM-8TB/orthomosaic` — backend/celery-worker `/data/orthomosaic:ro` 마운트
- [x] `backend/app/services/orthomosaic_registry.py` 신규 — startup 시 `.tif` 스캔 → `process_upload()` 로 bbox·sheet_codes 추출 → aerial 데이터셋 자동 INSERT (중복 tile_path 스킵)
- [x] `app/main.py` lifespan — `scan_and_register()` 호출, 실패해도 서버 기동 계속
- [x] 1차 검증: 15개 orthomosaic .tif → aerial 데이터셋 등록 완료 (총 datasets 24건)
- [x] `utils/constants.ts` `CHANGE_TYPES` 순서 변경 — 신축(신설) → 소멸 → 갱신 (사이드바 / 차트 / 범례에 일괄 반영)
- [x] `services/exporters/task.ts` `exportTaskAsShp` 재작성
  - shp-write 의 `download()` 는 `location.href = 'data:...'` 로 SPA navigate 시켜 실패 → `zip()` 호출 후 Blob 직접 트리거로 교체
  - zip 내부 PRJ (WGS84 하드코딩) 를 EPSG:5186 PRJ 로 덮어써 좌표(5186)와 정합성 확보
  - detections=0 시 명확한 에러 메시지
- [x] `types/shp-write.d.ts` — `shp-write.zip` / `jszip` 동기 API 타입 보강
- [x] tsc --noEmit 통과
- [x] **shp-write 0.3.2 polygon 버그 패치** (`patches/shp-write+0.3.2.patch`)
  - 원본 `geojson.polygon` 이 모든 feature 를 1개의 multipart record 로 합쳐 SHP 1건만 출력 (1822 → 1) + 속성 누락
  - `justType` 의 wrapping `[oftype.map(justCoords)]` 제거 → feature 단위 record
  - `justCoords` 가 outer ring 만 반환 → 모든 ring (outer + holes) 보존
  - `frontend/node_modules/.vite` 캐시 무효화 후 재기동 (HMR 시 자동 재최적화)
  - 검증: 3-feature mock → SHP 3 record + DBF 3 row 확인
- [x] 색상 통일: 도로 소멸 `#f59e0b` → `#10b981` (건물·도로 통일 매핑)
