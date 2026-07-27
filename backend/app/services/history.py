"""처리 이력 자동 기록 헬퍼.

PATCH /detections/{id} 등 객체 변경 시 트랜잭션 안에서 ReviewHistoryORM 추가.
액션 종류는 페이로드 내용에 따라 추론.
"""

from __future__ import annotations

import secrets
from datetime import datetime, timezone
from typing import Any

from sqlalchemy.orm import Session

from app.models.detection import DetectionORM
from app.models.history import ReviewHistoryORM
from app.utils.geo import geojson_4326_to_5186_wkt, wkb_to_geojson_4326


def _serialize_detection_snapshot(d: DetectionORM) -> dict[str, Any]:
    """Detection ORM → 이력 before/after 직렬화 (4326 GeoJSON)."""
    return {
        "id": d.id,
        "model": d.model,
        "change_type": d.change_type,
        "confidence": d.confidence,
        "area_m2": d.area_m2,
        "geometry": wkb_to_geojson_4326(getattr(d.geometry, "desc", d.geometry)),
        "region_code": d.region_code,
        "address": d.address,
        "reviewer_memo": d.reviewer_memo,
        "is_user_added": d.is_user_added,
        "is_deleted": d.is_deleted,
    }


def _gen_id(prefix: str) -> str:
    return f"{prefix}_{secrets.token_hex(8)}"


def append_history_for_update(
    db: Session,
    *,
    before: dict[str, Any],
    after: DetectionORM,
    action: str,
    reviewer: str,
    memo: str | None,
    task_id: str | None = None,
) -> ReviewHistoryORM:
    """기존 객체 변경 이력. before 는 변경 전 스냅샷.

    task_id 는 같은 sheet 를 공유하는 두 프로젝트가 동일 이력을 보지 않도록 격리.
    None 이면 legacy 행 — list_task_history 에서 sheet 매칭 fallback.
    """
    geom_wkt = geojson_4326_to_5186_wkt(before["geometry"]) if before.get("geometry") else None
    after_snap = _serialize_detection_snapshot(after)
    history = ReviewHistoryORM(
        id=_gen_id("h"),
        object_id=after.id,
        sheet_code=after.sheet_code,
        task_id=task_id,
        model=after.model,
        change_type=after.change_type,
        geometry=f"SRID=5186;{geom_wkt}" if geom_wkt else None,  # type: ignore[arg-type]
        action=action,
        before=before,
        after=after_snap,
        reviewer=reviewer,
        reviewed_at=datetime.now(timezone.utc),
        memo=memo,
    )
    db.add(history)
    return history


def append_history_for_create(
    db: Session,
    *,
    detection: DetectionORM,
    reviewer: str,
    memo: str | None,
    task_id: str | None = None,
) -> ReviewHistoryORM:
    after_snap = _serialize_detection_snapshot(detection)
    history = ReviewHistoryORM(
        id=_gen_id("h"),
        object_id=detection.id,
        sheet_code=detection.sheet_code,
        task_id=task_id,
        model=detection.model,
        change_type=detection.change_type,
        geometry=detection.geometry,  # type: ignore[arg-type]
        action="create",
        before=None,
        after=after_snap,
        reviewer=reviewer,
        reviewed_at=datetime.now(timezone.utc),
        memo=memo,
    )
    db.add(history)
    return history


def infer_update_action(
    payload: dict[str, Any],
    *,
    before: dict[str, Any],
) -> str:
    """페이로드 내용 + 이전 상태에서 액션 추론."""
    if "is_deleted" in payload and payload["is_deleted"] != before.get("is_deleted"):
        return "delete" if payload["is_deleted"] else "restore"
    if "geometry" in payload and payload["geometry"]:
        return "edit_geometry"
    if "model" in payload or "change_type" in payload:
        return "classify"
    if "reviewer_memo" in payload:
        return "edit_meta"
    return "edit_meta"
