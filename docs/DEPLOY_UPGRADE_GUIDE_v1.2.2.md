# NBM Update Discovery v1.2.2 배포 PC 업데이트 설치 가이드

이 문서는 Ubuntu 배포 PC에 이미 설치되어 실행 중인 NBM Update Discovery `v1.2.0` 또는 `v1.2.1`을 오프라인 배포 패키지 `v1.2.2`로 안전하게 업데이트하는 절차를 설명한다.

초보 운영자도 순서대로 실행할 수 있도록 각 명령의 목적, 정상 결과, 중단해야 하는 조건, 실패 시 롤백 방법을 함께 적었다.

> **이 문서의 핵심 원칙**
>
> - 기존 `.env.prod`, PostgreSQL/Redis/스토리지 Docker volume과 외장 디스크 데이터는 유지한다.
> - 새 패키지는 기존 설치 폴더 위에 덮어쓰지 않고 별도 버전 폴더에 푼다.
> - 오프라인 패키지에 완성된 Docker 이미지가 들어 있으므로 `docker compose build`를 실행하지 않는다.
> - `docker compose down -v`는 DB volume을 삭제하므로 절대로 실행하지 않는다.
> - `v1.2.2` 전환이 확인될 때까지 기존 `v1.2.0` 또는 `v1.2.1` 폴더와 Docker 이미지를 삭제하지 않는다.

---

## 1. 이 문서에서 사용하는 기준 환경

| 항목 | 기준값 |
|---|---|
| 운영체제 | Ubuntu Linux x86_64/amd64 |
| 기존 버전 | `v1.2.0` 또는 `v1.2.1` |
| 업데이트 버전 | `v1.2.2` |
| 기존 설치 폴더 예시 | `/home/innopam/nbm-update-discovery_v1.2.1/install/nbm-update-discovery` |
| 새 설치 폴더 | `/home/innopam/nbm-update-discovery_v1.2.2/install/nbm-update-discovery` |
| Compose 프로젝트 | `nbm_update` |
| 웹 포트 | `18200` |
| 운영 데이터 루트 | `/media/innopam/Innopam_4TB` |
| PostgreSQL DB/사용자 | `nbm` / `nbm` |

다른 사용자 계정이나 다른 디스크 경로를 사용하는 PC에서는 `/home/innopam`과 `/media/innopam/Innopam_4TB`를 해당 PC의 실제 경로로 바꿔야 한다.

이 문서의 명령은 현재 배포 PC에 설치된 `v1.2.1` 폴더를 기준으로 작성했다. 현재 버전이 `v1.2.0`이면 기존 버전을 다루는 명령에서 다음 경로만 바꿔 사용한다.

```text
/home/innopam/nbm-update-discovery_v1.2.1
→ /home/innopam/nbm-update-discovery_v1.2.0
```

`v1.2.0`에서 `v1.2.2`로 바로 업데이트할 수 있으며, 중간에 `v1.2.1`을 먼저 설치할 필요는 없다. `v1.2.0`부터 `v1.2.2`까지 DB schema와 PM 모델 버전에는 변경이 없지만, 데이터 보호를 위해 이 문서의 백업·점검·검증 절차는 모두 동일하게 수행한다.

현재 로그인한 사용자와 홈 경로는 다음 명령으로 확인할 수 있다.

```bash
whoami
echo "$HOME"
```

---

## 2. 이전 버전 대비 v1.2.2 변경 사항

`v1.2.2`는 변화탐지 엔진이나 DB 구조를 바꾸는 버전이 아니라, 지원하지 않는 도로 변화 속성이 수동 편집 화면에 노출되던 문제를 수정한 프론트엔드 패치 버전이다.

### 2.1 버전별 변경 요약

| 버전 | 구분 | 주요 변경 내용 | 운영자에게 미치는 영향 |
|---|---|---|---|
| `v1.2.0` | 최초 정식 릴리스 | 대시보드 실제 처리영역 표시, `processing_geometry`, 다중 과년도·당해년도 영상 처리, 서버 기반 SHP 내보내기, 장시간 작업 설정, 제품 버전 표시 | 핵심 사용자 기능과 운영 스택의 기준 버전 |
| `v1.2.1` | 오프라인 배포 기능 추가 | 앱·Docker 이미지와 모델을 분리한 오프라인 패키지, manifest, SHA-256, 이미지 적재·설치·검증 스크립트 추가 | 인터넷 없이 검증된 이미지를 적재하고 설치할 수 있음 |
| `v1.2.2` | 프론트엔드 오류 예방 패치 | 도로 변화 객체의 수동 편집 목록에서 엔진이 지원하지 않는 `갱신` 옵션 제거 | 새 `road_updated` 값 생성을 막아 작업 상세 화면의 흰 화면 오류 경로를 차단 |

### 2.2 주요 기능 개선 5개 항목의 포함 여부

아래 기능은 `v1.2.2` 배포 패키지에 모두 포함되어 있다. 다만 Git 태그를 기준으로 보면 `v1.2.0` 이후에 추가된 변경이 아니라, 공식 `v1.2.0` 태그를 만들기 전에 이미 반영된 개선 사항이다. 따라서 `v1.2.0 대비 v1.2.2 신규 변경`으로 분류하지 않고, 배포 패키지에 포함된 주요 기능으로 구분한다.

| 번호 | 개선 항목 | 실제 적용 내용 | 공식 v1.2.0 | v1.2.1 | v1.2.2 |
|---:|---|---|:---:|:---:|:---:|
| 1 | 과년도·당해년도 분할 화면 가시성 확보 | 분할 화면의 왼쪽에는 과년도 영상 그룹, 오른쪽에는 당해년도 영상 그룹을 렌더링하고 두 지도의 이동·확대/축소를 동기화한다. 다중 영상도 각 그룹에 함께 표시한다. | 포함 | 포함 | 포함 |
| 2 | 과년도·당해년도 영상 바운더리 표시 | 과년도·당해년도 각 원본 영상의 footprint 외곽선과 실제 공통 처리영역 외곽선을 지도에 표시한다. | 포함 | 포함 | 포함 |
| 3 | SHP 데이터 인코딩 문제 해결 | 브라우저 생성 방식 대신 백엔드 Fiona/GDAL 방식으로 SHP ZIP을 생성한다. DBF 문자열을 UTF-8로 기록하고 `.cpg`를 포함하며 좌표계는 EPSG:5186으로 명시한다. | 포함 | 포함 | 포함 |
| 4 | 프로젝트 생성 시 다중 영상 처리 | 과년도와 당해년도에 각각 여러 영상을 선택할 수 있다. 서버가 선택 목록을 검증하고, 실행 시 각 그룹을 VRT로 결합해 변화탐지 입력으로 사용한다. | 포함 | 포함 | 포함 |
| 5 | 변화탐지 연속 처리 시 재실행 문제 해결 | 작업 실행 세대마다 새 Celery task ID를 부여하고, 완료된 작업의 중복 전달과 이전 실행의 stale delivery를 건너뛴다. 긴 작업에 맞춰 visibility timeout과 worker prefetch도 보강했다. | 포함 | 포함 | 포함 |

위 표의 `포함`은 해당 Git 태그의 코드에 기능이 들어 있다는 뜻이다. 실제 실행 화면에서 기능이 보이지 않는다면 폴더 이름만 `v1.2.0`인 상태일 수 있으므로, 실행 중인 이미지와 `/health`의 버전을 확인해야 한다.

```bash
cd /home/innopam/nbm-update-discovery_v1.2.1/install/nbm-update-discovery

curl -fsS http://127.0.0.1:18200/health

docker compose \
  -f docker-compose.prod.yml \
  --env-file .env.prod \
  images
```

> **배포 PC 확인 포인트:** 공식 `v1.2.0` 태그에는 위 다섯 항목이 이미 포함되어 있다. 기존 배포 PC에서 이 기능이 동작하지 않았다면 단순 버전 차이로 단정하지 말고, 오래된 Docker 이미지나 브라우저에 남은 프론트엔드 캐시를 함께 점검한다.

### 2.3 v1.2.0 대비 v1.2.2 누적 변경

`v1.2.0`에서 바로 업데이트하는 경우에는 `v1.2.1`과 `v1.2.2`의 변경 사항이 모두 적용된다.

| 구분 | v1.2.0 | v1.2.2 | 운영 영향 |
|---|---|---|---|
| 오프라인 배포 세트 | 표준 패키징 절차 없음 | 앱·Docker 이미지 패키지와 모델 패키지를 분리 제공 | 승인된 이동식 매체로 완전 오프라인 설치 가능 |
| 패키지 무결성 확인 | 표준 manifest/checksum 없음 | `PACKAGE_MANIFEST.json`, `SHA256SUMS`, `MODEL_SHA256SUMS` 제공 | 복사 중 손상과 잘못된 이미지·모델을 설치 전에 확인 가능 |
| Docker 이미지 준비 | 설치 PC에서 직접 build하는 절차 | 패키지 이미지를 `docker load`로 적재 | 오프라인 PC에서 외부 registry, pip, npm, GitHub에 접근할 필요 없음 |
| 설치 자동화 | Compose 기동, migration, seed를 수동 실행 | `install-offline.sh`가 이미지 확인, DB·Redis 선기동, migration, seed, 전체 기동, 검증을 순서대로 실행 | 초보 운영자의 명령 누락과 초기 DB 오류 가능성 감소 |
| 오프라인 검증 | 운영자가 각 항목을 개별 확인 | `verify-offline.sh`로 버전, 웹, Celery, GPU, 모델 확인 | 설치 직후 필수 항목을 일관되게 검증 |
| 도로 객체 수동 편집 | `신설`, `갱신`, `소멸` 표시 | `신설`, `소멸`만 표시 | 지원하지 않는 `road_updated` 신규 생성 방지 |
| 기존 `road_updated` 데이터 | 상세 화면에서 흰 화면 오류를 유발할 수 있음 | 자동 변환되지 않음 | 업데이트 전에 기존 행을 반드시 조회하고 정리 |
| 백엔드 기능/API | 기준 버전 | 동일 | 이번 업데이트로 인한 API 동작 변경 없음 |
| PostgreSQL schema/migration | 기준 schema | 동일 | 중간 버전 설치나 별도 데이터 변환 migration 불필요 |
| PM 변화탐지 모델 | `6015d9a64e3498b904b1fb2193ca5fdcdf85d487` | 동일 | 모델 결과 특성 변경 없음 |
| 운영 Compose 구성과 데이터 경로 | 기준 구성 | 동일 | 기존 named volume과 `HOST_*` 경로를 그대로 사용 |

> **중요:** `v1.2.2`의 UI 수정은 기존 DB 값을 자동으로 고치지 않는다. `v1.2.0` 또는 `v1.2.1`에서 이미 생성된 `road_updated` 행은 반드시 [6. 2단계: 기존 `road_updated` 데이터 점검](#6-2단계-기존-road_updated-데이터-점검)에 따라 먼저 정리한다.

### 2.4 v1.2.1 대비 v1.2.2 사용자 기능 변경

| 구분 | v1.2.1 | v1.2.2 | 운영 영향 |
|---|---|---|---|
| 도로 객체 수동 편집 옵션 | `신설`, `갱신`, `소멸` 표시 | `신설`, `소멸`만 표시 | 엔진이 지원하지 않는 도로 `갱신` 선택 방지 |
| `road_updated` 신규 생성 가능성 | 수동 편집으로 생성 가능 | 수동 편집 UI에서 생성 불가 | 신규 흰 화면 오류 발생 경로 차단 |
| 기존 `road_updated` DB 행 처리 | 상세 화면 통계 집계 중 오류 가능 | 기존 행을 자동 변환하지는 않음 | 업데이트 전에 기존 행을 반드시 점검해야 함 |
| 건물 변화 편집 | `신축`, `갱신`, `소멸` | 동일 | 변경 없음 |
| 도로 `신설`, `소멸` 편집 | 지원 | 동일 | 변경 없음 |

### 2.5 v1.2.1 대비 v1.2.2 배포 구성 변경

| 구성 요소 | v1.2.1 | v1.2.2 | 실제 변경 여부 |
|---|---|---|---|
| Git 태그 | `v1.2.1` | `v1.2.2` | 변경 |
| Git commit | `8ddca2bd1b5e0886ec953c5f4196ce594351746f` | `6f79ccf6298ee4879b52b1aa945abf0ee8520c9c` | 변경 |
| 프론트엔드 이미지 | `sha256:efee9478...` | `sha256:b7a0df29...` | 변경 |
| 백엔드 이미지 내용 ID | `sha256:2cd7de26...` | `sha256:2cd7de26...` | 변경 없음, 버전 태그만 `1.2.2` |
| GPU 엔진 워커 이미지 내용 ID | `sha256:19cf358b...` | `sha256:19cf358b...` | 변경 없음, 버전 태그만 `1.2.2` |
| PM 모델 commit | `6015d9a64e3498b904b1fb2193ca5fdcdf85d487` | 동일 | 변경 없음 |
| PostgreSQL schema/migration | 기존 schema | 동일 | 변경 없음 |
| 운영 데이터 경로 | 기존 `HOST_*` 경로 | 그대로 유지 | 변경 없음 |
| 웹 포트 | `18200` | `18200` | 변경 없음 |

### 2.6 이번 업데이트에서 보존되는 데이터

다음 항목은 업데이트 후에도 그대로 유지되어야 한다.

- 기존 프로젝트와 작업 목록
- 기존 폴리곤과 검토 이력
- PostgreSQL DB
- Redis 및 애플리케이션 named volume
- 정사영상
- 변화탐지 결과와 SHP/DXF/PDF 산출물
- DEM
- VWorld 오프라인 타일
- DB 비밀번호, JWT secret, 애플리케이션 secret

---

## 3. 전체 업데이트 순서

업데이트는 다음 순서로 진행한다.

1. 현재 스택과 서버 요구사항 확인
2. 실행 중인 변화탐지 작업이 없는지 확인
3. 기존 `road_updated` 데이터 점검 및 정리
4. `v1.2.2` 패키지 checksum 확인
5. 앱/이미지 압축과 모델 압축을 새 폴더에 함께 해제
6. 기존 DB와 `.env.prod` 백업
7. 기존 `.env.prod`를 새 폴더로 복사하고 버전만 `1.2.2`로 변경
8. 기존 서비스가 실행 중인 상태에서 `v1.2.2` Docker 이미지 선적재
9. `v1.2.1` 컨테이너 중지
10. 기존 volume을 그대로 연결해 `v1.2.2` 기동
11. API, DB, GPU, 모델, 데이터 경로, 브라우저 기능 검증
12. 문제가 있으면 `v1.2.1`로 롤백

---

## 4. 업데이트 전에 절대 하지 말아야 할 작업

### 4.1 `down -v` 실행 금지

다음 명령은 PostgreSQL을 포함한 named volume을 삭제할 수 있다.

```bash
# 절대 실행 금지
docker compose -f docker-compose.prod.yml --env-file .env.prod down -v
```

서비스를 내릴 때는 반드시 `-v` 없는 일반 `down`을 사용한다.

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod down
```

### 4.2 오프라인 배포 PC에서 이미지 build 금지

다음 명령은 실행하지 않는다.

```bash
# 오프라인 업데이트에서는 실행 금지
docker compose -f docker-compose.prod.yml --env-file .env.prod build
```

`v1.2.2` 패키지에는 이미 빌드된 이미지가 들어 있다. `scripts/load-images.sh`로 이미지를 적재하고 `--no-build` 방식으로 실행해야 한다.

### 4.3 기존 폴더 위에 새 압축 덮어풀기 금지

다음과 같이 버전별 폴더를 분리한다.

```text
/home/innopam/
├── nbm-update-discovery_v1.2.1/
│   └── install/nbm-update-discovery/
└── nbm-update-discovery_v1.2.2/
    └── install/nbm-update-discovery/
```

이 구조를 유지하면 문제가 생겼을 때 기존 폴더에서 `v1.2.1`을 즉시 다시 실행할 수 있다.

---

## 5. 1단계: 기존 v1.2.1 상태 확인

기존 설치 폴더로 이동한다.

```bash
cd /home/innopam/nbm-update-discovery_v1.2.1/install/nbm-update-discovery
```

현재 폴더가 맞는지 확인한다.

```bash
pwd
cat VERSION
```

정상 예시:

```text
/home/innopam/nbm-update-discovery_v1.2.1/install/nbm-update-discovery
1.2.1
```

### 5.1 컨테이너 상태 확인

```bash
docker compose \
  -f docker-compose.prod.yml \
  --env-file .env.prod \
  ps
```

다음 주요 서비스가 실행 중이어야 한다.

- `frontend`
- `backend`
- `postgres`
- `redis`
- `celery-worker`
- `celery-engine-worker`
- `titiler`
- `titiler-cache`

### 5.2 현재 버전 확인

```bash
curl -fsS http://localhost:18200/health | python3 -m json.tool
```

업데이트 전에는 응답의 `version`이 `1.2.1`이어야 한다.

```json
{
  "version": "1.2.1"
}
```

### 5.3 Docker, Compose, GPU 확인

```bash
uname -m
docker --version
docker compose version
nvidia-smi
```

확인 기준:

| 항목 | 정상 기준 |
|---|---|
| CPU architecture | `x86_64` |
| Docker | 명령 실행 성공 |
| Docker Compose | `v2.30.0` 이상 |
| NVIDIA GPU | GPU 목록 정상 출력 |

Compose가 `v2.30.0` 미만이면 업데이트를 중단하고 Compose plugin부터 업데이트한다.

### 5.4 외장 디스크 마운트 확인

```bash
findmnt /media/innopam/Innopam_4TB
```

그리고 기존 데이터 폴더가 모두 존재하는지 확인한다.

```bash
ls -ld \
  /media/innopam/Innopam_4TB/orthomosaic \
  /media/innopam/Innopam_4TB/exports \
  /media/innopam/Innopam_4TB/dem \
  /media/innopam/Innopam_4TB/vworld_tiles
```

외장 디스크가 마운트되지 않았거나 경로가 없다면 업데이트를 중단한다. 마운트되지 않은 상태에서 같은 이름의 빈 폴더를 새로 만들면 실제 외장 디스크가 아닌 OS 디스크에 데이터가 기록될 수 있다.

### 5.5 실행 중인 변화탐지 작업 확인

업데이트 중에는 모든 컨테이너를 잠시 중지하므로, UI에서 실행 중인 변화탐지 작업이 없는지 확인한다.

GPU 워커의 현재 작업도 확인할 수 있다.

```bash
docker compose \
  -f docker-compose.prod.yml \
  --env-file .env.prod \
  exec -T celery-engine-worker \
  celery -A app.workers.celery_app.celery_app inspect active --timeout 8
```

실행 중인 task가 표시되면 작업 완료 후 업데이트한다. 긴급 중단이 아닌 이상 추론 중에 컨테이너를 내리지 않는다.

---

## 6. 2단계: 기존 `road_updated` 데이터 점검

`v1.2.2`는 도로 수동 편집 화면에서 `갱신` 선택지를 제거한다. 하지만 기존 DB에 이미 저장된 `road_updated` 행을 자동 변환하지는 않는다.

기존 행이 남아 있으면 프로젝트 상세 화면을 열 때 통계 집계 오류로 흰 화면이 나타날 수 있으므로, 업데이트 전에 반드시 0건인지 확인한다.

### 6.1 기존 행 조회

```bash
docker compose \
  -f docker-compose.prod.yml \
  --env-file .env.prod \
  exec -T postgres \
  psql -U nbm -d nbm -c "
SELECT
  id,
  task_id,
  sheet_code,
  model,
  change_type,
  is_user_added
FROM detections
WHERE change_type = 'road_updated';
"
```

정상 게이트:

```text
(0 rows)
```

`0 rows`이면 바로 7단계로 진행한다.

### 6.2 행이 발견된 경우

행이 발견되면 무조건 일괄 변경하지 않는다. 해당 객체가 실제로 `도로 신설`인지 `도로 소멸`인지 운영 담당자가 확인해야 한다.

변경 이력을 조회하면 직전 속성을 확인할 수 있다.

```bash
docker compose \
  -f docker-compose.prod.yml \
  --env-file .env.prod \
  exec -T postgres \
  psql -U nbm -d nbm -c "
SELECT
  object_id,
  before->>'model' AS previous_model,
  before->>'change_type' AS previous_change_type,
  after->>'model' AS current_model,
  after->>'change_type' AS current_change_type,
  reviewed_at
FROM review_histories
WHERE object_id = '<조회된 객체 ID>'
ORDER BY reviewed_at DESC
LIMIT 10;
"
```

`<조회된 객체 ID>`를 실제 ID로 바꾼다.

예를 들어 변경 전 값이 `road_new`였다면 다음 API로 속성만 되돌린다.

```bash
curl -fsS -X PATCH \
  "http://localhost:18200/api/v1/detections/<객체 ID>?task_id=<작업 ID>" \
  -H "Content-Type: application/json" \
  --data '{"model":"road","change_type":"road_new"}' \
  | python3 -m json.tool
```

도로 소멸 객체로 확인됐다면 `change_type`을 `road_removed`로 사용한다.

```json
{
  "model": "road",
  "change_type": "road_removed"
}
```

API 응답에서 객체 ID와 변경된 `change_type`을 확인한 후 6.1 조회를 다시 실행한다.

> **중단 조건:** `road_updated`가 1건이라도 남아 있으면 업데이트를 진행하지 않는다.

---

## 7. 3단계: v1.2.2 배포 파일 준비

배포 PC의 다음 폴더에 `v1.2.2` 파일 네 개를 준비한다.

```text
/home/innopam/nbm-update-discovery_v1.2.2/
├── PACKAGE_MANIFEST.json
├── SHA256SUMS
├── nbm-update-discovery-app-images-v1.2.2-linux-amd64.tar.gz
└── nbm-update-discovery-models-pm-6015d9a6-linux-amd64.tar.gz
```

필요한 파일:

| 파일 | 역할 |
|---|---|
| `nbm-update-discovery-app-images-v1.2.2-linux-amd64.tar.gz` | 애플리케이션 소스, Compose 설정, 설치 스크립트, Docker 이미지 |
| `nbm-update-discovery-models-pm-6015d9a6-linux-amd64.tar.gz` | 실제 도로·건물 모델 가중치 |
| `PACKAGE_MANIFEST.json` | 버전, commit, 플랫폼, 이미지 ID |
| `SHA256SUMS` | 전송 중 파일 손상 여부 확인 |

### 7.1 디스크 여유 공간 확인

```bash
df -h /home/innopam
docker system df
```

압축 파일, 해제된 패키지, Docker 이미지가 동시에 존재하므로 최소 50GB 이상의 여유 공간을 권장한다.

### 7.2 외부 checksum 확인

```bash
cd /home/innopam/nbm-update-discovery_v1.2.2
sha256sum -c SHA256SUMS
```

정상 결과:

```text
nbm-update-discovery-app-images-v1.2.2-linux-amd64.tar.gz: OK
nbm-update-discovery-models-pm-6015d9a6-linux-amd64.tar.gz: OK
PACKAGE_MANIFEST.json: OK
```

하나라도 `FAILED`가 나오면 압축을 풀지 말고 파일을 다시 복사한다.

---

## 8. 4단계: v1.2.2 압축 해제

앱/이미지 압축과 모델 압축은 각각 다른 폴더에 풀면 안 된다. 두 압축 모두 같은 `install` 폴더에 순서대로 풀어야 한다.

```bash
cd /home/innopam/nbm-update-discovery_v1.2.2
mkdir -p install
```

먼저 앱/이미지 압축을 푼다.

```bash
tar -xzf \
  nbm-update-discovery-app-images-v1.2.2-linux-amd64.tar.gz \
  -C install
```

같은 폴더에 모델 압축을 이어서 푼다.

```bash
tar -xzf \
  nbm-update-discovery-models-pm-6015d9a6-linux-amd64.tar.gz \
  -C install
```

정상 구조:

```text
/home/innopam/nbm-update-discovery_v1.2.2/
└── install/
    └── nbm-update-discovery/
        ├── VERSION
        ├── PACKAGE_MANIFEST.json
        ├── MODEL_SHA256SUMS
        ├── docker-compose.prod.yml
        ├── .env.prod.example
        ├── images/
        │   ├── docker-images.tar
        │   └── IMAGES.txt
        ├── scripts/
        │   ├── load-images.sh
        │   ├── install-offline.sh
        │   └── verify-offline.sh
        └── innopam-PM2022004-digital/
```

버전을 확인한다.

```bash
cd /home/innopam/nbm-update-discovery_v1.2.2/install/nbm-update-discovery
cat VERSION
```

정상 결과:

```text
1.2.2
```

모델 checksum을 확인한다.

```bash
sha256sum -c MODEL_SHA256SUMS
```

모든 모델 파일이 `OK`여야 한다.

---

## 9. 5단계: 기존 설정과 DB 백업

이 단계는 기존 `v1.2.1` 서비스가 실행 중인 상태에서 진행한다.

### 9.1 백업 폴더 생성

```bash
mkdir -p /home/innopam/nbm-backups
```

### 9.2 `.env.prod` 백업

```bash
cp \
  /home/innopam/nbm-update-discovery_v1.2.1/install/nbm-update-discovery/.env.prod \
  /home/innopam/nbm-backups/env.prod-v1.2.1-before-v1.2.2

chmod 600 /home/innopam/nbm-backups/env.prod-v1.2.1-before-v1.2.2
```

백업 파일이 존재하는지 확인한다.

```bash
ls -lh /home/innopam/nbm-backups/env.prod-v1.2.1-before-v1.2.2
```

`.env.prod`에는 비밀번호와 secret이 들어 있으므로 외부 공유 저장소에 올리지 않는다.

### 9.3 PostgreSQL 논리 백업

```bash
cd /home/innopam/nbm-update-discovery_v1.2.1/install/nbm-update-discovery

docker compose \
  -f docker-compose.prod.yml \
  --env-file .env.prod \
  exec -T postgres \
  pg_dump -U nbm -d nbm -Fc \
  > /home/innopam/nbm-backups/nbm-v1.2.1-before-v1.2.2.dump
```

백업 파일이 비어 있지 않은지 확인한다.

```bash
test -s /home/innopam/nbm-backups/nbm-v1.2.1-before-v1.2.2.dump \
  && echo "DB backup OK" \
  || echo "DB backup FAILED"
```

반드시 다음이 나와야 한다.

```text
DB backup OK
```

백업 파일 크기도 확인한다.

```bash
ls -lh /home/innopam/nbm-backups/nbm-v1.2.1-before-v1.2.2.dump
```

### 9.4 기존 Docker volume 기록

```bash
docker volume ls --filter name=nbm_update
```

일반적으로 다음 volume이 보인다.

- `nbm_update_postgres-data`
- `nbm_update_redis-data`
- `nbm_update_storage-data`
- `nbm_update_titiler-cache-data`

이 volume 이름은 업데이트 후에도 동일해야 한다.

---

## 10. 6단계: 기존 `.env.prod`를 v1.2.2로 복사

업그레이드에서는 새 비밀번호나 secret을 만들지 않는다. 기존 설정을 그대로 복사하고 `APP_VERSION`만 바꾼다.

```bash
cp \
  /home/innopam/nbm-update-discovery_v1.2.1/install/nbm-update-discovery/.env.prod \
  /home/innopam/nbm-update-discovery_v1.2.2/install/nbm-update-discovery/.env.prod
```

버전을 `1.2.2`로 변경한다.

```bash
sed -i \
  's/^APP_VERSION=.*/APP_VERSION=1.2.2/' \
  /home/innopam/nbm-update-discovery_v1.2.2/install/nbm-update-discovery/.env.prod
```

권한을 제한한다.

```bash
chmod 600 /home/innopam/nbm-update-discovery_v1.2.2/install/nbm-update-discovery/.env.prod
```

설정값을 확인한다. 비밀번호와 secret 값은 화면 공유나 문서에 복사하지 않는다.

```bash
grep -E \
  '^(COMPOSE_PROJECT_NAME|APP_VERSION|HOST_BIND|NBM_WEB_PORT|HOST_.*_DIR)=' \
  /home/innopam/nbm-update-discovery_v1.2.2/install/nbm-update-discovery/.env.prod
```

정상 예시:

```env
COMPOSE_PROJECT_NAME=nbm_update
APP_VERSION=1.2.2
HOST_BIND=0.0.0.0
NBM_WEB_PORT=18200
HOST_ORTHOMOSAIC_DIR=/media/innopam/Innopam_4TB/orthomosaic
HOST_EXPORT_OUTPUT_DIR=/media/innopam/Innopam_4TB/exports
HOST_DEM_DIR=/media/innopam/Innopam_4TB/dem
HOST_VWORLD_TILES_DIR=/media/innopam/Innopam_4TB/vworld_tiles
```

설정 문법을 검증한다.

```bash
cd /home/innopam/nbm-update-discovery_v1.2.2/install/nbm-update-discovery

docker compose \
  -f docker-compose.prod.yml \
  --env-file .env.prod \
  config --quiet
```

아무 메시지 없이 프롬프트로 돌아오면 정상이다.

---

## 11. 7단계: v1.2.2 이미지 선적재

서비스 중단 시간을 줄이기 위해 기존 `v1.2.1`이 실행 중일 때 새 이미지를 먼저 Docker에 적재한다.

```bash
cd /home/innopam/nbm-update-discovery_v1.2.2/install/nbm-update-discovery
chmod +x scripts/*.sh
scripts/load-images.sh
```

이미지 적재에는 시간이 걸릴 수 있다. 터미널을 닫거나 `Ctrl+C`로 중단하지 않는다.

마지막에 다음 이미지들이 `loaded:`로 확인되어야 한다.

```text
loaded: nbm-update-discovery-backend-prod:1.2.2
loaded: nbm-update-discovery-celery-engine-worker-prod:1.2.2
loaded: nbm-update-discovery-frontend-prod:1.2.2
loaded: postgis/postgis:15-3.4
loaded: redis:7-alpine
loaded: ghcr.io/developmentseed/titiler:0.22.0
loaded: nginx:alpine
```

주요 `1.2.2` 이미지 태그를 다시 확인한다.

```bash
docker image inspect nbm-update-discovery-backend-prod:1.2.2 >/dev/null \
  && echo "backend image OK"

docker image inspect nbm-update-discovery-celery-engine-worker-prod:1.2.2 >/dev/null \
  && echo "engine image OK"

docker image inspect nbm-update-discovery-frontend-prod:1.2.2 >/dev/null \
  && echo "frontend image OK"
```

세 항목 모두 `OK`여야 한다.

---

## 12. 8단계: v1.2.1 중지

이 단계부터 웹 서비스가 잠시 중단된다.

기존 설치 폴더에서 실행한다.

```bash
cd /home/innopam/nbm-update-discovery_v1.2.1/install/nbm-update-discovery

docker compose \
  -f docker-compose.prod.yml \
  --env-file .env.prod \
  down
```

다시 강조하지만 `down -v`를 사용하지 않는다.

컨테이너가 내려갔는지 확인한다.

```bash
docker ps --filter name=nbm_update
```

컨테이너 목록이 비어 있어야 한다. named volume은 삭제되지 않았으므로 다음 명령에는 계속 표시되어야 한다.

```bash
docker volume ls --filter name=nbm_update
```

---

## 13. 9단계: v1.2.2 기동

새 설치 폴더로 이동한다.

```bash
cd /home/innopam/nbm-update-discovery_v1.2.2/install/nbm-update-discovery
```

마지막으로 버전과 설정을 확인한다.

```bash
cat VERSION
grep '^APP_VERSION=' .env.prod
```

두 값 모두 `1.2.2`여야 한다.

```text
1.2.2
APP_VERSION=1.2.2
```

이미지는 11단계에서 적재했고 기존 DB에는 seed가 있으므로 다음 명령을 실행한다.

```bash
scripts/install-offline.sh --skip-load --skip-seed
```

이 스크립트는 다음 작업을 자동으로 수행한다.

1. 모델 파일 존재 여부 및 checksum 확인
2. Compose 설정 검증
3. 기존 `nbm_update_postgres-data`, `nbm_update_redis-data` volume으로 DB/Redis 기동
4. Alembic DB migration 실행
5. 기존 seed 재실행 생략
6. 전체 `v1.2.2` 서비스 기동
7. 웹 `/health` 확인
8. Celery worker ping 확인
9. GPU와 모델 파일 확인

정상 완료 시 마지막에 다음 메시지가 나온다.

```text
offline verification passed: version=1.2.2 url=http://127.0.0.1:18200/
```

---

## 14. 10단계: 업데이트 결과 검증

### 14.1 컨테이너 상태

```bash
docker compose \
  -f docker-compose.prod.yml \
  --env-file .env.prod \
  ps
```

주요 서비스가 `Up` 또는 `healthy` 상태여야 한다.

### 14.2 API 버전

```bash
curl -fsS http://localhost:18200/health | python3 -m json.tool
```

응답의 `version`이 반드시 `1.2.2`여야 한다.

```json
{
  "version": "1.2.2"
}
```

### 14.3 Celery worker

```bash
docker compose \
  -f docker-compose.prod.yml \
  --env-file .env.prod \
  exec -T celery-worker \
  celery -A app.workers.celery_app.celery_app inspect ping --timeout 8
```

`pong` 응답이 나와야 한다.

### 14.4 GPU

```bash
docker compose \
  -f docker-compose.prod.yml \
  --env-file .env.prod \
  exec celery-engine-worker nvidia-smi -L
```

배포 PC의 NVIDIA GPU 목록이 출력되어야 한다.

### 14.5 모델 파일

```bash
docker compose \
  -f docker-compose.prod.yml \
  --env-file .env.prod \
  exec celery-engine-worker \
  sh -lc 'test -s /engines/pm/02_Road_CD/workspace/model/best_road.pth && echo road-ok'

docker compose \
  -f docker-compose.prod.yml \
  --env-file .env.prod \
  exec celery-engine-worker \
  sh -lc 'test -s /engines/pm/04_Building_CD/workspace/model/best_building.pth && echo building-ok'
```

정상 결과:

```text
road-ok
building-ok
```

### 14.6 운영 데이터 마운트

```bash
docker compose \
  -f docker-compose.prod.yml \
  --env-file .env.prod \
  exec backend \
  sh -lc 'python - <<PY
from pathlib import Path
for p in ["/data/orthomosaic", "/data/storage/exports", "/data/dem"]:
    x = Path(p)
    print(p, "exists=", x.exists(), "items=", len(list(x.glob("*"))) if x.exists() else "-")
PY'
```

각 경로의 `exists=True`를 확인한다.

### 14.7 기존 DB 데이터 확인

```bash
docker compose \
  -f docker-compose.prod.yml \
  --env-file .env.prod \
  exec -T postgres \
  psql -U nbm -d nbm -c "
SELECT
  (SELECT count(*) FROM tasks) AS tasks,
  (SELECT count(*) FROM datasets) AS datasets,
  (SELECT count(*) FROM detections) AS detections;
"
```

업데이트 전 기존 프로젝트와 폴리곤 데이터가 유지되어야 한다.

### 14.8 브라우저 확인

배포 PC에서:

```text
http://localhost:18200/#/
```

내부망 PC에서:

```text
http://192.168.10.201:18200/#/
```

브라우저가 이전 프론트 파일을 캐시했을 수 있으므로 한 번 강력 새로고침한다.

```text
Chrome/Edge: Ctrl+Shift+R
Firefox: Ctrl+F5
```

브라우저 점검 목록:

1. 대시보드가 흰 화면 없이 열린다.
2. 기존 프로젝트 목록이 보인다.
3. 기존 프로젝트 상세 화면이 열린다.
4. 기존 폴리곤이 지도에 보인다.
5. 폴리곤 편집 화면에서 도로 변화 옵션은 `신설`, `소멸`만 표시된다.
6. 건물 변화 옵션은 `신축`, `갱신`, `소멸`이 표시된다.
7. 기존 정사영상 타일이 표시된다.
8. 최근 결과와 처리 이력이 유지된다.

---

## 15. 업데이트 성공 판정

다음 항목을 모두 만족하면 업데이트 성공으로 본다.

- [ ] `sha256sum -c SHA256SUMS`가 모두 `OK`
- [ ] `sha256sum -c MODEL_SHA256SUMS`가 모두 `OK`
- [ ] 업데이트 전 `road_updated` 조회 결과가 `0 rows`
- [ ] `.env.prod`의 `APP_VERSION=1.2.2`
- [ ] 기존 DB 비밀번호와 secret 유지
- [ ] `down -v`를 실행하지 않음
- [ ] `scripts/install-offline.sh --skip-load --skip-seed` 성공
- [ ] `/health` 응답 버전이 `1.2.2`
- [ ] PostgreSQL/Redis/backend/frontend 정상
- [ ] Celery worker가 `pong` 응답
- [ ] GPU 목록 출력
- [ ] `road-ok`, `building-ok`
- [ ] 기존 프로젝트와 폴리곤 유지
- [ ] 도로 수동 편집에 `갱신` 옵션이 없음
- [ ] 프로젝트 상세 화면에 흰 화면 오류가 없음

업데이트 직후 실제 프로젝트 하나를 열어 조회·편집·저장까지 확인하는 것을 권장한다.

---

## 16. 실패 시 v1.2.1 롤백

`v1.2.2`가 정상 기동하지 않거나 브라우저 기능에 문제가 있으면 다음 순서로 롤백한다.

### 16.1 v1.2.2 중지

```bash
cd /home/innopam/nbm-update-discovery_v1.2.2/install/nbm-update-discovery

docker compose \
  -f docker-compose.prod.yml \
  --env-file .env.prod \
  down
```

`down -v`는 사용하지 않는다.

### 16.2 v1.2.1 재기동

```bash
cd /home/innopam/nbm-update-discovery_v1.2.1/install/nbm-update-discovery

docker compose \
  -f docker-compose.prod.yml \
  --env-file .env.prod \
  up -d --no-build --wait
```

### 16.3 롤백 확인

```bash
curl -fsS http://localhost:18200/health | python3 -m json.tool
```

응답 버전이 다시 `1.2.1`인지 확인한다.

```bash
docker compose \
  -f docker-compose.prod.yml \
  --env-file .env.prod \
  ps
```

`v1.2.2`는 DB schema 변경이 없는 프론트 패치 버전이므로, 이 업데이트 범위에서는 기존 `v1.2.1` 컨테이너를 같은 volume에 다시 연결하는 방식으로 롤백할 수 있다.

---

## 17. 자주 발생하는 오류와 해결 방법

### 17.1 `Additional property gpus is not allowed`

원인: Docker Compose가 `gpus: all`을 지원하지 않는 구버전이다.

확인:

```bash
docker compose version
```

해결: Docker Compose plugin을 `v2.30.0` 이상으로 업데이트한다. Compose 파일에서 `gpus: all`을 임의로 삭제하지 않는다.

### 17.2 `APP_VERSION=1.2.1 does not match VERSION=1.2.2`

원인: 기존 `.env.prod`를 복사한 뒤 버전을 바꾸지 않았다.

해결:

```bash
sed -i \
  's/^APP_VERSION=.*/APP_VERSION=1.2.2/' \
  /home/innopam/nbm-update-discovery_v1.2.2/install/nbm-update-discovery/.env.prod
```

### 17.3 `bind source path does not exist`

원인: `.env.prod`의 `HOST_*` 경로가 없거나 외장 디스크가 마운트되지 않았다.

확인:

```bash
findmnt /media/innopam/Innopam_4TB

grep -E '^HOST_.*_DIR=' \
  /home/innopam/nbm-update-discovery_v1.2.2/install/nbm-update-discovery/.env.prod
```

해결: 외장 디스크를 먼저 정확한 경로로 마운트하고 실제 폴더의 대소문자와 `.env.prod`를 일치시킨다.

### 17.4 모델 파일이 없거나 0바이트

원인: 앱 압축만 풀었거나 앱/모델 압축을 서로 다른 폴더에 풀었다.

해결: 두 압축을 같은 `install` 폴더에 앱 먼저, 모델 나중 순서로 다시 푼다.

```bash
tar -xzf nbm-update-discovery-app-images-v1.2.2-linux-amd64.tar.gz -C install
tar -xzf nbm-update-discovery-models-pm-6015d9a6-linux-amd64.tar.gz -C install
```

### 17.5 `/health`가 여전히 `1.2.1`

확인:

```bash
grep '^APP_VERSION=' .env.prod

docker compose \
  -f docker-compose.prod.yml \
  --env-file .env.prod \
  ps

docker inspect nbm_update-backend-1 \
  --format '{{.Config.Image}}'
```

정상 이미지:

```text
nbm-update-discovery-backend-prod:1.2.2
```

이전 컨테이너가 남아 있다면 일반 `down` 후 13단계를 다시 실행한다.

### 17.6 프로젝트 상세 화면이 계속 흰 화면

브라우저 콘솔에 다음과 유사한 오류가 있는지 확인한다.

```text
TypeError: can't access property "total"
```

DB에 `road_updated`가 남아 있는지 다시 조회한다.

```bash
docker compose \
  -f docker-compose.prod.yml \
  --env-file .env.prod \
  exec -T postgres \
  psql -U nbm -d nbm -c "
SELECT id, task_id, model, change_type
FROM detections
WHERE change_type = 'road_updated';
"
```

행이 발견되면 6단계에 따라 실제 의미를 확인한 뒤 `road_new` 또는 `road_removed`로 정리한다.

### 17.7 이미지가 다시 다운로드되거나 build를 시도함

오프라인 패키지에서는 다음 순서를 사용해야 한다.

```bash
scripts/load-images.sh
scripts/install-offline.sh --skip-load --skip-seed
```

직접 기동할 때도 반드시 `--no-build`를 사용한다.

```bash
docker compose \
  -f docker-compose.prod.yml \
  --env-file .env.prod \
  up -d --no-build --wait
```

---

## 18. 업데이트 후 보관 및 정리

업데이트 직후에는 다음 항목을 유지한다.

- `/home/innopam/nbm-update-discovery_v1.2.1`
- `nbm-update-discovery-frontend-prod:1.2.1`
- `nbm-update-discovery-backend-prod:1.2.1`
- `nbm-update-discovery-celery-engine-worker-prod:1.2.1`
- `/home/innopam/nbm-backups/env.prod-v1.2.1-before-v1.2.2`
- `/home/innopam/nbm-backups/nbm-v1.2.1-before-v1.2.2.dump`

운영 검증이 충분히 끝나고 별도 승인된 후에만 이전 압축 해제 폴더와 오래된 이미지를 정리한다. DB volume과 `/media/innopam/Innopam_4TB` 운영 데이터는 버전 정리 대상이 아니다.

---

## 19. 운영 명령 요약

모든 명령은 새 설치 폴더에서 실행한다.

```bash
cd /home/innopam/nbm-update-discovery_v1.2.2/install/nbm-update-discovery
```

상태 확인:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod ps
```

전체 로그:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod logs -f
```

GPU 워커 로그:

```bash
docker compose \
  -f docker-compose.prod.yml \
  --env-file .env.prod \
  logs -f celery-engine-worker
```

서비스 중지:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.prod down
```

서비스 재기동:

```bash
docker compose \
  -f docker-compose.prod.yml \
  --env-file .env.prod \
  up -d --no-build --wait
```

오프라인 검증 재실행:

```bash
scripts/verify-offline.sh
```

---

## 20. 최종 요약

`v1.2.1`에서 `v1.2.2`로 업데이트할 때 가장 중요한 것은 다음 네 가지다.

1. 기존 `road_updated` 데이터가 0건인지 먼저 확인한다.
2. 기존 `.env.prod`와 Docker volume을 유지한다.
3. 새 이미지를 `scripts/load-images.sh`로 적재하고 build하지 않는다.
4. `down -v`를 절대 실행하지 않는다.

정상 업데이트 명령의 핵심 흐름은 다음과 같다.

```bash
# 새 이미지 선적재
cd /home/innopam/nbm-update-discovery_v1.2.2/install/nbm-update-discovery
scripts/load-images.sh

# 기존 컨테이너만 중지
cd /home/innopam/nbm-update-discovery_v1.2.1/install/nbm-update-discovery
docker compose -f docker-compose.prod.yml --env-file .env.prod down

# 기존 volume으로 새 버전 기동
cd /home/innopam/nbm-update-discovery_v1.2.2/install/nbm-update-discovery
scripts/install-offline.sh --skip-load --skip-seed
```

마지막 성공 표시는 다음 메시지다.

```text
offline verification passed: version=1.2.2 url=http://127.0.0.1:18200/
```
