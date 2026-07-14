"""프로젝트 입력 영상의 실제 공통 처리영역 계산."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Sequence

from geoalchemy2.shape import to_shape
from shapely.geometry import mapping
from shapely.geometry.base import BaseGeometry
from shapely.ops import unary_union
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.dataset import DatasetORM
from app.models.task import TaskORM
from app.utils.geo import to_4326


@dataclass(frozen=True)
class TaskProcessingFootprint:
    geometry_4326: dict[str, Any]
    area_m2: float


def intersect_processing_footprints(
    standard_geometries: Sequence[BaseGeometry],
    compare_geometries: Sequence[BaseGeometry],
) -> BaseGeometry | None:
    """과년도 영상 합집합과 당해년도 영상 합집합의 실제 교집합을 계산한다."""
    if not standard_geometries or not compare_geometries:
        return None

    geometry = unary_union(standard_geometries).intersection(
        unary_union(compare_geometries)
    )

    if geometry.is_empty or geometry.area <= 0:
        return None
    if not geometry.is_valid:
        geometry = geometry.buffer(0)
    if geometry.is_empty or geometry.area <= 0:
        return None
    return _merge_disconnected_parts(geometry)


def task_processing_footprint(
    db: Session,
    task: TaskORM,
) -> TaskProcessingFootprint | None:
    """DB의 dataset/sheet geometry로 엔진 입력 공통 처리영역을 재구성한다."""
    standard_ids = _resource_ids(
        task.standard_resource_ids,
        task.standard_resource_id,
    )
    compare_ids = _resource_ids(
        task.compare_resource_ids,
        task.compare_resource_id,
    )
    if not standard_ids or not compare_ids:
        return None

    standard_rows = db.execute(
        select(DatasetORM).where(DatasetORM.id.in_(standard_ids))
    ).scalars().all()
    compare_rows = db.execute(
        select(DatasetORM).where(DatasetORM.id.in_(compare_ids))
    ).scalars().all()
    geometry = intersect_processing_footprints(
        [to_shape(row.bbox) for row in standard_rows],
        [to_shape(row.bbox) for row in compare_rows],
    )
    if geometry is None:
        return None

    return TaskProcessingFootprint(
        geometry_4326=dict(mapping(to_4326(geometry))),
        area_m2=float(geometry.area),
    )


def _resource_ids(ids: list[int] | None, fallback: int | None) -> list[int]:
    normalized: list[int] = []
    for value in [*(ids or []), fallback]:
        if value is None or value in normalized:
            continue
        normalized.append(value)
    return normalized


def _merge_disconnected_parts(geometry: BaseGeometry) -> BaseGeometry:
    """merge 입력의 작은 이격을 닫아 외곽선 하나인 Polygon으로 dissolve한다.

    양쪽 영상 교집합이 이미 연결되어 있으면 그대로 반환한다. 분리된 조각이면
    가장 가까운 조각 간 거리의 절반만큼 buffer-out/in을 반복해 L자 등의 오목한
    외곽은 유지하면서 사이의 좁은 공백만 연결한다.
    """
    if geometry.geom_type != "MultiPolygon":
        return geometry

    original = geometry
    merge_radius = 0.0
    candidate = geometry
    max_steps = len(list(geometry.geoms))
    for _ in range(max_steps):
        parts = list(candidate.geoms)
        gaps = [
            left.distance(right)
            for index, left in enumerate(parts)
            for right in parts[index + 1 :]
        ]
        positive_gaps = [gap for gap in gaps if gap > 0]
        if not positive_gaps:
            break
        nearest_gap = min(positive_gaps)
        merge_radius = max(merge_radius, nearest_gap / 2 + 0.01)
        candidate = original.buffer(
            merge_radius,
            join_style="mitre",
        ).buffer(
            -merge_radius,
            join_style="mitre",
        )
        if candidate.geom_type == "Polygon":
            return candidate

    return candidate
