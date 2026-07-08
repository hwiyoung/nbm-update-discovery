"""표준 GeoJSON import — 사용자 manual upload + 엔진 output 양쪽 공용.

POST /api/v1/tasks/{task_id}/import-geojson
  body: GeoJSON FeatureCollection (application/json)
  feature.properties 표준:
    { "model": "building"|"road", "type": "1"|"2"|"3",
      "accuracy": <float>, "area": <float>,
      "address": <str>, "region_code": <str>, "memo": <str> }

흐름:
  1. task / features 검증
  2. 각 feature 의 properties 를 change_type_mapping.normalize_properties 로 정규화
  3. polygon centroid 가 task.sheet_codes 중 어느 sheet 에 속하는지 PostGIS 로 자동 매칭
  4. DetectionORM 일괄 INSERT (is_user_added=False — 모델/import 출처라 사용자 추가 아님)
  5. 영향받은 sheet 들 recompute_sheet_stats 일괄
  6. 결과 통계 응답: {imported, skipped_unknown_type, skipped_no_sheet, by_change_type}

모든 매핑 로직은 services/change_type_mapping.py 에 집중 — 본 라우터는 흐름만.
"""
from __future__ import annotations

import logging
import secrets
from collections import Counter
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import text as sql_text
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.detection import DetectionORM
from app.models.task import TaskORM
from app.services.change_type_mapping import normalize_properties
from app.services.sheet_stats import recompute_sheet_stats
from app.utils.geo import geojson_4326_to_5186_wkt

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/tasks", tags=["imports"])


# ============================================================
# 요청·응답 스키마
# ============================================================

class GeoJsonFeature(BaseModel):
    type: str
    properties: dict
    geometry: dict


class GeoJsonFeatureCollection(BaseModel):
    type: str = Field(default="FeatureCollection")
    features: list[GeoJsonFeature]


class ImportResult(BaseModel):
    imported: int = 0
    skipped_unknown_type: int = 0
    skipped_no_sheet: int = 0
    skipped_invalid_geometry: int = 0
    by_change_type: dict[str, int] = Field(default_factory=dict)
    affected_sheets: list[str] = Field(default_factory=list)


# ============================================================
# 라우터
# ============================================================

@router.post("/{task_id}/import-geojson", response_model=ImportResult)
def import_geojson(
    task_id: str,
    payload: GeoJsonFeatureCollection,
    db: Session = Depends(get_db),
) -> ImportResult:
    """표준 GeoJSON 일괄 import — 매핑은 change_type_mapping 모듈에 위임."""
    task = db.get(TaskORM, task_id)
    if task is None:
        raise HTTPException(
            status_code=404,
            detail={
                "error": {
                    "code": "RESOURCE_NOT_FOUND",
                    "message": "작업을 찾을 수 없습니다",
                    "details": {"task_id": task_id},
                }
            },
        )
    sheet_codes = list(task.sheet_codes or [])
    if not sheet_codes:
        raise HTTPException(
            status_code=400,
            detail={
                "error": {
                    "code": "BUSINESS_RULE_VIOLATION",
                    "message": "task 에 매칭된 도엽이 없어 import 불가",
                    "details": {"task_id": task_id},
                }
            },
        )

    result = ImportResult()
    by_change_type: Counter[str] = Counter()
    affected_sheets: set[str] = set()
    now = datetime.now(timezone.utc)

    for feat in payload.features:
        # ---- 1) properties 정규화 ----
        norm = normalize_properties(feat.properties or {})
        if norm is None:
            result.skipped_unknown_type += 1
            continue

        # ---- 2) geometry 5186 변환 ----
        geom = feat.geometry or {}
        if geom.get("type") not in ("Polygon", "MultiPolygon"):
            result.skipped_invalid_geometry += 1
            continue
        try:
            # MultiPolygon 은 첫 번째 polygon 만 (현재 시스템은 Polygon 만 지원)
            polygon_geom = geom
            if geom.get("type") == "MultiPolygon":
                coords = geom.get("coordinates", [])
                if not coords:
                    result.skipped_invalid_geometry += 1
                    continue
                polygon_geom = {"type": "Polygon", "coordinates": coords[0]}
            wkt_5186 = geojson_4326_to_5186_wkt(polygon_geom)
        except Exception as e:  # noqa: BLE001
            logger.warning(f"geom convert failed: {e}")
            result.skipped_invalid_geometry += 1
            continue

        # ---- 3) sheet 매칭 — centroid 가 task.sheet_codes 중 어느 sheet ----
        matched = db.execute(
            sql_text(
                """
                SELECT code FROM sheets
                 WHERE code = ANY(:codes)
                   AND ST_Intersects(geometry, ST_Centroid(ST_GeomFromText(:wkt, 5186)))
                 LIMIT 1
                """
            ),
            {"codes": sheet_codes, "wkt": wkt_5186},
        ).first()
        if not matched:
            result.skipped_no_sheet += 1
            continue
        sheet_code = matched[0]

        # ---- 4) DetectionORM INSERT ----
        row = DetectionORM(
            id=f"obj_{secrets.token_hex(8)}",
            sheet_code=sheet_code,
            task_id=task_id,
            model=norm["model"],
            change_type=norm["change_type"],
            confidence=norm["confidence"],
            area_m2=norm["area_m2"],
            geometry=f"SRID=5186;{wkt_5186}",  # type: ignore[arg-type]
            region_code=norm["region_code"],
            address=norm["address"],
            reviewer_memo=norm["reviewer_memo"],
            reviewed_by=None,
            reviewed_at=None,
            is_user_added=False,
            is_deleted=False,
            created_at=now,
        )
        db.add(row)
        by_change_type[norm["change_type"]] += 1
        affected_sheets.add(sheet_code)
        result.imported += 1

    db.flush()

    # ---- 5) 영향받은 sheet 들 stats 재계산 ----
    for sc in affected_sheets:
        recompute_sheet_stats(db, sc)

    db.commit()

    result.by_change_type = dict(by_change_type)
    result.affected_sheets = sorted(affected_sheets)
    return result
