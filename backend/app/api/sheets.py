"""도엽 라우터 — 읽기 + 처리 상태 변경 (이정표 4·5)."""

from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import false, or_, select
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.sheet import MapSheetORM
from app.models.task import TaskORM
from app.schemas import MapSheet, ReviewStatus, SheetStatusUpdate
from app.services.serializers import sheet_to_schema
from app.services.sheet_stats import recompute_all_sheet_stats

router = APIRouter(prefix="/sheets", tags=["sheets"])

_DEFAULT_REVIEWER = "처리자"


def _all_task_sheet_codes(db: Session) -> set[str]:
    rows = db.execute(select(TaskORM.sheet_codes)).all()
    codes: set[str] = set()
    for row in rows:
        codes.update(row.sheet_codes or [])
    return codes


@router.get("", response_model=list[MapSheet])
def list_sheets(
    region: str | None = Query(default=None),
    status: ReviewStatus | None = Query(default=None),
    task_id: str | None = Query(default=None),
    include_grid: bool = Query(
        default=False,
        description="True 면 task 미할당 도엽(17K 그리드)까지 포함. 기본 False.",
    ),
    db: Session = Depends(get_db),
) -> list[MapSheet]:
    stmt = select(MapSheetORM)
    # 기본은 프로젝트에 연결된 도엽만 반환한다.
    # legacy seed 는 sheets.task_id 를 쓰고, 실제 신규 작업은 tasks.sheet_codes 를 쓴다.
    if task_id:
        task = db.get(TaskORM, task_id)
        codes = set(task.sheet_codes) if task else set()
        stmt = stmt.where(MapSheetORM.code.in_(codes) if codes else false())
    elif not include_grid:
        codes = _all_task_sheet_codes(db)
        linked = MapSheetORM.task_id.is_not(None)
        stmt = stmt.where(or_(linked, MapSheetORM.code.in_(codes)) if codes else linked)
    if region:
        stmt = stmt.where(MapSheetORM.region == region)
    if status:
        stmt = stmt.where(MapSheetORM.review_status == status)
    rows = db.execute(stmt).scalars().all()
    return [sheet_to_schema(r) for r in rows]


@router.get("/{sheet_code}", response_model=MapSheet)
def get_sheet(sheet_code: str, db: Session = Depends(get_db)) -> MapSheet:
    row = db.get(MapSheetORM, sheet_code)
    if row is None:
        raise HTTPException(
            status_code=404,
            detail={
                "error": {
                    "code": "RESOURCE_NOT_FOUND",
                    "message": "도엽을 찾을 수 없습니다",
                    "details": {"sheet_code": sheet_code},
                }
            },
        )
    return sheet_to_schema(row)


@router.patch("/{sheet_code}/status", response_model=MapSheet)
def update_sheet_status(
    sheet_code: str,
    payload: SheetStatusUpdate,
    db: Session = Depends(get_db),
) -> MapSheet:
    row = db.get(MapSheetORM, sheet_code)
    if row is None:
        raise HTTPException(
            status_code=404,
            detail={
                "error": {
                    "code": "RESOURCE_NOT_FOUND",
                    "message": "도엽을 찾을 수 없습니다",
                    "details": {"sheet_code": sheet_code},
                }
            },
        )
    row.review_status = payload.status
    if payload.status == "completed":
        row.reviewer = _DEFAULT_REVIEWER
        row.reviewed_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(row)
    return sheet_to_schema(row)


@router.post("/admin/recompute-stats")
def recompute_stats(db: Session = Depends(get_db)) -> dict[str, int]:
    """모든 도엽의 detection 메타 (5개 카운트) 일괄 재계산.

    Manual import 같은 외부 흐름 후 동기화 회복용. 결과: 처리된 도엽 수.
    """
    result = recompute_all_sheet_stats(db)
    db.commit()
    return result
