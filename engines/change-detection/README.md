# engines/change-detection

이 디렉토리는 legacy mock compatibility 용도만 남긴다.

실제 변화탐지 엔진 소스는 `innopam-PM2022004-digital` submodule이 단일 원천이다.
Docker 런타임에서는 이 submodule을 `/engines/pm`에 read-only로 마운트하고,
`CHANGE_DETECTION_ALGORITHM_ROOT=/engines/pm` 기준으로 실행한다.

과거에 이 디렉토리 아래에 있던 `Road_CD`, `Building_CD` 복사본은 제거했다. 엔진 코드를
수정해야 할 때는 이 디렉토리가 아니라 `innopam-PM2022004-digital/02_Road_CD` 또는
`innopam-PM2022004-digital/04_Building_CD`를 수정한다.

`run.py`는 legacy mock 인터페이스 보존용이다. 기본 dev/prod compose에서는
`/engines/change-detection`를 마운트하지 않으므로 실제 알고리즘 실행 경로가 아니다.
