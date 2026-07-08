# CLAUDE.md — 변화탐지 플랫폼 작업 규칙

> Claude Code가 본 프로젝트에서 작업할 때 반드시 따르는 규칙·플로우·금지사항.
> 매 세션 시작 시 본 문서를 먼저 읽는다.

---

## 0. 본 프로젝트의 작업 단위 — "이정표"

본 프로젝트는 **6개 이정표**로 진행되며, 각 이정표 안에서는 Claude Code가 자율적으로 작업한다. 이정표 종료 시점에만 사용자에게 보고·승인을 받는다.

```
이정표 1 — 셋업                  Day 1
이정표 2 — 도엽 목록 동작          Day 3
이정표 3 — 도엽 검수 상세 동작     Day 7    (시스템의 80%)
이정표 4 — 데이터셋·위저드 동작     Day 10
이정표 5 — 모델 통합 + Export      Day 12
이정표 6 — 운영 배포 준비          Day 14
```

각 이정표의 구체 작업 지시는 `PROMPTS.md`에 있다. 사용자가 PROMPTS.md의 해당 이정표 프롬프트를 한 번 던지면, Claude Code가 그 이정표를 끝까지 진행하고 게이트(🚪)에서 멈춘다.

---

## 1. 작업 플로우 — Phase A/B/C/D

각 이정표 안의 모든 작업은 다음 4단계로 진행한다.

### Phase A — 계획 (사용자 확인 필요한 경우만)

이정표 시작 시점에만 1회. 이정표 안의 세부 작업마다 반복하지 않음.

- 이정표의 요구사항 분석 + 구현 계획 수립
- 계획의 논리적 타당성 자체 검토
- 오버엔지니어링 검토
- 🚪 **GATE-A**: 이정표 계획을 사용자에게 보고하고 승인받음

### Phase B — 구현 (자율 진행)

- 계획에 따라 구현
- 구현이 원래 목적에 부합하는지 자체 검토
- 잠재적 버그·크리티컬 이슈·보안 문제 검토 및 수정
- 수정 사항에 새로운 문제가 없는지 검토

### Phase C — 코드 품질 (자율 진행)

- 과도하게 큰 함수·파일 분리
- 기존 코드와 통합·재사용 가능한 부분 검토
- 사이드 이펙트 확인
- 불필요한 코드 정리
- 코드 품질 최종 검토

### Phase D — 이정표 검증 (사용자 확인 필요)

이정표 종료 시점에만 1회.

- 이정표 종료 조건 충족 여부 확인 (PROMPTS.md의 이정표 검증 항목)
- 사용자 흐름(UX) 관점 검토
- 전체 변경 사항 통합 검토
- 🚪 **GATE-D**: 이정표 완료 보고 후 다음 이정표 진행 승인 요청

### 게이트 보고 형식

```
📍 현재 이정표: [이정표 N — 이름]
✅ 완료 항목: [목록]
⚠️ 발견된 이슈: [있다면]
📋 검증 결과: [PROMPTS.md의 이정표 검증 항목 체크 결과]
➡️ 다음 이정표: [이름]
❓ 필요한 결정: [사용자에게 물어볼 것]
```

---

## 2. 진행 상황 추적

`docs/PROGRESS.md` 에 모든 작업 진행을 누적 기록한다. 형식:

```markdown
# 진행 상황

## 이정표 1 — 셋업 (Day 1)
- [x] Vite + React + TS 골조
- [x] Tailwind 3.4 (extend 비움)
- [x] Docker compose 구성
- [x] 시작점 코드 — types/api/utils/services
- [x] 더미 데이터 생성
- 🚪 GATE-D 통과: 2026-05-06

## 이정표 2 — 도엽 목록 동작 (Day 2-3)
- [x] sheetsStore + listSheets API
- [x] /sheets 페이지 + SheetCard
- [ ] SheetMap (진행 중)
...
```

이슈 발견 시 별도 섹션에 "🔄 [이정표 N]로 회귀: 사유" 형식으로 기록.

---

## 3. 권위 문서 (충돌 시 우선순위)

| 영역 | 권위 문서 | 비고 |
|---|---|---|
| 도메인 의미·용어·데이터 스키마·워크플로우 | **`docs/PROJECT_BRIEF.md`** (최우선) | 본 시스템의 마스터 가이드 |
| 시각 표현 (색·폰트·간격·radius·shadow·레이아웃 골격) | `docs/DESIGN_SYSTEM.md` | A 시스템 디자인 시스템 |
| 화면 구조·인터랙션·상태 전이 | `docs/FEATURE_SPEC.md` | B 시스템 기능 명세 |
| 백엔드 통합·인프라·운영 환경 | `docs/INTEGRATION_PLAN.md` | 이정표 4·5·6에서 활성 |
| API 호출·페이로드·엔드포인트 매핑 | `docs/BACKEND_API_SPEC.md` | 이정표 4·5에서 활성 |
| 작업 단위·이정표 정의 | `PROMPTS.md` | 프롬프트 안에 검증 항목 포함 |

### 충돌 해결 결정 트리

```
도메인이 추가 요구하면 → 도메인이 양쪽 다 덮어씀 (PROJECT_BRIEF 최종 결정)
A에 있고 B에 없으면 → A 따름 (예: 카드 시각 디자인)
B에 있고 A에 없으면 → B 따름 (예: 무한 스크롤, 사이드바 토글, 위저드)
둘 다 있는데 다르면 → 시각이면 A, 기능이면 B
백엔드 통합 시점에 인프라·API 결정이 필요하면 → INTEGRATION_PLAN / BACKEND_API_SPEC
어떤 것에도 답이 없으면 → 추측 금지, 사용자에게 질문 (다음 게이트에서 일괄)
```

---

## 4. 도메인 용어 매핑

B 시스템 와이어프레임 코드를 참고할 때 라벨을 그대로 사용하지 말고 다음 매핑을 따른다.

| B 시스템 용어 | 본 플랫폼 용어 |
|---|---|
| 분석 / 분석하기 | 변화탐지 / 변화탐지 작업 |
| 분석 목록 | 도엽 목록 |
| 분석모델 | 객체 카테고리 |
| 분석 결과 | 변화탐지 결과 |
| 정보 수정 | **오류분류 부여** |
| 분석명 | 작업명 |
| 의견 | 검수 의견 |

행위로서의 "검수"는 유지: `검수자`, `검수 의견`, `검수 히스토리`, `검수 상태`, `도엽 검수 완료 처리`.

---

## 5. 절대 규칙 (시각·구조)

### 5.1 시각 (DESIGN_SYSTEM 1.2절 압축)

- **단일 액센트 컬러**: `blue-600` (hover `blue-700`). 다른 파랑·보라·청록 금지. semantic 3색은 `emerald`(성공) / `red`(오류·삭제) / `amber`(경고)만.
- **font-bold(700) 우위**: `font-semibold(600)` 거의 사용 안 함. 강조는 `font-bold`, 본문은 `font-normal`.
- **본문 14px / 보조 12px**: 16px 본문 사용 금지. 거의 모든 텍스트는 `text-sm` 또는 `text-xs`.
- **카드 단일 공식**: `bg-white rounded-xl p-5 shadow-sm border border-slate-100 hover:shadow-md transition-shadow`. 카드 `rounded-xl`, 입력 `rounded-md`, 버튼 `rounded-lg`.
- **모달 단일 공식**: 오버레이 `fixed inset-0 z-[1000] bg-black/60 backdrop-blur-sm`, 컨테이너 `bg-white rounded-xl shadow-2xl`, 헤더·푸터 `bg-slate-50` + `border-slate-200`. 푸터 버튼 우측 정렬.
- **고정 골격**: 헤더 `h-14`, 모달 헤더 `h-14`, 모달 푸터 `h-16`.
- **인터랙션 절제**: `transition-colors`가 기본. 큰 그림자·글로우·강한 스케일 변화 금지.
- **아이콘**: lucide-react만, 14·16·18·20px만.

### 5.2 변화탐지 도메인 색상 (폴리곤·차트 일치)

| 변화 유형 | 색 | 의미 |
|---|---|---|
| building_new (신축) / road_new (신설) | `#ef4444` red | |
| building_removed / road_removed (소멸) | `#10b981` emerald | |
| building_updated / road_updated (갱신) | `#3b82f6` blue | |
| building_color (색변화) | `#f59e0b` amber | 건물만 |

오류분류 색은 PROJECT_BRIEF 3.3절. 폴리곤 보더 또는 작은 마커로 부착.

### 5.3 검수 상태 배지 색

미검수 = slate, 진행중 = blue, 완료 = emerald, 보류 = amber.

---

## 6. 절대 금지 (자주 어기는 것)

### 6.1 시각

- 보라색 / 연보라 액센트
- 다크 모드, `dark:` 클래스
- 이모지 (UI 라벨·메시지·placeholder 어디에도). 의미 표현은 lucide-react 아이콘만.
- 그라데이션 배경 (랜딩 히어로의 매우 옅은 슬레이트 단색은 검토 후 허용)
- `font-semibold(600)` 남용

### 6.2 기술

- 페이지·컴포넌트에서 직접 `fetch` 호출. 모든 데이터 입출력은 `frontend/src/api/client.ts` 경유.
- OpenLayers 신규 도입. 지도는 React-Leaflet으로.
- Material UI / MUI. Tailwind만.
- IndexedDB·Cookie·sessionStorage 등 브라우저 영구 저장 API.
- localStorage 의존 — 단순 UI 환경설정(사이드바 토글 등)만 허용. 도메인 데이터 저장 금지.
- B 시스템 와이어프레임 코드 그대로 복붙. 패턴만 차용.

### 6.3 데이터 처리

- 좌표계 혼동: 파일 EPSG:5186, 프론트엔드 EPSG:4326. 변환은 백엔드 응답 직전.
- O(n²) 공간 연산 (폴리곤 충돌·인접 검사). 공간 인덱스 사용.

### 6.4 화면·문서

- 2개 활성 라우트(`/`, `/sheets/:sheetCode`) 외 신규 라우트 신설.
  - `/` 는 **통합 대시보드** (aerial-survey-manager 패턴) — 좌 도엽 카드 리스트 + 중앙 한국 전도 + 통계/차트 + **데이터셋 자원 섹션**.
  - 구 `/sheets`, `/datasets` 는 `/` 로 redirect (이정표 5 메인 화면 통합 시점).
  - 도엽 카드 클릭 → `/sheets/:sheetCode` 검수 화면 (시스템 80%) 진입.
- 추측으로 결정 사항 채우기. 답이 없으면 `[가정: ...]` 표기 후 게이트에서 사용자에게 질문.

---

## 7. 디렉토리 구조 (고정)

```
nbm-update-discovery/
├── README.md, CLAUDE.md, PROMPTS.md
├── docker-compose.yml, nginx.conf
│
├── docs/                          PROJECT_BRIEF, DESIGN_SYSTEM, FEATURE_SPEC,
│                                  INTEGRATION_PLAN, BACKEND_API_SPEC, PROGRESS
│
├── frontend/
│   ├── Dockerfile
│   ├── package.json, vite.config.ts, tailwind.config.js, tsconfig.json
│   ├── public/data/               더미 GeoJSON·JSON
│   └── src/
│       ├── api/                   client.ts (백엔드 호출 단일 접점)
│       ├── components/
│       │   ├── Common/            기초 UI 컴포넌트 (도메인 무지)
│       │   ├── Layout/            Header, Sidebar, AppShell
│       │   ├── Landing/, Sheets/, SheetDetail/, Datasets/
│       ├── stores/                Zustand
│       ├── services/              upload, exporters/
│       ├── utils/                 auth, constants, geoUtils, formatters
│       ├── types/                 sheet, detection, dataset, history, task, index
│       ├── pages/                 라우트 진입점 (얇은 래퍼)
│       └── hooks/
│
├── backend/
│   ├── Dockerfile, requirements.txt, alembic/
│   └── app/
│       ├── main.py, config.py, database.py
│       ├── api/, models/, schemas/, services/, workers/, utils/
│
├── engines/
│   └── change-detection/          모델 호출 wrapper
│
└── scripts/                       운영·배포·시드 스크립트
```

### 명명 규칙

- 컴포넌트 파일: PascalCase (`SheetCard.tsx`)
- 훅: camelCase + `use` prefix (`useSheetFilter.ts`)
- 스토어: `~Store.ts` (`sheetDetailStore.ts`)
- 유틸: camelCase (`formatArea.ts`)
- 타입: PascalCase. 도메인별 분리. 프론트는 `@/types`, 백엔드는 `app.schemas`

---

## 8. Docker 기반 작업 원칙

### 8.1 모든 명령은 Docker 컨테이너 안에서 실행

```bash
# 좋음
docker compose exec frontend npm run lint
docker compose exec backend alembic upgrade head
docker compose run --rm scripts python scripts/generate_dummy_detections.py

# 나쁨 (호스트에서 직접 실행)
npm run lint              # 호스트 Node 버전 충돌 위험
python scripts/...        # 호스트 Python·GDAL 충돌 위험
```

### 8.2 코드 수정은 호스트 파일시스템에서, 실행은 컨테이너에서

볼륨 마운트로 호스트의 `frontend/src/`, `backend/app/`이 컨테이너에 즉시 반영. HMR 동작.

### 8.3 의존성 추가 시 절차

1. `package.json` 또는 `requirements.txt` 호스트에서 수정
2. `docker compose build {service}` 로 이미지 재빌드
3. `docker compose up -d` 로 재기동

### 8.4 권장 컨테이너 (1차 출시 시점)

- `frontend` — Vite dev server 또는 빌드 산출물 (Nginx 서빙)
- `backend` — FastAPI + Gunicorn
- `postgres` — PostgreSQL + PostGIS
- `redis` — Celery 브로커
- `celery-worker` — 모델 추론
- `titiler` — COG 타일 서빙
- `nginx` — 리버스 프록시
- `scripts` — 일회성 작업용 (더미 데이터·시드 등)

---

## 9. 데이터·API 처리 규칙

### 9.1 좌표계
- 모든 파일·DB는 **EPSG:5186**.
- 프론트엔드 런타임은 **EPSG:4326만**.
- 변환은 백엔드 응답 직전.

### 9.2 백엔드 호출 단일 접점
- 프론트엔드의 모든 데이터 입출력은 `frontend/src/api/client.ts` 경유.
- 페이지·컴포넌트에서 직접 `fetch` 호출 금지.
- 본 원칙은 1차 mock 단계(이정표 1~2)에도 동일 적용. mock 함수도 `client.ts`에 둠.

### 9.3 권한 분기
- 단일 사용자라 1차 출시에 인증 미적용.
- `frontend/src/utils/auth.ts`에 단일 진실 원천 두되, 1차 출시는 항상 'reviewer' 모드 반환.
- 권한 분기 코드는 작성하되 모든 분기가 항상 통과.

### 9.4 파일 업로드
- 컴포넌트 → `frontend/src/services/upload.ts` 직접 호출.
- 업로드 완료 시 `services/upload.ts` 가 `api/client.ts`의 메타 등록 함수 호출.
- 1차 mock: setTimeout 시뮬레이션.
- 백엔드 통합: tus-js-client → `/api/v1/uploads` 엔드포인트.

### 9.5 단일 진실 원천 필터 동기화
- `sheetDetailStore`의 filter는 좌 사이드바 + 지도 + 우 패널이 모두 동시 구독.
- 별도 상태 분기 금지.

---

## 10. 자체 점검 체크리스트

이정표 종료 시점(GATE-D) 또는 큰 변경 후 점검:

- [ ] 도메인 용어를 4절 매핑표대로 사용했는가?
- [ ] 5절 절대 규칙(시각) 위반 0건? (`dark:` 검색 0건, 보라색 0건, 이모지 UI 텍스트 0건)
- [ ] 6절 금지사항 위반 0건? (직접 fetch 0건, OpenLayers 0건)
- [ ] 데이터 입출력은 `api/client.ts`를 경유하는가?
- [ ] 권한 분기는 `utils/auth.ts`의 의미 단위 함수를 사용하는가?
- [ ] 단일 진실 원천 필터 동기화가 깨지지 않았는가?
- [ ] 좌표계 처리 정합성 (파일 5186, 프론트 4326)?
- [ ] 추측한 결정에는 `[가정: ...]` 표기 + 다음 게이트에서 사용자 질의 예정?
- [ ] `docs/PROGRESS.md` 갱신 완료?
- [ ] `tsc --noEmit` (frontend), 백엔드 import 통과?

---

## 11. 부록 — 자주 쓰는 색 토큰

```
배경        bg-white, bg-slate-50
보더        border-slate-100 (카드), border-slate-200 (입력·구분선)
본문 텍스트 text-slate-800 (제목), text-slate-700 (소제목), text-slate-500 (보조)
액센트      bg-blue-600 / hover:bg-blue-700, text-blue-600
성공        bg-emerald-50, text-emerald-600, border-emerald-100
오류·삭제   bg-red-50, text-red-600, border-red-100
경고        bg-amber-50, text-amber-600, border-amber-100
```

차트 색상:
```
primary  #3b82f6, success #10b981, warning #f59e0b, danger #ef4444
multi    ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4']
```
