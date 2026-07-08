"""변화탐지 객체 라우터 — 읽기 + 쓰기 (이정표 4·5)."""

from __future__ import annotations

import secrets
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.detection import DetectionORM
from app.models.history import ReviewHistoryORM
from app.models.sheet import MapSheetORM
from app.schemas import (
    DetectionCreatePayload,
    DetectionObject,
    DetectionUpdatePayload,
)
from app.services.history import (
    _serialize_detection_snapshot,
    append_history_for_create,
    append_history_for_update,
    infer_update_action,
)
from app.services.serializers import detection_to_schema
from app.services.sheet_stats import recompute_sheet_stats
from app.utils.geo import geojson_4326_to_5186_wkt

router = APIRouter(tags=["detections"])

# 1차 출시 단일 사용자 — reviewer 고정 (이정표 6 인증 도입 시 X-User 헤더로 전환)
_DEFAULT_REVIEWER = "처리자"


def _gen_id() -> str:
    return f"obj_{secrets.token_hex(8)}"


# ============================================================
# 읽기
# ============================================================


@router.get("/sheets/{sheet_code}/detections", response_model=list[DetectionObject])
def list_detections(
    sheet_code: str,
    include_deleted: bool = Query(default=False),
    db: Session = Depends(get_db),
) -> list[DetectionObject]:
    if db.get(MapSheetORM, sheet_code) is None:
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
    stmt = select(DetectionORM).where(DetectionORM.sheet_code == sheet_code)
    if not include_deleted:
        stmt = stmt.where(DetectionORM.is_deleted.is_(False))
    # building_color (건물 색변화) 는 도메인에서 제외 — 응답 path 에서 필터.
    stmt = stmt.where(DetectionORM.change_type != "building_color")
    # NULL task_id detection 은 시드 mock dummy — 어떤 프로젝트에도 속하지 않음.
    stmt = stmt.where(DetectionORM.task_id.is_not(None))
    rows = db.execute(stmt).scalars().all()
    return [detection_to_schema(r) for r in rows]


@router.get(
    "/tasks/{task_id}/detections",
    response_model=list[DetectionObject],
)
def list_task_detections(
    task_id: str,
    include_deleted: bool = Query(default=False),
    db: Session = Depends(get_db),
) -> list[DetectionObject]:
    """Task 의 detection 만 엄격하게 반환 — task_id 매칭.

    sheet_code 기준이 아니라 detection.task_id == task_id 로 필터하여, 같은
    sheet 를 공유하는 다른 프로젝트의 detection 이 섞이지 않게 함. 엔진이 아직
    돌지 않은 신규 프로젝트는 빈 배열 반환.
    """
    from app.models.task import TaskORM

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
    stmt = select(DetectionORM).where(DetectionORM.task_id == task_id)
    if not include_deleted:
        stmt = stmt.where(DetectionORM.is_deleted.is_(False))
    # building_color (건물 색변화) 는 도메인에서 제외 — 응답 path 에서 필터.
    stmt = stmt.where(DetectionORM.change_type != "building_color")
    # NULL task_id detection 은 시드 mock dummy — 어떤 프로젝트에도 속하지 않음.
    stmt = stmt.where(DetectionORM.task_id.is_not(None))
    rows = db.execute(stmt).scalars().all()
    return [detection_to_schema(r) for r in rows]


# ============================================================
# 쓰기
# ============================================================


def _get_detection_or_404(db: Session, detection_id: str) -> DetectionORM:
    row = db.get(DetectionORM, detection_id)
    if row is None:
        raise HTTPException(
            status_code=404,
            detail={
                "error": {
                    "code": "RESOURCE_NOT_FOUND",
                    "message": "객체를 찾을 수 없습니다",
                    "details": {"id": detection_id},
                }
            },
        )
    return row


@router.patch("/detections/{detection_id}", response_model=DetectionObject)
def update_detection(
    detection_id: str,
    payload: DetectionUpdatePayload,
    task_id: str | None = Query(default=None, description="처리 이력을 격리할 프로젝트 id"),
    db: Session = Depends(get_db),
) -> DetectionObject:
    """객체 부분 업데이트 + 처리 이력 자동 기록.

    task_id 가 주어지면 이력에 함께 기록 — 같은 sheet 를 공유하는 두 프로젝트의
    처리 히스토리가 섞이지 않도록 함.
    """
    row = _get_detection_or_404(db, detection_id)
    before = _serialize_detection_snapshot(row)

    payload_dict = payload.model_dump(exclude_unset=True)

    if "reviewer_memo" in payload_dict and payload_dict["reviewer_memo"] is not None:
        row.reviewer_memo = payload_dict["reviewer_memo"]
    if "geometry" in payload_dict and payload_dict["geometry"]:
        wkt = geojson_4326_to_5186_wkt(payload_dict["geometry"])
        row.geometry = f"SRID=5186;{wkt}"  # type: ignore[assignment]
    if "is_deleted" in payload_dict and payload_dict["is_deleted"] is not None:
        row.is_deleted = payload_dict["is_deleted"]
    # 사용자가 객체 카테고리/변화 유형 수정.
    if "model" in payload_dict and payload_dict["model"] is not None:
        row.model = payload_dict["model"]
    if "change_type" in payload_dict and payload_dict["change_type"] is not None:
        row.change_type = payload_dict["change_type"]

    action = infer_update_action(payload_dict, before=before)
    append_history_for_update(
        db,
        before=before,
        after=row,
        action=action,
        reviewer=_DEFAULT_REVIEWER,
        memo=payload_dict.get("reviewer_memo"),
        task_id=task_id,
    )
    recompute_sheet_stats(db, row.sheet_code)
    db.commit()
    db.refresh(row)
    return detection_to_schema(row)


@router.post(
    "/sheets/{sheet_code}/detections",
    response_model=DetectionObject,
    status_code=201,
)
def create_detection(
    sheet_code: str,
    payload: DetectionCreatePayload,
    task_id: str | None = Query(default=None),
    db: Session = Depends(get_db),
) -> DetectionObject:
    """처리자가 신규 객체 추가 (FN 등). 이력 1건도 같이.

    task_id 가 주어지면 detection 자체에도 기록 — 같은 sheet 를 공유하는 다른
    프로젝트와 격리됨. 미지정 시 sheet.task_id 로 fallback.
    """
    sheet = db.get(MapSheetORM, sheet_code)
    if sheet is None:
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
    effective_task_id = task_id or sheet.task_id
    wkt = geojson_4326_to_5186_wkt(payload.geometry)
    row = DetectionORM(
        id=_gen_id(),
        sheet_code=sheet_code,
        task_id=effective_task_id,
        model=payload.model,
        change_type=payload.change_type,
        confidence=payload.confidence,
        area_m2=payload.area_m2,
        geometry=f"SRID=5186;{wkt}",  # type: ignore[arg-type]
        region_code=payload.region_code,
        address=payload.address,
        reviewer_memo=payload.reviewer_memo,
        reviewed_by=None,
        reviewed_at=None,
        is_user_added=True,
        is_deleted=False,
    )
    db.add(row)
    db.flush()  # row.id 확정
    db.refresh(row)  # geometry 가 WKBElement 로 재로드 (history 직렬화에 필요)
    append_history_for_create(
        db,
        detection=row,
        reviewer=_DEFAULT_REVIEWER,
        memo=payload.reviewer_memo or None,
        task_id=effective_task_id,
    )
    recompute_sheet_stats(db, sheet_code)
    db.commit()
    db.refresh(row)
    return detection_to_schema(row)


@router.post(
    "/tasks/{task_id}/detections",
    response_model=DetectionObject,
    status_code=201,
)
def create_task_detection(
    task_id: str,
    payload: DetectionCreatePayload,
    db: Session = Depends(get_db),
) -> DetectionObject:
    """Task(프로젝트) 단위에서 신규 객체 추가.

    폴리곤 centroid 가 어느 sheet 에 속하는지 PostGIS 로 자동 매칭.
    task.sheet_codes 안에서만 매칭 — 외곽이면 첫 sheet_code 로 fallback.
    """
    from sqlalchemy import text as sql_text
    from app.models.task import TaskORM

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
                    "message": "작업에 매칭된 도엽이 없어 객체 추가 불가",
                    "details": {"task_id": task_id},
                }
            },
        )

    wkt_5186 = geojson_4326_to_5186_wkt(payload.geometry)
    # centroid 가 속하는 sheet 자동 탐색 (task.sheet_codes 한정)
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
    sheet_code = matched[0] if matched else sheet_codes[0]

    row = DetectionORM(
        id=_gen_id(),
        sheet_code=sheet_code,
        task_id=task_id,
        model=payload.model,
        change_type=payload.change_type,
        confidence=payload.confidence,
        area_m2=payload.area_m2,
        geometry=f"SRID=5186;{wkt_5186}",  # type: ignore[arg-type]
        region_code=payload.region_code,
        address=payload.address,
        reviewer_memo=payload.reviewer_memo,
        reviewed_by=None,
        reviewed_at=None,
        is_user_added=True,
        is_deleted=False,
    )
    db.add(row)
    db.flush()
    db.refresh(row)  # geometry 가 WKBElement 로 재로드 (history 직렬화에 필요)
    # task 컨텍스트에서 직접 호출된 경로 — task_id 를 path 에서 그대로 사용.
    append_history_for_create(
        db,
        detection=row,
        reviewer=_DEFAULT_REVIEWER,
        memo=payload.reviewer_memo or None,
        task_id=task_id,
    )
    recompute_sheet_stats(db, sheet_code)
    db.commit()
    db.refresh(row)
    return detection_to_schema(row)


@router.patch("/detections/{detection_id}/deletion", response_model=DetectionObject)
def soft_delete_detection(
    detection_id: str,
    payload: dict[str, bool],
    task_id: str | None = Query(default=None),
    db: Session = Depends(get_db),
) -> DetectionObject:
    """is_deleted 토글. payload: {"is_deleted": true}."""
    deleted = bool(payload.get("is_deleted", False))
    row = _get_detection_or_404(db, detection_id)
    before = _serialize_detection_snapshot(row)
    row.is_deleted = deleted
    append_history_for_update(
        db,
        before=before,
        after=row,
        action="delete" if deleted else "restore",
        reviewer=_DEFAULT_REVIEWER,
        memo=None,
        task_id=task_id,
    )
    recompute_sheet_stats(db, row.sheet_code)
    db.commit()
    db.refresh(row)
    return detection_to_schema(row)


@router.delete("/detections/{detection_id}", status_code=200)
def hard_delete_detection(
    detection_id: str,
    task_id: str | None = Query(default=None),
    db: Session = Depends(get_db),
) -> dict[str, object]:
    """객체 영구 삭제 — DB row 제거 + 처리 이력에 'delete' 기록 (geometry/before 보존).

    soft delete 와 달리 복원 불가. 호출 전 클라이언트가 강한 확인 단계를 거쳐야 함.
    history.before 에는 삭제 직전 스냅샷이 들어가므로 감사용으로는 추적 가능.
    """
    row = _get_detection_or_404(db, detection_id)
    before = _serialize_detection_snapshot(row)
    # row.sheet_code 를 db.delete 전에 캐싱 — 삭제 후 row 접근 불가.
    affected_sheet_code = row.sheet_code
    # 이력 1건 — after 는 None (객체가 더 이상 존재하지 않음).
    history = ReviewHistoryORM(
        id=f"h_{secrets.token_hex(8)}",
        object_id=row.id,
        sheet_code=row.sheet_code,
        task_id=task_id,
        model=row.model,
        change_type=row.change_type,
        geometry=row.geometry,
        action="delete",
        before=before,
        after=None,
        reviewer=_DEFAULT_REVIEWER,
        reviewed_at=datetime.now(timezone.utc),
        memo="영구 삭제",
    )
    db.add(history)
    db.delete(row)
    db.flush()
    recompute_sheet_stats(db, affected_sheet_code)
    db.commit()
    return {"deleted": True, "id": detection_id}
