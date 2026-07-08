# 통합 단계 마스터 플랜 (INTEGRATION_PLAN)

> 본 문서는 프론트엔드 mock 단계 이후 **실제 변화탐지 엔진·정사영상·DB와 통합**하는 단계의 결정사항·순서·작업 항목을 정리합니다.
> 1차 출시 전제: 내부망, 단일 사용자, 정부 사업 (국가기본도 수시갱신 검수 지원).

---

## 0. 통합 전제 (확정)

| 항목 | 결정 | 근거 |
|---|---|---|
| 운영 환경 | 내부망 전용 | 사용자 결정 |
| 1차 사용자 수 | 단일 사용자 | 사용자 결정 |
| 인증 (1차) | 미적용. `lib/auth.ts`의 클라이언트 모드 토글로 충분 | 단일 사용자·내부망 귀결 |
| 비교 유형 | 정사영상-정사영상만 | 사용자 결정 |
| 동시 추론 작업 | 1개 | 사용자 결정 |
| 진행률 추적 | 필요 | 사용자 결정 |
| 모델 출력 | SHP 또는 GeoJSON, 입력 좌표계(EPSG:5186) 유지 | 사용자 결정 |
| 출력 스키마 | 본 플랫폼 `DetectionObject` 스키마와 일치 | 사용자 확인 |

---

## 1. 기술 스택 결정 (백엔드)

### 1.1 결정사항

| 영역 | 선택 | 비고 |
|---|---|---|
| 백엔드 프레임워크 | **FastAPI** | Python, 자동 OpenAPI, Pydantic으로 `src/types/` 1:1 매핑 |
| DB | **PostgreSQL 15+ / PostGIS 3+** | 공간 데이터 표준 |
| 마이그레이션 | **Alembic** | FastAPI + SQLAlchemy 표준 |
| 작업 큐 | **Celery + Redis** | Redis가 브로커 + 진행률 저장소 겸직 |
| 정사영상 서빙 | **COG + TiTiler** | 사전 변환 필수 (≥300GB 원본은 실시간 변환 불가) |
| 정사영상 변환 | **GDAL `gdal_translate -of COG`** | 표준 |
| 모델 호출 | **Celery worker 안에서 직접 호출** (subprocess 또는 import) | 모델이 Python이므로 별도 프로세스 분리 불필요 |
| 정적 호스팅 | **Nginx** | 프론트 정적 파일 서빙 |
| 백엔드 실행 | **Gunicorn + Uvicorn worker** | FastAPI 표준 |

### 1.2 채택하지 않은 대안

| 대안 | 채택 안 한 이유 |
|---|---|
| Django | FastAPI보다 무거움, OpenAPI 자동 생성 약함, Pydantic 미포함 |
| Spring | JVM 스택, 모델·전처리와 언어 분리되어 직렬화 부담 |
| Triton (모델 서버) | 단일 모델·단일 사용자에 과함. 다중 모델·실시간 서빙 필요할 때 가치 |
| Kubernetes Job | K8s 운영 부담이 단일 사용자 추론보다 무거움 |
| SQLite + SpatiaLite | 단일 사용자에도 추후 확장성 막힘 |
| MapServer/GeoServer | TiTiler보다 무겁고 COG 친화성 낮음 |
| 실시간 TIFF 타일링 | 첫 요청 수십 분 소요로 운영 불가 |

---

## 2. 시스템 구성도

```
[브라우저]
   │  (HTTP)
   ▼
[Nginx]──────────► 정적 프론트 (React 빌드 산출물)
   │
   └──► [FastAPI / Gunicorn+Uvicorn]
            │
            ├──► PostgreSQL + PostGIS
            │       (도엽, 변화탐지 객체, 검수 이력, 데이터셋, Task)
            │
            ├──► Redis ──► Celery worker
            │              ↓ (모델 추론)
            │              ↓ TIFF/COG 읽기
            │              ↓ 결과 SHP/GeoJSON
            │              ↓ PostGIS INSERT
            │              ↑ (진행률 업데이트, Redis로)
            │
            └──► TiTiler ──► COG 파일들 (NAS 또는 로컬 디스크)
                              tiles/{z}/{x}/{y}.png
```

단일 사용자·단일 서버 시작 가정. 부하 늘면 분리.

---

## 3. 통합 단계 (Phase별)

### Phase α — 인프라 PoC (병렬, 프론트 Phase 2 진행 중)

목적: 안양 1매로 모든 인프라 요소를 한 번씩 동작시켜 보고 측정.

| 작업 | 산출물 | 검증 |
|---|---|---|
| α-1. 안양 도엽 1매 TIFF → COG 변환 | `anyang_2023.cog.tif` | 변환 시간·결과 파일 크기 측정 |
| α-2. TiTiler 로컬 컨테이너 띄움 | same-origin `/titiler/cog/tiles/{z}/{x}/{y}` | 개발 `서버IP:18210` 또는 배포 `배포PC_IP:18200` 경유로 시각 확인 |
| α-3. PostgreSQL+PostGIS 로컬 컨테이너 + 도엽 격자 SHP import | DB에서 `select count(*) from sheets;` 가능 | 도엽 격자 폴리곤 조회 정상 |
| α-4. 모델 추론 1매 측정 | 시간·GPU 점유율·메모리 사용량 기록 | 운영 부하 추정 가능 |
| α-5. Celery + Redis 최소 예제 (`add(a, b)` 큐 작업) | Hello World 큐 작업 결과 | 진행률 업데이트 패턴 검증 |

**Phase α 종료 조건**:
- 안양 1매가 TiTiler로 브라우저에서 보임
- 모델 추론 1매 시간 측정값 확보
- Celery로 큐 작업 보내고 진행률 받아오는 PoC 코드 1개

### Phase β — 백엔드 골조 + 읽기 API swap

목적: 프론트가 백엔드에서 데이터를 가져오기 시작. 검수 결과 저장은 아직 localStorage.

| 작업 | 산출물 |
|---|---|
| β-1. FastAPI 프로젝트 골조 + 디렉토리 구조 | `/health` 응답하는 FastAPI |
| β-2. Pydantic 모델 (`src/types/`와 1:1 매핑) | `MapSheetSchema`, `DetectionObjectSchema`, ... |
| β-3. SQLAlchemy 모델 + Alembic 마이그레이션 (초기 스키마) | DDL 생성, `alembic upgrade head` 통과 |
| β-4. 더미 도엽·객체 데이터 시드 스크립트 | 안양 1매 + 객체 100~150개 PostGIS 입력 |
| β-5. 읽기 API 5종 구현 | `listSheets`, `getSheet`, `listDetections`, `listDatasets`, `listHistory` |
| β-6. CORS 설정 (개발 환경) | 프론트 dev 서버에서 호출 가능 |
| β-7. 프론트 `lib/api.ts` **읽기 함수만 swap** | mock fetch → 실 API fetch. 쓰기 함수는 그대로 localStorage |

**Phase β 종료 조건**:
- `npm run dev` 후 백엔드 켜짐 상태에서 모든 화면이 백엔드 데이터로 동작
- 검수 결과 변경은 여전히 브라우저에만 (사용자 export 또는 정식 쓰기 API 대기)
- OpenAPI 문서가 `/docs`로 노출, 프론트 `lib/api.ts` 시그니처와 정합성 검증 가능

### Phase γ — 쓰기 API + 변화탐지 작업 큐

목적: localStorage 의존 제거 + 새로운 변화탐지 작업 등록·실행.

| 작업 | 산출물 |
|---|---|
| γ-1. 쓰기 API 5종 | `updateDetection`, `createDetection`, `softDeleteDetection`, `appendHistory`, `updateSheetStatus` |
| γ-2. 트랜잭션 처리 — 객체 변경 + 히스토리 동시 기록 | `lib/api.ts`의 `_mutateWithHistory` 패턴을 백엔드에서 단일 트랜잭션으로 |
| γ-3. Celery worker + Redis 정식 통합 | `celery -A app worker --loglevel=info` |
| γ-4. `POST /api/tasks` → Celery 큐 enqueue → task_id 반환 | 큐 등록 정상 |
| γ-5. `GET /api/tasks/:id/status` — state + 진행률 | 폴링으로 50% 같은 값 받음 |
| γ-6. Celery 안에서 모델 호출 → 결과 SHP → PostGIS INSERT | 안양 1매 추론 → DB에 100~150개 객체 적재 |
| γ-7. 프론트 `lib/api.ts` 전체 swap | 쓰기도 백엔드로. localStorage 백업 일부만 유지 (네트워크 끊김 대비) |
| γ-8. 위저드 등록 후 진행률 표시 UI | toast 또는 별도 진행 패널 |

**Phase γ 종료 조건**:
- 위저드에서 새 변화탐지 작업 등록 → Celery에서 추론 → 결과가 PostGIS에 적재되어 `/sheets`에 노출
- 검수 결과 변경이 백엔드에 영속화
- 1대 사용자 단일 추론 흐름이 끝까지 동작

### Phase δ — 운영 배포

| 작업 | 산출물 |
|---|---|
| δ-1. 도커 컴포즈 또는 systemd 단위 서비스 | 한 번에 띄우는 명령 1개 |
| δ-2. Nginx 설정 (정적 파일 + reverse proxy) | 도메인 또는 사내 IP로 접근 가능 |
| δ-3. PostgreSQL 백업 정책 | `pg_dump` cron + 별도 보관 |
| δ-4. 로그 수집 (FastAPI + Celery + Nginx) | 단일 디렉토리 또는 ELK 등 |
| δ-5. 운영 매뉴얼 (간단) | 시작·중지·트러블슈팅 |

---

## 4. 운영 환경 사양 (초안)

| 자원 | 사양 | 비고 |
|---|---|---|
| CPU | 8코어+ | FastAPI + Celery + PostGIS + TiTiler 동시 |
| RAM | 32GB+ | TIFF 메타·COG 캐시·PostGIS 인덱스 여유 |
| GPU | B200 1장 (별도 또는 공유) | Celery worker가 점유 |
| 디스크 | 영상용 별도 볼륨 (수 TB), 시스템 SSD 500GB+ | 영상 ≥300GB/매 누적 고려 |
| OS | Ubuntu 22.04 LTS 또는 CentOS Stream | |
| 네트워크 | 사내망 전용, 외부 차단 | |

---

## 5. 통합 시 위험 요소·완화

| 위험 | 영향 | 완화 |
|---|---|---|
| 모델 추론 시간 미측정 | 사용자 위저드 등록 후 막연한 대기, 진행률 안 보이면 답답함 | Phase α-4에서 측정, γ-5에서 진행률 표시 필수 |
| 300GB+ TIFF 변환 시간 | COG 변환 자체가 수십 분 가능 | 사전 일괄 변환·캐시 정책. 운영 전 모든 영상 변환 끝낼 것 |
| 좌표계 혼동 | 모델 출력 EPSG:5186, 프론트 EPSG:4326 | 백엔드 응답 직전 4326 변환 통일. 모델·DB는 5186 유지 |
| Celery 작업 실패 시 사용자 안내 | 위저드 후 작업이 사라짐 | task 상태 `FAILURE` 시 토스트 + 재시도 버튼 |
| 단일 서버 장애 | 전체 시스템 다운 | 백업·복구 절차 정립 (Phase δ-3) |
| 백엔드 swap 시 프론트 호환성 깨짐 | mock과 실 API 응답 형식 미세 차이 | OpenAPI 자동 생성된 타입을 프론트가 import 가능하게 검토 |

---

## 6. 결정 미정 (사용자 추후 확인 필요)

| 항목 | 누구에게 물어볼지 | 영향받는 Phase |
|---|---|---|
| 모델 추론 시간 (도엽 1매) | 모델 개발 담당자 또는 PoC 측정 | α-4 |
| 모델 호출 인터페이스 현황 | 모델 개발 담당자 (`python infer.py`인지, 함수 호출인지) | γ-6 |
| TIFF 원본 저장 위치 (NAS 경로 등) | 인프라 담당자 | α-1, α-2 |
| 백업·재해복구 정책 상세 | 사내 IT | δ-3 |
| 사내 SSO 또는 인증 표준 (추후 다중 사용자 시) | 사내 IT 보안 | 1차 출시 후 |

---

## 7. 통합 시 단일 진실 원천 유지 원칙

프론트엔드 작업과 통합 작업이 동시 진행되어도 다음 원칙을 지키면 충돌 최소화:

- 도메인 타입의 단일 진실 원천 = `src/types/`. 백엔드 Pydantic 모델은 본 타입을 카피·동기화.
- API 시그니처의 단일 진실 원천 = `BACKEND_API_SPEC.md` (또는 자동 생성 OpenAPI). 프론트 `lib/api.ts`와 백엔드 라우터가 모두 본 명세를 따름.
- 좌표계 진실 원천 = 백엔드 응답이 EPSG:4326. 프론트는 변환 안 함. 백엔드는 DB(5186)에서 응답 직전 변환.
- 권한 진실 원천 = 1차는 `lib/auth.ts` (클라이언트). 2차에서 백엔드로 이전 시 `lib/auth.ts`의 인터페이스는 유지하고 내부 구현만 swap.
