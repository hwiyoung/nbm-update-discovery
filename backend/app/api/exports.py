"""Task 단위 3D DXF 내보내기 (vertex 단위 DEM Z 주입).

spec: 3D_DXF_Export/3D_DXF_EXPORT_SPEC.md

흐름:
  1) task_id 의 detection 폴리곤들을 임시 GPKG (EPSG:5186) 로 직렬화
  2) DEMZExportService.export() 호출 — sheet index sindex 로 도엽 식별, VRT 빌드,
     객체별 vertex 샘플링 (bilinear), DXF 작성
  3) `storage/exports/{task_id}/3d_changes_{ts}.dxf` 영구 저장 + `latest.dxf` 심볼링크
  4) 통계 + download_url 응답
"""
from __future__ import annotations

import logging
import os
import re
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse, JSONResponse, Response
from sqlalchemy.orm import Session

from app.config import get_settings
from app.database import get_db
from app.models.task import TaskORM
from app.schemas.export import (
    Export3dDxfRequest,
    Export3dDxfResponse,
    Export3dStatistics,
    ExportSelectionRequest,
)
from app.services.dem_z_registry import get_dem_z_service, get_init_error
# detection_gpkg 는 함수 안에서 geopandas 를 import 하므로 모듈 상단 import 안전.
from app.services.detection_gpkg import cleanup_gpkg, write_task_detections_gpkg
from app.services.task_shapefile_export import create_task_shapefile_zip
from app.services.task_artifacts import task_artifact_dir

# dem_z_export 모듈은 top-level 에서 geopandas / osgeo 를 import 하므로
# 엔드포인트 함수 안에서 lazy import — 재빌드 전 startup 충돌 방지.

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/tasks", tags=["exports"])


# ============================================================
# GET — 2D Shapefile ZIP export (UTF-8 DBF, EPSG:5186)
# ============================================================


@router.get("/{task_id}/export/shp")
def export_task_shapefile(
    task_id: str,
    db: Session = Depends(get_db),
) -> Response:
    """Task의 활성 변화탐지 결과를 UTF-8 Shapefile ZIP으로 반환한다."""
    return _export_task_shapefile(task_id, db, object_ids=None)


@router.post("/{task_id}/export/shp")
def export_selected_task_shapefile(
    task_id: str,
    body: ExportSelectionRequest,
    db: Session = Depends(get_db),
) -> Response:
    """관심지역에 포함된 변화탐지 객체만 Shapefile ZIP으로 반환한다."""
    return _export_task_shapefile(task_id, db, object_ids=body.object_ids)


def _export_task_shapefile(
    task_id: str,
    db: Session,
    *,
    object_ids: list[str] | None,
) -> Response:
    task = db.get(TaskORM, task_id)
    if task is None:
        raise HTTPException(404, f"Task not found: {task_id}")

    safe_task_id = re.sub(r"[^A-Za-z0-9_-]", "_", task_id)[:64] or "task"
    layer_name = f"nbm_{safe_task_id}_detections"
    content, count = create_task_shapefile_zip(
        db,
        task_id,
        layer_name,
        object_ids=object_ids,
    )
    if count == 0:
        return JSONResponse(
            status_code=400,
            content={
                "error": "no_detections",
                "detail": "내보낼 변화탐지 객체가 없습니다",
            },
        )

    created_at = task.created_at
    if created_at.tzinfo is None:
        created_at = created_at.replace(tzinfo=timezone.utc)
    created_at_kst = created_at.astimezone(ZoneInfo("Asia/Seoul"))
    filename = f"{created_at_kst.strftime('%Y%m%d_%H%M%S')}.zip"
    return Response(
        content=content,
        media_type="application/zip",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "X-Feature-Count": str(count),
        },
    )


# ============================================================
# POST — 3D DXF export
# ============================================================


@router.post(
    "/{task_id}/export/dxf-3d",
    response_model=Export3dDxfResponse,
)
def export_task_3d_dxf(
    task_id: str,
    body: Export3dDxfRequest,
    db: Session = Depends(get_db),
):
    """Task 의 detection 들에 DEM Z 를 vertex 단위로 주입해 3D DXF 생성."""
    settings = get_settings()
    service = get_dem_z_service()
    if service is None:
        return JSONResponse(
            status_code=503,
            content={
                "error": "dem_service_unavailable",
                "detail": get_init_error()
                or "DEMZExportService 가 초기화되지 않았습니다.",
            },
        )

    task = db.get(TaskORM, task_id)
    if task is None:
        raise HTTPException(404, f"Task not found: {task_id}")

    # Lazy import — dem_z_export 모듈이 geopandas / osgeo 를 top-level 에서 사용.
    # 재빌드 전까지 미설치 가능하므로 호출 시점까지 import 지연.
    from app.services.dem_z_export import (
        CRSMismatchError,
        DEMZExportError,
        MissingDEMError,
    )

    # 1) detection → 임시 GPKG (5186)
    gpkg_path, count = write_task_detections_gpkg(
        db,
        task_id,
        object_ids=body.object_ids,
    )
    if count == 0:
        return JSONResponse(
            status_code=400,
            content={
                "error": "no_detections",
                "detail": f"Task 에 변화탐지 객체가 없어 DXF 생성 불가 (task_id={task_id})",
            },
        )

    # 2) 출력 경로 준비. 실제 디렉토리는 export 성공 시점에 생성한다.
    out_dir = _task_export_dir(settings, task_id)
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    filename = f"3d_changes_{ts}.dxf"
    output_path = out_dir / filename

    # 3) export 실행 — 모듈 예외를 API 응답으로 매핑
    try:
        result = service.export(
            polygons_path=gpkg_path,
            output_dxf_path=output_path,
            layer_name=body.layer_name,
        )
    except MissingDEMError as e:
        logger.warning("export 실패 (DEM 미비): %s", e)
        return JSONResponse(
            status_code=422,
            content={
                "error": "missing_dem",
                "detail": str(e),
            },
        )
    except CRSMismatchError as e:
        logger.warning("export 실패 (CRS 불일치): %s", e)
        return JSONResponse(
            status_code=422,
            content={"error": "crs_mismatch", "detail": str(e)},
        )
    except DEMZExportError as e:
        logger.exception("export 실패 (모듈 오류)")
        return JSONResponse(
            status_code=500,
            content={"error": "export_failed", "detail": str(e)},
        )
    finally:
        cleanup_gpkg(gpkg_path)

    # 4) latest.dxf 심볼링크 갱신 (실패해도 본 응답에 영향 없음)
    _update_latest_symlink(out_dir, filename)

    download_url = (
        f"/api/v1/tasks/{task_id}/export/dxf-3d/files/{filename}"
    )
    logger.info(
        "3D DXF export ok task=%s file=%s objects=%d vertices=%d nodata_obj=%d",
        task_id, filename, result.total_objects, result.total_vertices,
        len(result.objects_with_nodata),
    )

    return Export3dDxfResponse(
        download_url=download_url,
        filename=filename,
        statistics=Export3dStatistics(
            total_objects=result.total_objects,
            total_vertices=result.total_vertices,
            sheets_used=result.sheets_used,
            missing_sheets=result.missing_sheets,
            nodata_vertex_count=result.nodata_vertex_count,
            objects_with_nodata=result.objects_with_nodata,
            elapsed_seconds=result.elapsed_seconds,
        ),
    )


# ============================================================
# GET — 다운로드 (타임스탬프 파일명 또는 'latest')
# ============================================================


@router.get("/{task_id}/export/dxf-3d/files/{filename}")
def download_task_3d_dxf(task_id: str, filename: str) -> FileResponse:
    """타임스탬프 파일 또는 latest.dxf 다운로드.

    Security: filename 화이트리스트 (basename only, .dxf 확장자, task_id 디렉토리 안).
    """
    settings = get_settings()

    if "/" in filename or "\\" in filename or ".." in filename:
        raise HTTPException(400, "잘못된 파일명")
    if not filename.endswith(".dxf"):
        raise HTTPException(400, "DXF 파일만 다운로드 가능합니다")

    base = _task_export_dir(settings, task_id).resolve()
    target = (base / filename).resolve()
    # base 디렉토리 밖 참조 차단 (resolve 이후 비교)
    try:
        target.relative_to(base)
    except ValueError:
        raise HTTPException(403, "허용 경로 밖")

    if not target.exists() or not target.is_file():
        raise HTTPException(404, f"파일 없음: {filename}")

    # latest 는 심볼링크라 실 타임스탬프 파일명으로 다운로드되게 한다.
    actual_name = (
        os.readlink(target).split("/")[-1]
        if target.is_symlink()
        else filename
    )
    return FileResponse(
        path=str(target),
        media_type="application/dxf",
        filename=actual_name,
    )


# ============================================================
# Helpers
# ============================================================


def _task_export_dir(settings, task_id: str) -> Path:
    """3D DXF 산출물을 change-detection engine run 디렉토리에 저장."""
    return task_artifact_dir(settings, task_id)


def _update_latest_symlink(out_dir: Path, filename: str) -> None:
    """{out_dir}/latest.dxf → {filename} 심볼링크 갱신.

    심볼링크 미지원 파일시스템 / 권한 오류 시 silently skip (다운로드는 타임스탬프
    파일명으로도 가능하므로 클라이언트 흐름에 영향 없음).
    """
    latest = out_dir / "latest.dxf"
    try:
        if latest.is_symlink() or latest.exists():
            latest.unlink()
        latest.symlink_to(filename)
    except (OSError, NotImplementedError) as e:
        logger.warning("latest symlink 갱신 실패: %s", e)
