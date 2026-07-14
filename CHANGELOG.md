# Changelog

이 프로젝트의 주요 변경 사항을 기록한다. 버전은 [Semantic Versioning](https://semver.org/)을 따른다.

## [1.2.1] - 2026-07-14

### Added

- 완전 오프라인 서버용 애플리케이션·Docker 이미지 패키지 생성 스크립트를 추가했다.
- 별도 모델 패키지, manifest, SHA-256 생성과 오프라인 이미지 적재·설치·검증 절차를 추가했다.

### Changed

- 오프라인 설치는 이미지를 다시 빌드하지 않고 `docker load`와 `docker compose up --no-build`를 사용한다.
- 최초 설치는 DB·Redis 기동과 마이그레이션을 애플리케이션 시작보다 먼저 수행한다.

## [1.2.0] - 2026-07-14

첫 번째 정식 GitHub Release 기준 버전이다.

### Added

- 대시보드 지도에 프로젝트별 실제 처리영역 오버레이를 추가했다.
- 작업 API에 영상 중첩 범위를 나타내는 `processing_geometry`를 추가했다.
- 다중 과년도·당해년도 영상 처리와 서버 기반 SHP 내보내기를 지원한다.

### Changed

- 프로젝트 선택 시 실제 처리영역을 기준으로 지도가 이동하도록 개선했다.
- SHP 내보내기를 UTF-8 속성과 EPSG:5186 좌표계가 포함된 서버 생성 방식으로 전환했다.
- 장시간 변화탐지 작업의 Redis visibility timeout과 engine worker prefetch 설정을 보강했다.

### Release

- 운영 Docker 이미지와 `/health` 응답에 제품 버전을 노출한다.
