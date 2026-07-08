"""데이터셋 라우터 — 전체 CRUD + overlap (이정표 4·5)."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
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
from app.utils.geo import geojson_4326_to_5186_wkt

router = APIRouter(prefix="/datasets", tags=["datasets"])


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
        raise HTTPException(
            status_code=400,
            detail={
                "error": {
                    "code": "BUSINESS_RULE_VIOLATION",
                    "message": "metadata 조회에는 tile_path가 있는 데이터셋이 필요합니다",
                    "details": {
                        "standard_tile_path": std_row.tile_path,
                        "compare_tile_path": cmp_.tile_path,
                    },
                }
            },
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
