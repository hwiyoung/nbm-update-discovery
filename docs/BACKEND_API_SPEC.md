# 백엔드 API 명세 (BACKEND_API_SPEC)

> 본 문서는 프론트엔드 `src/lib/api.ts`의 함수 시그니처를 REST 엔드포인트로 매핑한 단일 진실 원천입니다.
> 추후 FastAPI에서 자동 생성되는 OpenAPI 문서로 대체될 수 있으나, 초안은 사람이 읽기 좋은 Markdown으로 유지합니다.

---

## 0. 공통 규약

### 0.1 베이스 경로
```
/api/v1
```

### 0.2 요청·응답 형식
- Content-Type: `application/json`
- 좌표계: 모든 geometry는 **EPSG:4326** (백엔드가 5186 → 4326 변환 후 응답)
- 타임스탬프: ISO 8601 UTC (`2026-04-30T15:55:00Z`)

### 0.3 에러 응답 (공통)
```json
{
  "error": {
    "code": "RESOURCE_NOT_FOUND",
    "message": "도엽을 찾을 수 없습니다",
    "details": { "sheet_code": "37708034" }
  }
}
```

| 코드 | HTTP | 의미 |
|---|---|---|
| `RESOURCE_NOT_FOUND` | 404 | 도엽·객체·데이터셋 등 미존재 |
| `VALIDATION_ERROR` | 422 | Pydantic 검증 실패 |
| `BUSINESS_RULE_VIOLATION` | 400 | 정사영상-수치지도 비교 같은 정책 위반 |
| `TASK_FAILED` | 500 | Celery 작업 실패 |
| `INTERNAL_ERROR` | 500 | 그 외 |

### 0.4 인증
1차 출시: 미적용 (내부망·단일 사용자). 모든 요청 신뢰.
헤더 `X-User-Mode: reviewer | contractor` (선택, 권한 분기 추적용).
2차: 백엔드 인증 도입 시 본 절 갱신.

### 0.5 페이지네이션
1차 출시: 적용 안 함 (도엽 1매당 객체 100~200개 수준). 추후 필요 시 `?page=&size=` 추가.

---

## 1. 도엽 (Sheets)

### 1.1 `GET /api/v1/sheets` — 도엽 목록

**프론트 매핑**: `listSheets()` (`lib/api.ts`)

**쿼리 파라미터** (선택, 1차 출시는 무시 가능)
| 파라미터 | 타입 | 비고 |
|---|---|---|
| `region` | string | 권역명 |
| `status` | string | `pending` \| `in_progress` \| `completed` \| `on_hold` |
| `task_id` | string | 특정 작업의 도엽만 |

**200 응답**
```json
[
  {
    "code": "37708034",
    "name": "안양",
    "region": "수도권남부 권역",
    "bbox": [126.92, 37.40, 126.99, 37.45],
    "geometry": { "type": "Polygon", "coordinates": [...] },
    "area_km2": 23.4,
    "review_status": "in_progress",
    "reviewer": "검수자1",
    "reviewed_at": "2026-04-30T15:55:00Z",
    "task_id": "task-uuid-...",
    "models": ["building", "road"],
    "compare_type": "image-image",
    "standard_resource_id": 11,
    "compare_resource_id": 22,
    "f1_score": 0.633,
    "precision": 0.71,
    "recall": 0.57,
    "total_detections": 148,
    "reviewed_detections": 80,
    "tp_count": 50,
    "fp_count": 25,
    "fn_count": 5
  }
]
```

### 1.2 `GET /api/v1/sheets/{sheet_code}` — 도엽 단건

**프론트 매핑**: `getSheet(sheetCode)`

**404**: `RESOURCE_NOT_FOUND`

**200 응답**: 1.1과 동일 형식 단건.

### 1.3 `PATCH /api/v1/sheets/{sheet_code}/status` — 검수 상태 변경

**프론트 매핑**: `updateSheetStatus(sheetCode, status)`

**요청**
```json
{
  "status": "completed"
}
```

**200 응답**: 갱신 후 도엽 단건 (1.2 형식).

**유효성**
- `status` ∈ {`pending`, `in_progress`, `completed`, `on_hold`}
- 검수자 정보(`reviewer`, `reviewed_at`)는 백엔드가 자동 채움.

---

## 2. 변화탐지 객체 (Detections)

### 2.1 `GET /api/v1/sheets/{sheet_code}/detections` — 객체 목록

**프론트 매핑**: `listDetections(sheetCode)`

**쿼리 파라미터** (선택)
| 파라미터 | 타입 | 비고 |
|---|---|---|
| `include_deleted` | bool | 기본 false |
| `error_class` | string | 특정 오류분류만 |

**200 응답**
```json
[
  {
    "id": "det-uuid-...",
    "sheet_code": "37708034",
    "model": "building",
    "change_type": "building_new",
    "confidence": 87.3,
    "area_m2": 234.5,
    "geometry": { "type": "Polygon", "coordinates": [...] },
    "region_code": "41171",
    "address": "경기도 안양시 만안구 ...",
    "error_class": "TP",
    "reviewer_memo": "현장 확인 완료",
    "reviewed_by": "검수자1",
    "reviewed_at": "2026-04-30T15:55:00Z",
    "is_user_added": false,
    "is_deleted": false
  }
]
```

### 2.2 `PATCH /api/v1/detections/{detection_id}` — 객체 부분 업데이트

**프론트 매핑**: `updateDetection(sheetCode, objectId, payload)`

**요청** (`DetectionUpdatePayload`)
```json
{
  "error_class": "FP_shadow",
  "reviewer_memo": "그림자로 인한 오탐 확인",
  "geometry": { "type": "Polygon", "coordinates": [...] }
}
```

세 필드 모두 선택. 하나만 보내도 됨.

**200 응답**: 갱신 후 객체 단건 (2.1 형식).

**부수 효과** (백엔드 책임)
- 검수 이력 자동 추가 (3.1 참조). 트랜잭션 1건으로 처리.
- 액션 종류는 페이로드 내용에 따라 추론:
  - `error_class` 변경 → `classify`
  - `geometry` 변경 → `edit_geometry`
  - `reviewer_memo` 단독 변경 → `edit_meta`

### 2.3 `POST /api/v1/sheets/{sheet_code}/detections` — 객체 신규 추가 (FN)

**프론트 매핑**: `createDetection(sheetCode, draft)`

**요청**
```json
{
  "model": "building",
  "change_type": "building_new",
  "confidence": 100,
  "area_m2": 187.2,
  "geometry": { "type": "Polygon", "coordinates": [...] },
  "region_code": "41171",
  "address": "경기도 안양시 ...",
  "error_class": "FN",
  "reviewer_memo": "AI가 놓친 신축 건물"
}
```

**201 응답**: 생성된 객체 단건 (2.1 형식). `id` 자동 생성, `is_user_added: true`.

**부수 효과**
- 검수 이력 추가 (`action: 'create'`).

### 2.4 `PATCH /api/v1/detections/{detection_id}/deletion` — 소프트 삭제 / 복원

**프론트 매핑**: `softDeleteDetection(sheetCode, objectId, deleted)`

**요청**
```json
{
  "deleted": true
}
```

**200 응답**: 갱신 후 객체 단건.

**부수 효과**
- 검수 이력 추가 (`action: 'delete'` 또는 `'restore'`).

---

## 3. 검수 이력 (Review History)

### 3.1 `GET /api/v1/sheets/{sheet_code}/history` — 도엽별 이력

**프론트 매핑**: `listHistory(sheetCode)`

**쿼리 파라미터** (선택)
| 파라미터 | 타입 | 비고 |
|---|---|---|
| `limit` | int | 기본 200 |
| `since` | ISO 8601 | 이후만 |

**200 응답**
```json
[
  {
    "id": "hist-uuid-...",
    "object_id": "det-uuid-...",
    "sheet_code": "37708034",
    "model": "building",
    "change_type": "building_new",
    "geometry": { "type": "Polygon", "coordinates": [...] },
    "action": "classify",
    "before": { "error_class": null },
    "after": { "error_class": "TP" },
    "reviewer": "검수자1",
    "reviewed_at": "2026-04-30T15:55:00Z",
    "memo": null
  }
]
```

### 3.2 `DELETE /api/v1/sheets/{sheet_code}/history/recent?count=N` — 최근 N건 제거 (Undo)

**프론트 매핑**: `popHistory(sheetCode, count)`

**200 응답**: 제거된 이력 배열 (3.1 형식).

**비고**
- 이 API는 단순히 history만 제거하지 않고, **before 상태로 객체를 복원**해야 함. 트랜잭션으로 처리.
- 1차 출시에선 이 엔드포인트의 부담을 낮추기 위해 client side undo만 가능하게 두는 안도 검토. 백엔드가 항상 최신 상태만 신뢰.

> **결정 미정**: Undo를 클라이언트 전용으로 둘지, 서버 라운드트립으로 처리할지. 통합 시 결정.

---

## 4. 데이터셋 (Datasets)

### 4.1 `GET /api/v1/datasets` — 목록

**프론트 매핑**: `listDatasets()`

**200 응답**
```json
[
  {
    "id": 11,
    "type": "image",
    "display_name": "Anyang_2023.tif",
    "platform": "위성",
    "taken_start_at": "2023-08-01T00:00:00Z",
    "taken_end_at": "2023-08-31T00:00:00Z",
    "bbox": { "type": "Polygon", "coordinates": [...] },
    "tile_path": "/cog/anyang_2023.cog.tif",
    "sheet_codes": ["37708034", "37708035"]
  }
]
```

**비고**
- `tile_path`는 TiTiler가 해석하는 경로. 프론트는 `/cog/tiles/{z}/{x}/{y}?url={tile_path}` 형식으로 사용.

### 4.2 `GET /api/v1/datasets/{id}` — 단건

**프론트 매핑**: `getDataset(id)`

**200 응답**: 4.1 형식 단건.

### 4.3 `GET /api/v1/datasets/overlap` — 중첩률 계산

**프론트 매핑**: `getDatasetOverlapRatio(standardId, compareId)`

**쿼리 파라미터** (필수)
| 파라미터 | 타입 |
|---|---|
| `standard_id` | int |
| `compare_id` | int |

**200 응답**
```json
{
  "ratio": 0.87,
  "common_sheets": ["37708034", "37708035"]
}
```

**구현 비고**
- 1차 mock에선 `sheet_codes` 교집합 비율로 근사.
- 백엔드 정식 구현은 PostGIS의 `ST_Area(ST_Intersection(...))` / `ST_Area(ST_Union(...))`.

---

## 5. 변화탐지 작업 (Tasks)

### 5.1 `GET /api/v1/tasks` — 작업 목록

**프론트 매핑**: `listTasks()`

**200 응답**
```json
[
  {
    "id": "task-uuid-...",
    "name": "안양 2023→2025 변화탐지",
    "description": "...",
    "models": ["building", "road"],
    "compare_type": "image-image",
    "standard_resource_id": 11,
    "compare_resource_id": 12,
    "sheet_codes": ["37708034", "37708035"],
    "created_at": "2026-04-30T15:55:00Z",
    "created_by": "검수자1",
    "celery_state": "SUCCESS",
    "progress": 100,
    "error_message": null
  }
]
```

**Pydantic 추가 필드** (mock에 없음, 통합에서 추가)
- `celery_state`: `'PENDING' | 'STARTED' | 'PROGRESS' | 'SUCCESS' | 'FAILURE' | 'REVOKED'`
- `progress`: 0~100 (Celery `update_state` meta에서)
- `error_message`: 실패 시 메시지

### 5.2 `POST /api/v1/tasks` — 작업 등록 + 추론 큐 enqueue

**프론트 매핑**: `createTask(payload)`

**요청** (`TaskCreatePayload`)
```json
{
  "name": "안양 2023→2025 변화탐지",
  "description": "정기 갱신용",
  "models": ["building", "road"],
  "standard_resource_id": 11,
  "compare_resource_id": 12
}
```

**유효성**
- 두 자원 모두 `type === "image"` (정사영상-정사영상). 위반 시 `BUSINESS_RULE_VIOLATION`.
- 두 자원의 `sheet_codes` 교집합 ≥ 1. 미만 시 `BUSINESS_RULE_VIOLATION`.

**202 응답** (Accepted, 비동기 처리 시작)
```json
{
  "id": "task-uuid-...",
  "celery_state": "PENDING",
  "progress": 0,
  "name": "...",
  "models": ["building", "road"],
  "compare_type": "image-image",
  "standard_resource_id": 11,
  "compare_resource_id": 12,
  "sheet_codes": ["37708034"],
  "created_at": "2026-04-30T15:55:00Z",
  "created_by": "검수자1"
}
```

**부수 효과**
- Celery 작업 enqueue. 작업 ID는 task ID와 동일하게 사용 (중복 ID 발급 회피).

### 5.3 `GET /api/v1/tasks/{task_id}/status` — 진행률 폴링

**mock에 없음, 통합에서 추가**

**200 응답**
```json
{
  "id": "task-uuid-...",
  "celery_state": "PROGRESS",
  "progress": 60,
  "current_stage": "변화탐지 추론 중 (3/5 도엽)",
  "error_message": null
}
```

**구현 비고**
- 프론트는 위저드 등록 후 본 엔드포인트를 1~5초 간격으로 폴링.
- 작업 완료 시(`SUCCESS`) 프론트는 `/sheets`로 이동하고 해당 작업 도엽 필터 적용.
- WebSocket·SSE는 1차 범위 외. 폴링으로 충분.

### 5.4 `DELETE /api/v1/tasks/{task_id}` — 작업 취소 (선택)

**mock에 없음, 통합에서 검토**

Celery `revoke`로 진행 중 작업 중단. 1차 범위 외.

---

## 6. 자원 — 정사영상 타일

TiTiler가 별도로 서빙. FastAPI 엔드포인트가 아니라 별도 컨테이너.

### 6.1 `GET /cog/tiles/{z}/{x}/{y}.png?url={dataset.tile_path}` — XYZ 타일

TiTiler 표준. Leaflet TileLayer URL 패턴으로 프론트가 직접 호출.

```
http://internal-host/cog/tiles/{z}/{x}/{y}.png?url=/data/cog/anyang_2023.cog.tif
```

**비고**
- Nginx에서 `/cog/*` 경로를 TiTiler로 reverse proxy.
- 인증·권한 1차에는 적용 안 함 (내부망).

### 6.2 `GET /cog/bounds?url={...}` — COG 범위 (선택)

지도 초기 fitBounds용.

---

## 7. mock vs 실 API 차이 정리

| 항목 | mock (`lib/api.ts`) | 실 API (백엔드) |
|---|---|---|
| 데이터 출처 | `public/data/*.json` + localStorage 합성 | PostgreSQL + PostGIS |
| 좌표 변환 | EPSG:4326 입력 그대로 | 백엔드가 5186 → 4326 변환 |
| 검수 결과 영속화 | localStorage | DB |
| 히스토리 자동 기록 | `_mutateWithHistory`가 클라이언트에서 호출 | 백엔드 트랜잭션 |
| 추론 실행 | 안 함 (등록만) | Celery 큐 → 모델 호출 |
| 진행률 | 없음 | `GET /tasks/:id/status` |
| 권한 | 클라이언트 모드 토글 | 1차 동일, 2차에서 백엔드 통합 |

---

## 8. swap 순서 (프론트 측)

1. `lib/api.ts`에 환경변수 또는 build-time flag로 mock/real 분기.
2. **읽기 함수부터 swap** (`listSheets`, `getSheet`, `listDetections`, `listDatasets`, `listHistory`).
3. 검증 후 **쓰기 함수 swap** (`updateDetection`, `createDetection`, `softDeleteDetection`, `updateSheetStatus`).
4. **작업 등록 + 진행률 폴링** (`createTask`, `getTaskStatus` 신규).
5. **localStorage 백업 코드 정리** (네트워크 끊김 대비 일부만 유지).

각 단계마다 mock·real 양쪽 동작 검증 후 다음 단계.

---

## 9. 결정 미정·통합 시 확정

- 좌표계 변환 위치 확정 — 백엔드 응답 직전 (현 안) vs PostGIS view에서 미리
- Undo의 서버 라운드트립 여부 (3.2 비고)
- WebSocket·SSE 도입 여부 (5.3 비고)
- 페이지네이션 도입 시점 (도엽당 객체 1,000개 초과 시?)
- 인증 도입 시점 (사용자 ≥ 2명 시)
- API 버전 관리 정책 (`/api/v2`로 전환 시점)
