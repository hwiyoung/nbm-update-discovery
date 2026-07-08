"""도엽(sheet) 통계 메타 재계산.

sheets.total_detections 는 detection CRUD 시점에 실시간 재계산되어야 한다. 시드
더미값에 의존하면 대시보드 통계 (StatsCards, 월별 차트, 권역 분포 등) 가 실제
처리 상태와 어긋난다.

정책:
  - API 응답 path 와 동일한 필터 적용: is_deleted=false, change_type != 'building_color',
    task_id IS NOT NULL (시드 mock 제외)
  - 오류분류(error_class) 도메인은 제거되어 reviewed/tp/fp/fn 카운트는 더 이상 사용 안 함.
    DB 컬럼은 다음 migration 에서 정리 예정.

mutation 사이트에서 호출:
  - update_detection / create_detection / create_task_detection
  - soft_delete_detection
  - hard_delete_detection (db.delete 직전에 sheet_code 캐싱 후 호출)
"""
from __future__ import annotations

import logging

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.detection import DetectionORM
from app.models.sheet import MapSheetORM

logger = logging.getLogger(__name__)


def recompute_sheet_stats(db: Session, sheet_code: str) -> None:
    """단일 도엽의 total_detections 재계산 + UPDATE."""
    sheet = db.get(MapSheetORM, sheet_code)
    if sheet is None:
        return

    total = db.scalar(
        select(func.count(DetectionORM.id)).where(
            DetectionORM.sheet_code == sheet_code,
            DetectionORM.is_deleted.is_(False),
            DetectionORM.change_type != "building_color",
            DetectionORM.task_id.is_not(None),
        )
    ) or 0

    sheet.total_detections = int(total)


def recompute_all_sheet_stats(db: Session) -> dict[str, int]:
    """전체 도엽의 total_detections 일괄 재계산.

    시드 더미값을 한 번에 정리하거나, 외부 import 후 sync 회복용. detection 이
    존재하는 sheet 만 GROUP BY 로 가져온 뒤 그 sheet 들의 카운트만 UPDATE. detection
    이 0건인 sheet 는 0 으로 강제 리셋 — 시드 더미값 청소.
    """
    rows = db.execute(
        select(
            DetectionORM.sheet_code,
            func.count(DetectionORM.id).label("total"),
        )
        .where(
            DetectionORM.is_deleted.is_(False),
            DetectionORM.change_type != "building_color",
            DetectionORM.task_id.is_not(None),
        )
        .group_by(DetectionORM.sheet_code)
    ).all()

    totals: dict[str, int] = {r.sheet_code: int(r.total) for r in rows}

    sheets = db.execute(select(MapSheetORM)).scalars().all()
    touched = 0
    zeroed = 0
    for s in sheets:
        if s.code in totals:
            s.total_detections = totals[s.code]
            touched += 1
        elif s.total_detections:
            s.total_detections = 0
            zeroed += 1

    return {
        "total_sheets": len(sheets),
        "sheets_with_detections": touched,
        "sheets_zeroed": zeroed,
    }
