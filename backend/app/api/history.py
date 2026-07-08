"""처리 이력 라우터 — 읽기 + Undo (이정표 4·5)."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.detection import DetectionORM
from app.models.history import ReviewHistoryORM
from app.models.task import TaskORM
from app.schemas import ReviewHistory
from app.services.serializers import history_to_schema
from app.utils.geo import geojson_4326_to_5186_wkt

router = APIRouter(tags=["history"])


@router.get("/sheets/{sheet_code}/history", response_model=list[ReviewHistory])
def list_history(sheet_code: str, db: Session = Depends(get_db)) -> list[ReviewHistory]:
    stmt = (
        select(ReviewHistoryORM)
        .where(
            ReviewHistoryORM.sheet_code == sheet_code,
            # building_color 는 도메인에서 제외 — 응답 path 에서 필터.
            ReviewHistoryORM.change_type != "building_color",
        )
        .order_by(ReviewHistoryORM.reviewed_at.desc())
    )
    rows = db.execute(stmt).scalars().all()
    return [history_to_schema(r) for r in rows]


@router.get("/tasks/{task_id}/history", response_model=list[ReviewHistory])
def list_task_history(task_id: str, db: Session = Depends(get_db)) -> list[ReviewHistory]:
    """프로젝트(=task) 의 처리 이력 — task_id 엄격 매칭.

    detection 과 동일 정책: detection.task_id / review_histories.task_id 가 정확히
    일치하는 row 만 반환. legacy NULL 데이터는 어느 프로젝트에도 노출되지 않음
    (migration 0003 의 backfill 로 의미있는 NULL 은 없어야 함).
    """
    task = db.get(TaskORM, task_id)
    if task is None:
        return []
    stmt = (
        select(ReviewHistoryORM)
        .where(
            ReviewHistoryORM.task_id == task_id,
            ReviewHistoryORM.change_type != "building_color",
        )
        .order_by(ReviewHistoryORM.reviewed_at.desc())
    )
    rows = db.execute(stmt).scalars().all()
    return [history_to_schema(r) for r in rows]


@router.delete(
    "/sheets/{sheet_code}/history/recent",
    response_model=list[ReviewHistory],
)
def pop_recent_history(
    sheet_code: str,
    count: int = Query(default=1, ge=1, le=100),
    db: Session = Depends(get_db),
) -> list[ReviewHistory]:
    """최근 N건 이력 제거 + 객체 상태 before 로 복원 (Undo).

    create 액션의 undo 는 객체 soft-delete 로 처리.
    """
    stmt = (
        select(ReviewHistoryORM)
        .where(ReviewHistoryORM.sheet_code == sheet_code)
        .order_by(ReviewHistoryORM.reviewed_at.desc())
        .limit(count)
    )
    rows: list[ReviewHistoryORM] = list(db.execute(stmt).scalars().all())
    if not rows:
        return []

    popped_schemas = [history_to_schema(r) for r in rows]

    for h in rows:
        det = db.get(DetectionORM, h.object_id)
        if det is None:
            continue
        if h.action == "create":
            det.is_deleted = True
        elif h.before:
            before = h.before
            if "reviewer_memo" in before:
                det.reviewer_memo = before["reviewer_memo"] or ""
            if "is_deleted" in before:
                det.is_deleted = bool(before["is_deleted"])
            if before.get("geometry"):
                wkt = geojson_4326_to_5186_wkt(before["geometry"])
                det.geometry = f"SRID=5186;{wkt}"  # type: ignore[assignment]
        db.delete(h)

    db.commit()
    return popped_schemas
