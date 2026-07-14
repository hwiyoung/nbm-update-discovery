"""FastAPI 진입점.

이정표 5: 읽기 + 쓰기 API + Celery enqueue + 업로드 + 3D DXF export.
"""

from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import (
    datasets_router,
    detections_router,
    exports_router,
    filesystem_router,
    history_router,
    imports_router,
    sheets_router,
    tasks_router,
    uploads_router,
)
from app.config import get_settings
from app.database import SessionLocal
from app.services.dem_z_registry import init_dem_z_service
from app.services.orthomosaic_registry import scan_and_register as scan_orthomosaic

import asyncio
import logging

_startup_logger = logging.getLogger("nbm.startup")

# 자동 스캔 주기 — 1시간. 사용자가 수동 새로고침을 더 자주 누를 수 있도록 API 도 제공.
ORTHOMOSAIC_SCAN_INTERVAL_SEC = 3600


def _scan_once() -> None:
    """1회 스캔 — 예외 흡수, 로그만 남김."""
    try:
        with SessionLocal() as db:
            stats = scan_orthomosaic(get_settings(), db)
        _startup_logger.info("orthomosaic scan: %s", stats)
    except Exception as e:  # noqa: BLE001
        _startup_logger.warning("orthomosaic scan failed: %s", e)


async def _periodic_orthomosaic_scan() -> None:
    """주기 자동 스캔 루프 — cancel 시 즉시 종료."""
    while True:
        try:
            await asyncio.sleep(ORTHOMOSAIC_SCAN_INTERVAL_SEC)
        except asyncio.CancelledError:
            break
        await asyncio.to_thread(_scan_once)


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    # DEMZExportService — sheet index R-tree 1회 구축. 환경 미비 시 503.
    init_dem_z_service(settings)
    # 실감정사영상 산출물 자동 등록 — startup 1회 + 1시간 주기 루프.
    _scan_once()
    scan_task = asyncio.create_task(_periodic_orthomosaic_scan())
    try:
        yield
    finally:
        scan_task.cancel()
        try:
            await scan_task
        except asyncio.CancelledError:
            pass


_settings = get_settings()

app = FastAPI(
    title="변화탐지 플랫폼 API",
    version=_settings.app_version,
    description="공간정보품질관리원 — AI 변화탐지 처리 플랫폼",
    lifespan=lifespan,
)

# dev: regex 로 localhost / 127.0.0.1 / LAN IP (192.168.x.x, 10.x.x.x) 허용.
# allow_credentials=True 와 wildcard("*") 는 호환되지 않아 정규식 사용.
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=_settings.cors_origin_regex,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "version": _settings.app_version}


@app.get("/")
def root() -> dict[str, str]:
    return {
        "service": "nbm-backend",
        "version": _settings.app_version,
        "milestone": "5",
        "docs": "/docs",
        "health": "/health",
        "api": "/api/v1",
    }


app.include_router(sheets_router, prefix="/api/v1")
app.include_router(detections_router, prefix="/api/v1")
app.include_router(datasets_router, prefix="/api/v1")
app.include_router(history_router, prefix="/api/v1")
app.include_router(tasks_router, prefix="/api/v1")
app.include_router(uploads_router, prefix="/api/v1")
app.include_router(filesystem_router, prefix="/api/v1")
app.include_router(exports_router, prefix="/api/v1")
app.include_router(imports_router, prefix="/api/v1")
