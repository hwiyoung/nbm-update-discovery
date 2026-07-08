"""DEMZExportService 싱글톤 보관소.

앱 startup 시 1회 인스턴스화 (sheet index R-tree 구축 + DEM 디렉토리 검증).
요청마다 재생성하지 않고 공유. 인덱스 미존재 / DEM 디렉토리 미존재 등 환경
미비 시 _service 는 None 으로 두고, 엔드포인트가 503 으로 응답하도록 한다.

CLAUDE.md §9.2 — 모든 데이터 입출력은 단일 접점 경유. 본 모듈은 backend 의
DEM Z export 서비스 진입점 역할.
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

from app.config import Settings

logger = logging.getLogger(__name__)

# DEMZExportService 는 geopandas / osgeo 에 의존하므로 top-level import 를 피한다.
# 컨테이너 재빌드 전에는 의존성이 없을 수 있으나, 다른 엔드포인트는 정상 동작해야 한다.
_service: Any = None  # DEMZExportService | None
_init_error: str | None = None


def init_dem_z_service(settings: Settings) -> None:
    """앱 startup 단계에서 호출. 실패 시 _service=None, _init_error 에 사유 저장."""
    global _service, _init_error

    sheet_index = Path(settings.sheet_index_path)
    dem_dir = Path(settings.dem_dir)

    if not sheet_index.exists():
        _init_error = f"sheet index 파일 없음: {sheet_index}"
        logger.warning("DEMZExportService 초기화 보류 — %s", _init_error)
        _service = None
        return

    if not dem_dir.exists():
        # DEM 디렉토리는 운영 배포 시 마운트. 개발 환경에선 보류해도 다른 기능엔 영향 없음.
        _init_error = f"DEM 디렉토리 없음: {dem_dir}"
        logger.warning("DEMZExportService 초기화 보류 — %s", _init_error)
        _service = None
        return

    try:
        # Lazy import — geopandas/osgeo 미설치 시에도 서버 startup 은 통과.
        from app.services.dem_z_export import DEMZExportService

        _service = DEMZExportService(
            sheet_index_path=sheet_index,
            dem_dir=dem_dir,
            sheet_code_field=settings.sheet_code_field,
            target_crs=settings.dem_target_crs,
            dem_filename_pattern=settings.dem_filename_pattern,
            sample_method=settings.dem_sample_method,
        )
        _init_error = None
        logger.info(
            "DEMZExportService ready — sheet_index=%s dem_dir=%s pattern=%s",
            sheet_index, dem_dir, settings.dem_filename_pattern,
        )
    except ImportError as e:
        _init_error = (
            f"의존성 미설치 ({e.name}). docker compose build backend 필요."
        )
        logger.warning("DEMZExportService 초기화 보류 — %s", _init_error)
        _service = None
    except Exception as e:  # noqa: BLE001
        _init_error = f"초기화 예외: {type(e).__name__}: {e}"
        logger.exception("DEMZExportService 초기화 실패")
        _service = None


def get_dem_z_service() -> Any:
    """엔드포인트가 사용. None 이면 503 으로 응답."""
    return _service


def get_init_error() -> str | None:
    """503 응답 본문에 포함할 초기화 사유."""
    return _init_error
