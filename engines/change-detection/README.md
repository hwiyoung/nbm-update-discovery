# engines/change-detection — 변화탐지 모델 호출 wrapper

이정표 5에서 채움. 본 디렉토리는 1차 출시 시점에:

- `Dockerfile` (실 모델 환경 또는 mock)
- `run.py` (모델 호출 인터페이스)
  - 입력: 정사영상 2장 경로 + 객체 카테고리 (building or road)
  - 출력: 변화 폴리곤 GeoJSON (EPSG:5186)

PoC 단계에서 실 모델 통합 시도, 막히면 즉시 mock 우회 (PROMPTS §5).
