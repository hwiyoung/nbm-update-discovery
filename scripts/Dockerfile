# ============================================================
# scripts/Dockerfile — 일회성 작업용 (더미 데이터 생성, 시드, 변환)
# 평소 기동되지 않음. compose profile "tools" 로만 실행.
#   docker compose --profile tools run --rm scripts <command>
# ============================================================
FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

# GDAL / PROJ 시스템 의존성 (geopandas / pyproj 가 사용)
RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential \
        gdal-bin \
        libgdal-dev \
        libgeos-dev \
        libproj-dev \
        proj-data \
        proj-bin \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /workspace

COPY requirements.txt /tmp/requirements.txt
RUN pip install -r /tmp/requirements.txt

# 기본 명령은 사용자가 docker compose run 으로 직접 지정.
CMD ["python", "--version"]
