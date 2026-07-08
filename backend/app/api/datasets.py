"""데이터셋 라우터 — 전체 CRUD + overlap (이정표 4·5)."""

from __future__ import annotations

import os
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query
from shapely.geometry import shape
from shapely.geometry.base import BaseGeometry
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.database import get_db
from app.models.dataset import DatasetORM
from app.models.task import TaskORM
from app.schemas import (
    Dataset,
    DatasetCreate,
    DatasetPreflightRaster,
    DatasetPreflightResult,
    DatasetPreflightWarning,
    DatasetSource,
    DatasetStatus,
    DatasetStatusUpdate,
    OverlapResult,
)
from app.services.orthomosaic_registry import scan_and_register
from app.services.raster_preflight import (
    PairPreflight,
    RasterPreflight,
    build_pair_metadata,
    build_pair_preflight_fast_safe,
)
from app.services.serializers import dataset_to_schema
from app.utils.geo import geojson_4326_to_5186_wkt, to_5186, wkb_to_geojson_4326

router = APIRouter(prefix="/datasets", tags=["datasets"])


def _is_under_path(path: Path, root: Path) -> bool:
    try:
        Path(os.path.abspath(path)).relative_to(Path(os.path.abspath(root)))
    except ValueError:
        return False
    return True


def _unlink_orthomosaic_symlink(tile_path: str | None) -> None:
    if not tile_path:
        return
    path = Path(tile_path)
    if not path.is_symlink():
        return
    root = Path(get_settings().orthomosaic_dir)
    if _is_under_path(path, root):
        path.unlink()


@router.get("", response_model=list[Dataset])
def list_datasets(
    source: DatasetSource | None = Query(default=None),
    status: DatasetStatus | None = Query(default=None),
    platform: str | None = Query(default=None),
    db: Session = Depends(get_db),
) -> list[Dataset]:
    stmt = select(DatasetORM)
    if source:
        stmt = stmt.where(DatasetORM.source == source)
    if status:
        stmt = stmt.where(DatasetORM.status == status)
    if platform:
        stmt = stmt.where(DatasetORM.platform == platform)
    rows = db.execute(stmt).scalars().all()
    return [dataset_to_schema(r) for r in rows]


@router.get("/overlap", response_model=OverlapResult)
def get_overlap(
    std: int = Query(..., description="기준 데이터셋 id"),
    cmp: int = Query(..., description="비교 데이터셋 id"),
    db: Session = Depends(get_db),
) -> OverlapResult:
    std_row = db.get(DatasetORM, std)
    cmp_ = db.get(DatasetORM, cmp)
    if std_row is None or cmp_ is None:
        raise HTTPException(
            status_code=404,
            detail={
                "error": {
                    "code": "RESOURCE_NOT_FOUND",
                    "message": "데이터셋을 찾을 수 없습니다",
                    "details": {"std": std, "cmp": cmp},
                }
            },
        )
    std_set = set(std_row.sheet_codes)
    cmp_set = set(cmp_.sheet_codes)
    common = sorted(std_set & cmp_set)
    union = std_set | cmp_set
    ratio = (len(common) / len(union)) if union else 0.0
    return OverlapResult(ratio=ratio, common_sheets=common)


@router.get("/preflight", response_model=DatasetPreflightResult)
def get_preflight(
    std: int = Query(..., description="기준 데이터셋 id"),
    cmp: int = Query(..., description="비교 데이터셋 id"),
    db: Session = Depends(get_db),
) -> DatasetPreflightResult:
    std_row = db.get(DatasetORM, std)
    cmp_ = db.get(DatasetORM, cmp)
    if std_row is None or cmp_ is None:
        raise HTTPException(
            status_code=404,
            detail={
                "error": {
                    "code": "RESOURCE_NOT_FOUND",
                    "message": "데이터셋을 찾을 수 없습니다",
                    "details": {"std": std, "cmp": cmp},
                }
            },
        )
    if not std_row.tile_path or not cmp_.tile_path:
        raise HTTPException(
            status_code=400,
            detail={
                "error": {
                    "code": "BUSINESS_RULE_VIOLATION",
                    "message": "preflight에는 tile_path가 있는 데이터셋이 필요합니다",
                    "details": {
                        "standard_tile_path": std_row.tile_path,
                        "compare_tile_path": cmp_.tile_path,
                    },
                }
            },
        )

    try:
        settings = get_settings()
        result = build_pair_preflight_fast_safe(
            std_row.tile_path,
            cmp_.tile_path,
            target_gsd_m=settings.change_detection_target_gsd_m,
            rgb_nodata_tolerance=settings.change_detection_preflight_rgb_nodata_tolerance,
        )
    except Exception as exc:
        raise HTTPException(
            status_code=400,
            detail={
                "error": {
                    "code": "PREFLIGHT_FAILED",
                    "message": f"preflight 분석 실패: {exc}",
                    "details": {"std": std, "cmp": cmp},
                }
            },
        ) from exc

    return _preflight_result_schema(std, cmp, result)


@router.get("/preflight/metadata", response_model=DatasetPreflightResult)
def get_preflight_metadata(
    std: int = Query(..., description="기준 데이터셋 id"),
    cmp: int = Query(..., description="비교 데이터셋 id"),
    db: Session = Depends(get_db),
) -> DatasetPreflightResult:
    """Fast raster metadata summary without nodata-aware footprint scanning."""

    std_row = db.get(DatasetORM, std)
    cmp_ = db.get(DatasetORM, cmp)
    if std_row is None or cmp_ is None:
        raise HTTPException(
            status_code=404,
            detail={
                "error": {
                    "code": "RESOURCE_NOT_FOUND",
                    "message": "데이터셋을 찾을 수 없습니다",
                    "details": {"std": std, "cmp": cmp},
                }
            },
        )
    if not std_row.tile_path or not cmp_.tile_path:
        settings = get_settings()
        return _bbox_preflight_result_schema(
            std,
            cmp,
            std_row,
            cmp_,
            target_gsd_m=settings.change_detection_target_gsd_m,
        )

    try:
        settings = get_settings()
        result = build_pair_metadata(
            std_row.tile_path,
            cmp_.tile_path,
            target_gsd_m=settings.change_detection_target_gsd_m,
        )
    except Exception as exc:
        raise HTTPException(
            status_code=400,
            detail={
                "error": {
                    "code": "METADATA_FAILED",
                    "message": f"metadata 분석 실패: {exc}",
                    "details": {"std": std, "cmp": cmp},
                }
            },
        ) from exc

    return _preflight_result_schema(std, cmp, result)


def _preflight_result_schema(
    standard_id: int,
    compare_id: int,
    result: PairPreflight,
) -> DatasetPreflightResult:
    intersection_bounds = (
        [float(v) for v in result.intersection_5186.bounds]
        if not result.intersection_5186.is_empty
        else None
    )
    return DatasetPreflightResult(
        standard=_preflight_raster_schema(standard_id, result.standard),
        compare=_preflight_raster_schema(compare_id, result.compare),
        target_gsd_m=result.target_gsd_m,
        intersection_area_m2=result.intersection_area_m2,
        overlap_ratio=result.overlap_ratio,
        overlap_method=result.overlap_method,
        intersection_bounds_5186=intersection_bounds,
        can_proceed=result.intersection_area_m2 > 0,
        warnings=[
            DatasetPreflightWarning(
                code=warning.code,
                severity=warning.severity,
                message=warning.message,
                details=warning.details,
            )
            for warning in result.warnings
        ],
    )


def _bbox_preflight_result_schema(
    standard_id: int,
    compare_id: int,
    standard_row: DatasetORM,
    compare_row: DatasetORM,
    *,
    target_gsd_m: float,
) -> DatasetPreflightResult:
    standard_geom = _dataset_bbox_5186(standard_row)
    compare_geom = _dataset_bbox_5186(compare_row)
    if standard_geom is None or compare_geom is None:
        raise HTTPException(
            status_code=400,
            detail={
                "error": {
                    "code": "BUSINESS_RULE_VIOLATION",
                    "message": "metadata 조회에는 tile_path 또는 bbox가 있는 데이터셋이 필요합니다",
                    "details": {
                        "standard_tile_path": standard_row.tile_path,
                        "compare_tile_path": compare_row.tile_path,
                        "standard_has_bbox": standard_geom is not None,
                        "compare_has_bbox": compare_geom is not None,
                    },
                }
            },
        )

    intersection = standard_geom.intersection(compare_geom)
    union = standard_geom.union(compare_geom)
    overlap_ratio = (
        float(intersection.area) / float(union.area)
        if not union.is_empty and union.area > 0
        else 0.0
    )
    warnings = [
        DatasetPreflightWarning(
            code="METADATA_BBOX_FALLBACK",
            severity="warning",
            message="실제 영상 경로가 없어 등록된 영역 정보로 중첩률을 계산합니다.",
            details={
                "standard_tile_path": standard_row.tile_path,
                "compare_tile_path": compare_row.tile_path,
            },
        )
    ]
    if intersection.is_empty or intersection.area <= 0:
        warnings.append(
            DatasetPreflightWarning(
                code="BBOX_INTERSECTION_EMPTY",
                severity="strong",
                message="등록된 영역 정보 기준으로 과년도·당해년도 교차 영역이 없습니다.",
                details={},
            )
        )

    intersection_bounds = (
        [float(v) for v in intersection.bounds] if not intersection.is_empty else None
    )
    return DatasetPreflightResult(
        standard=_bbox_preflight_raster_schema(standard_id, standard_row, standard_geom),
        compare=_bbox_preflight_raster_schema(compare_id, compare_row, compare_geom),
        target_gsd_m=target_gsd_m,
        intersection_area_m2=float(intersection.area) if not intersection.is_empty else 0.0,
        overlap_ratio=overlap_ratio,
        overlap_method="dataset_bbox",
        intersection_bounds_5186=intersection_bounds,
        can_proceed=not intersection.is_empty and intersection.area > 0,
        warnings=warnings,
    )


def _bbox_preflight_raster_schema(
    dataset_id: int,
    row: DatasetORM,
    geom_5186: BaseGeometry,
) -> DatasetPreflightRaster:
    return DatasetPreflightRaster(
        dataset_id=dataset_id,
        path=row.tile_path or "",
        crs="EPSG:5186",
        width=0,
        height=0,
        band_count=0,
        gsd_x_m=0.0,
        gsd_y_m=0.0,
        mean_gsd_m=0.0,
        footprint_area_m2=float(geom_5186.area),
        footprint_method="dataset_bbox",
        valid_pixel_count=0,
    )


def _dataset_bbox_5186(row: DatasetORM) -> BaseGeometry | None:
    value = row.bbox
    if value is None:
        return None
    if isinstance(value, dict):
        geom = shape(value)
        return to_5186(geom)
    desc = getattr(value, "desc", None)
    raw = desc if desc is not None else value
    if not isinstance(raw, (bytes, bytearray, str)):
        raw = str(raw)
    geom_4326 = wkb_to_geojson_4326(raw)
    if geom_4326 is None:
        return None
    return to_5186(shape(geom_4326))


def _preflight_raster_schema(
    dataset_id: int,
    raster: RasterPreflight,
) -> DatasetPreflightRaster:
    return DatasetPreflightRaster(
        dataset_id=dataset_id,
        path=raster.path,
        crs=raster.crs,
        width=raster.width,
        height=raster.height,
        band_count=raster.band_count,
        gsd_x_m=raster.gsd_x_m,
        gsd_y_m=raster.gsd_y_m,
        mean_gsd_m=raster.mean_gsd_m,
        footprint_area_m2=float(raster.footprint_5186.area),
        footprint_method=raster.footprint_method,
        valid_pixel_count=raster.valid_pixel_count,
    )


@router.get("/{dataset_id}", response_model=Dataset)
def get_dataset(dataset_id: int, db: Session = Depends(get_db)) -> Dataset:
    row = db.get(DatasetORM, dataset_id)
    if row is None:
        raise HTTPException(
            status_code=404,
            detail={
                "error": {
                    "code": "RESOURCE_NOT_FOUND",
                    "message": "데이터셋을 찾을 수 없습니다",
                    "details": {"id": dataset_id},
                }
            },
        )
    return dataset_to_schema(row)


@router.delete("/{dataset_id}")
def delete_dataset(dataset_id: int, db: Session = Depends(get_db)) -> dict[str, object]:
    """하드 삭제. 사용 중인 task 가 있으면 409 + 차단.

    파일 스토리지 삭제는 이정표 5 에서 (현재는 DB row 만).
    """
    row = db.get(DatasetORM, dataset_id)
    if row is None:
        raise HTTPException(
            status_code=404,
            detail={
                "error": {
                    "code": "RESOURCE_NOT_FOUND",
                    "message": "데이터셋을 찾을 수 없습니다",
                    "details": {"id": dataset_id},
                }
            },
        )
    # 참조 무결성 — 본 데이터셋을 standard 또는 compare 로 쓰는 task 검사
    blocking = (
        db.execute(
            select(TaskORM.id, TaskORM.name).where(
                or_(
                    TaskORM.standard_resource_id == dataset_id,
                    TaskORM.compare_resource_id == dataset_id,
                )
            )
        )
        .all()
    )
    if blocking:
        raise HTTPException(
            status_code=409,
            detail={
                "error": {
                    "code": "BUSINESS_RULE_VIOLATION",
                    "message": "본 데이터셋을 사용 중인 작업이 있어 삭제할 수 없습니다",
                    "details": {
                        "dataset_id": dataset_id,
                        "blocking_tasks": [
                            {"id": t.id, "name": t.name} for t in blocking
                        ],
                    },
                }
            },
        )
    try:
        _unlink_orthomosaic_symlink(row.tile_path)
    except OSError as exc:
        raise HTTPException(
            status_code=500,
            detail={
                "error": {
                    "code": "DATASET_LINK_DELETE_FAILED",
                    "message": f"데이터셋 링크 파일을 삭제하지 못했습니다: {exc}",
                    "details": {"dataset_id": dataset_id, "tile_path": row.tile_path},
                }
            },
        ) from exc
    db.delete(row)
    db.commit()
    return {"deleted": True, "id": dataset_id}


# ============================================================
# 쓰기 (이정표 5)
# ============================================================


@router.post("", response_model=Dataset, status_code=201)
def create_dataset(payload: DatasetCreate, db: Session = Depends(get_db)) -> Dataset:
    """업로드 후 메타 등록. 1차는 status='processing' 으로 생성."""
    wkt = geojson_4326_to_5186_wkt(payload.bbox)
    row = DatasetORM(
        source="upload",
        display_name=payload.display_name,
        platform=payload.platform,
        taken_start_at=payload.taken_start_at,
        taken_end_at=payload.taken_end_at,
        bbox=f"SRID=5186;{wkt}",  # type: ignore[arg-type]
        tile_path=payload.tile_path,
        sheet_codes=payload.sheet_codes,
        status="processing",
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return dataset_to_schema(row)


@router.post("/rescan-orthomosaic")
def rescan_orthomosaic(db: Session = Depends(get_db)) -> dict[str, int]:
    """`ORTHOMOSAIC_DIR` 폴더를 다시 스캔해 신규 .tif 를 aerial 데이터셋으로 등록.

    백엔드는 startup 1회 + 1시간 주기 자동 스캔을 수행하지만, 사용자가 새 파일을
    떨어뜨린 직후 즉시 반영하고 싶을 때 본 엔드포인트를 호출.
    """
    settings = get_settings()
    return scan_and_register(settings, db)


@router.patch("/{dataset_id}/status", response_model=Dataset)
def update_dataset_status(
    dataset_id: int,
    payload: DatasetStatusUpdate,
    db: Session = Depends(get_db),
) -> Dataset:
    row = db.get(DatasetORM, dataset_id)
    if row is None:
        raise HTTPException(
            status_code=404,
            detail={
                "error": {
                    "code": "RESOURCE_NOT_FOUND",
                    "message": "데이터셋을 찾을 수 없습니다",
                    "details": {"id": dataset_id},
                }
            },
        )
    row.status = payload.status
    db.commit()
    db.refresh(row)
    return dataset_to_schema(row)
