"""ORM → Pydantic 직렬화 헬퍼.

Geometry 컬럼은 WKB(bytes-like) 로 들어오므로 EPSG:5186 → 4326 변환 + GeoJSON dict.
"""

from __future__ import annotations

import re
from collections import Counter
from datetime import datetime
from pathlib import Path

from app.config import get_settings
from app.models.dataset import DatasetORM
from app.models.detection import DetectionORM
from app.models.history import ReviewHistoryORM
from app.models.sheet import MapSheetORM
from app.models.task import TaskORM
from app.schemas import (
    Dataset,
    DetectionObject,
    MapSheet,
    ReviewHistory,
    Task,
)
from app.services.task_progress import read_task_progress
from app.utils.geo import bbox_from_geometry, wkb_to_geojson_4326
from sqlalchemy import select
from sqlalchemy.orm import Session

_FILENAME_YEAR_RE = re.compile(r"(?<!\d)(20\d{2})(?!\d)")
_FILENAME_SHORT_YEAR_RE = re.compile(r"(?<!\d)(2[0-9]|3[0-5])(?!\d)")


def _wkb_str(value: object) -> bytes | str | None:
    """WKBElement / hex / bytes 모두 처리."""
    if value is None:
        return None
    desc = getattr(value, "desc", None)
    if desc is not None:
        return desc  # geoalchemy2 WKBElement.desc → hex str
    if isinstance(value, (bytes, bytearray, str)):
        return value
    return str(value)


def sheet_to_schema(row: MapSheetORM) -> MapSheet:
    geom_4326 = wkb_to_geojson_4326(_wkb_str(row.geometry))
    bbox = bbox_from_geometry(geom_4326) if geom_4326 else [0.0, 0.0, 0.0, 0.0]
    return MapSheet(
        code=row.code,
        name=row.name,
        region=row.region,
        bbox=bbox,
        geometry=geom_4326 or {"type": "Polygon", "coordinates": []},
        area_km2=row.area_km2,
        review_status=row.review_status,  # type: ignore[arg-type]
        reviewer=row.reviewer,
        reviewed_at=row.reviewed_at,
        task_id=row.task_id,
        models=list(row.models) if row.models else [],  # type: ignore[arg-type]
        compare_type=row.compare_type,  # type: ignore[arg-type]
        standard_resource_id=row.standard_resource_id,
        compare_resource_id=row.compare_resource_id,
        f1_score=row.f1_score,
        precision=row.precision,
        recall=row.recall,
        total_detections=row.total_detections,
    )


def detection_to_schema(row: DetectionORM) -> DetectionObject:
    geom_4326 = wkb_to_geojson_4326(_wkb_str(row.geometry))
    return DetectionObject(
        id=row.id,
        sheet_code=row.sheet_code,
        task_id=row.task_id,
        model=row.model,  # type: ignore[arg-type]
        change_type=row.change_type,  # type: ignore[arg-type]
        confidence=row.confidence,
        area_m2=row.area_m2,
        geometry=geom_4326 or {"type": "Polygon", "coordinates": []},
        region_code=row.region_code,
        address=row.address,
        reviewer_memo=row.reviewer_memo,
        reviewed_by=row.reviewed_by,
        reviewed_at=row.reviewed_at,
        is_user_added=row.is_user_added,
        is_deleted=row.is_deleted,
    )


def _is_under_path(path: Path, root: Path) -> bool:
    try:
        path.resolve(strict=False).relative_to(root.resolve(strict=False))
    except ValueError:
        return False
    return True


def _dataset_host_path(row: DatasetORM) -> str | None:
    if not row.tile_path:
        return None
    settings = get_settings()
    tile_path = Path(row.tile_path)
    host_root = settings.host_orthomosaic_dir
    if host_root:
        container_root = Path(settings.orthomosaic_dir)
        if _is_under_path(tile_path, container_root):
            try:
                rel = tile_path.resolve(strict=False).relative_to(
                    container_root.resolve(strict=False)
                )
            except ValueError:
                rel = Path(row.tile_path).relative_to(settings.orthomosaic_dir)
            return str(Path(host_root) / rel)
    if row.tile_path.startswith("/media/") or row.tile_path.startswith("/mnt/"):
        return row.tile_path
    return None


def _dataset_regions(row: DatasetORM, db: Session | None) -> list[str]:
    if db is None or not row.sheet_codes:
        return []
    rows = db.execute(
        select(MapSheetORM.region).where(MapSheetORM.code.in_(row.sheet_codes))
    ).all()
    counts = Counter(region for (region,) in rows if region)
    return [
        region
        for region, _ in sorted(counts.items(), key=lambda item: (-item[1], item[0]))
    ]


def _dataset_capture_year(row: DatasetORM) -> int | None:
    if row.source == "aerial":
        candidates = [row.display_name, row.tile_path]
        for value in candidates:
            if not value:
                continue
            match = _FILENAME_YEAR_RE.search(Path(value).name)
            if match:
                return int(match.group(1))
        for value in candidates:
            if not value:
                continue
            match = _FILENAME_SHORT_YEAR_RE.search(Path(value).stem)
            if match:
                return 2000 + int(match.group(1))
    return row.taken_start_at.year if row.taken_start_at else None


def dataset_to_schema(row: DatasetORM, db: Session | None = None) -> Dataset:
    bbox_4326 = wkb_to_geojson_4326(_wkb_str(row.bbox))
    regions = _dataset_regions(row, db)
    return Dataset(
        id=row.id,
        source=row.source,  # type: ignore[arg-type]
        display_name=row.display_name,
        platform=row.platform,
        taken_start_at=row.taken_start_at,
        taken_end_at=row.taken_end_at,
        bbox=bbox_4326 or {"type": "Polygon", "coordinates": []},
        tile_path=row.tile_path,
        sheet_codes=list(row.sheet_codes),
        regions=regions,
        primary_region=regions[0] if regions else None,
        capture_year=_dataset_capture_year(row),
        host_path=_dataset_host_path(row),
        status=row.status,  # type: ignore[arg-type]
        thumbnail_url=row.thumbnail_url,
        size_bytes=row.size_bytes,
    )


def history_to_schema(row: ReviewHistoryORM) -> ReviewHistory:
    geom_4326 = wkb_to_geojson_4326(_wkb_str(row.geometry))
    return ReviewHistory(
        id=row.id,
        object_id=row.object_id,
        sheet_code=row.sheet_code,
        task_id=row.task_id,
        model=row.model,  # type: ignore[arg-type]
        change_type=row.change_type,  # type: ignore[arg-type]
        geometry=geom_4326 or {"type": "Polygon", "coordinates": []},
        action=row.action,  # type: ignore[arg-type]
        before=row.before,
        after=row.after,
        reviewer=row.reviewer,
        reviewed_at=row.reviewed_at,
        memo=row.memo,
    )


def task_to_schema(row: TaskORM, detection_count: int = 0) -> Task:
    standard_ids = list(row.standard_resource_ids or [])
    compare_ids = list(row.compare_resource_ids or [])
    if not standard_ids and row.standard_resource_id is not None:
        standard_ids = [row.standard_resource_id]
    if not compare_ids and row.compare_resource_id is not None:
        compare_ids = [row.compare_resource_id]
    progress_meta = read_task_progress(get_settings(), row.id)
    return Task(
        id=row.id,
        name=row.name,
        description=row.description,
        models=list(row.models),  # type: ignore[arg-type]
        compare_type=row.compare_type,  # type: ignore[arg-type]
        standard_resource_id=row.standard_resource_id,
        compare_resource_id=row.compare_resource_id,
        standard_resource_ids=standard_ids,
        compare_resource_ids=compare_ids,
        sheet_codes=list(row.sheet_codes),
        status=row.status,  # type: ignore[arg-type]
        progress=row.progress,
        progress_message=(
            str(progress_meta.get("message"))
            if progress_meta and progress_meta.get("message")
            else None
        ),
        progress_stage=(
            str(progress_meta.get("stage"))
            if progress_meta and progress_meta.get("stage")
            else None
        ),
        progress_detail=(
            progress_meta.get("detail")
            if progress_meta and isinstance(progress_meta.get("detail"), dict)
            else None
        ),
        progress_updated_at=_progress_updated_at(progress_meta),
        created_at=row.created_at,
        started_at=getattr(row, "started_at", None),
        finished_at=row.finished_at,
        celery_task_id=row.celery_task_id,
        detection_count=detection_count,
    )


def _progress_updated_at(progress_meta: dict | None) -> datetime | None:
    if not progress_meta:
        return None
    raw = progress_meta.get("updated_at")
    if not isinstance(raw, str) or not raw:
        return None
    try:
        return datetime.fromisoformat(raw)
    except ValueError:
        return None
