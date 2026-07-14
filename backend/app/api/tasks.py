"""변화탐지 작업 라우터 — 읽기 + 등록 + 진행률 (이정표 4·5).

등록 시 Celery enqueue → 워커가 run_change_detection 실행.
진행률은 task.progress (DB) + Celery state 둘 중 fresh 한 값.
"""

from __future__ import annotations

import secrets
from datetime import datetime, timezone
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.database import get_db
from app.models.dataset import DatasetORM
from app.models.detection import DetectionORM
from app.models.sheet import MapSheetORM
from app.models.task import TaskORM
from app.schemas import Task, TaskCreatePayload, TaskUpdatePayload
from app.services.serializers import task_to_schema
from app.services.task_artifacts import delete_task_artifacts
from app.services.task_processing_geometry import (
    TaskProcessingFootprint,
    task_processing_footprint,
    task_processing_footprints,
)
from app.services.task_progress import write_task_progress

router = APIRouter(prefix="/tasks", tags=["tasks"])


def _gen_task_id() -> str:
    """신규 task 식별자 — 32자리 hex (prefix 없음).

    기존 seed/import 데이터 (예: task_3ebc..., task-anyang-...) 는 외부 참조 많아
    그대로 유지. 신규 생성부터 prefix 없는 임의 hex 로 통일.
    """
    return secrets.token_hex(16)


def _task_detection_count(db: Session, task_id: str) -> int:
    """단일 task 의 활성 detection 수 — soft-deleted, building_color 제외.

    API 응답 path 에서 building_color 를 도메인 제외하므로, 카드 카운트도 동일
    필터를 거쳐 응답·표시 일관성 유지.
    """
    return (
        db.scalar(
            select(func.count(DetectionORM.id)).where(
                DetectionORM.task_id == task_id,
                DetectionORM.is_deleted.is_(False),
                DetectionORM.change_type != "building_color",
            )
        )
        or 0
    )


def _task_response(
    db: Session,
    row: TaskORM,
    detection_count: int = 0,
    *,
    footprint: TaskProcessingFootprint | None = None,
) -> Task:
    resolved = footprint or task_processing_footprint(db, row)
    return task_to_schema(
        row,
        detection_count,
        processing_geometry=(resolved.geometry_4326 if resolved else None),
        processing_area_m2=(resolved.area_m2 if resolved else None),
    )


def _normalize_resource_ids(
    ids: list[int],
    fallback: int | None,
) -> list[int]:
    normalized: list[int] = []
    for value in [*ids, fallback]:
        if value is None:
            continue
        if value not in normalized:
            normalized.append(value)
    return normalized


def _validate_disjoint_resource_ids(
    standard_ids: list[int],
    compare_ids: list[int],
) -> None:
    duplicated_ids = sorted(set(standard_ids) & set(compare_ids))
    if not duplicated_ids:
        return
    raise HTTPException(
        status_code=400,
        detail={
            "error": {
                "code": "BUSINESS_RULE_VIOLATION",
                "message": "같은 데이터셋을 과년도와 당해년도에 동시에 선택할 수 없습니다",
                "details": {
                    "duplicated_resource_ids": duplicated_ids,
                    "standard_resource_ids": standard_ids,
                    "compare_resource_ids": compare_ids,
                },
            }
        },
    )


def _load_datasets_or_404(
    db: Session,
    ids: list[int],
    *,
    field: str,
) -> list[DatasetORM]:
    rows = list(db.execute(select(DatasetORM).where(DatasetORM.id.in_(ids))).scalars())
    by_id = {row.id: row for row in rows}
    missing = [id_ for id_ in ids if id_ not in by_id]
    if missing:
        raise HTTPException(
            status_code=404,
            detail={
                "error": {
                    "code": "RESOURCE_NOT_FOUND",
                    "message": "데이터셋을 찾을 수 없습니다",
                    "details": {field: ids, "missing_ids": missing},
                }
            },
        )
    return [by_id[id_] for id_ in ids]


def _union_sheet_codes(datasets: list[DatasetORM]) -> set[str]:
    out: set[str] = set()
    for dataset in datasets:
        out.update(dataset.sheet_codes or [])
    return out


def _new_celery_task_id() -> str:
    return str(uuid4())


def _prepare_task_run(row: TaskORM, celery_task_id: str) -> None:
    """신규 수동 실행 세대를 준비한다.

    완료 작업도 사용자가 재처리를 요청하면 새 Celery ID로 pending 상태가 된다.
    이후 과거 delivery는 ID 불일치로 거부되고 이 실행 세대만 worker에 진입한다.
    """
    row.status = "pending"
    row.progress = 0
    row.started_at = None
    row.finished_at = None
    row.celery_task_id = celery_task_id


@router.get("", response_model=list[Task])
def list_tasks(db: Session = Depends(get_db)) -> list[Task]:
    rows = db.execute(select(TaskORM).order_by(TaskORM.created_at.desc())).scalars().all()

    # N+1 회피: detection 카운트는 단일 GROUP BY 로 한 번에.
    # building_color 는 도메인 제외 — 응답 path 와 일관.
    count_rows = db.execute(
        select(DetectionORM.task_id, func.count(DetectionORM.id))
        .where(
            DetectionORM.is_deleted.is_(False),
            DetectionORM.task_id.is_not(None),
            DetectionORM.change_type != "building_color",
        )
        .group_by(DetectionORM.task_id)
    ).all()
    counts: dict[str, int] = {tid: int(c) for tid, c in count_rows}
    footprints = task_processing_footprints(db, rows)

    return [
        _task_response(
            db,
            row,
            counts.get(row.id, 0),
            footprint=footprints.get(row.id),
        )
        for row in rows
    ]


@router.get("/{task_id}", response_model=Task)
def get_task(task_id: str, db: Session = Depends(get_db)) -> Task:
    row = db.get(TaskORM, task_id)
    if row is None:
        raise HTTPException(
            status_code=404,
            detail={
                "error": {
                    "code": "RESOURCE_NOT_FOUND",
                    "message": "작업을 찾을 수 없습니다",
                    "details": {"id": task_id},
                }
            },
        )
    return _task_response(db, row, _task_detection_count(db, task_id))


@router.post("", response_model=Task, status_code=202)
def create_task(payload: TaskCreatePayload, db: Session = Depends(get_db)) -> Task:
    """위저드 등록 + Celery enqueue.

    유효성: 과년도 묶음과 당해년도 묶음의 sheet_codes 교집합 ≥ 1.
    """
    standard_ids = _normalize_resource_ids(
        payload.standard_resource_ids,
        payload.standard_resource_id,
    )
    compare_ids = _normalize_resource_ids(
        payload.compare_resource_ids,
        payload.compare_resource_id,
    )
    if not standard_ids or not compare_ids:
        raise HTTPException(
            status_code=400,
            detail={
                "error": {
                    "code": "BUSINESS_RULE_VIOLATION",
                    "message": "과년도와 당해년도 데이터셋을 각각 1개 이상 선택해야 합니다",
                    "details": {
                        "standard_resource_ids": standard_ids,
                        "compare_resource_ids": compare_ids,
                    },
                }
            },
        )
    _validate_disjoint_resource_ids(standard_ids, compare_ids)

    standards = _load_datasets_or_404(db, standard_ids, field="standard_resource_ids")
    compares = _load_datasets_or_404(db, compare_ids, field="compare_resource_ids")
    common = sorted(_union_sheet_codes(standards) & _union_sheet_codes(compares))
    if not common:
        raise HTTPException(
            status_code=400,
            detail={
                "error": {
                    "code": "BUSINESS_RULE_VIOLATION",
                    "message": "선택한 과년도·당해년도 영상의 공통 도엽이 없어 작업을 등록할 수 없습니다",
                    "details": {
                        "standard_resource_ids": standard_ids,
                        "compare_resource_ids": compare_ids,
                    },
                }
            },
        )

    task_id = _gen_task_id()
    row = TaskORM(
        id=task_id,
        name=payload.name,
        description=payload.description,
        models=list(payload.models),
        compare_type=payload.compare_type,
        standard_resource_id=standard_ids[0],
        compare_resource_id=compare_ids[0],
        standard_resource_ids=standard_ids,
        compare_resource_ids=compare_ids,
        sheet_codes=common,
        status="pending",
        progress=0,
        created_at=datetime.now(timezone.utc),
        started_at=None,
        finished_at=None,
        celery_task_id=None,
    )
    db.add(row)
    db.commit()
    db.refresh(row)

    if not payload.auto_run:
        # 신규 task — detection 0건.
        return _task_response(db, row, 0)

    settings = get_settings()
    write_task_progress(
        settings,
        task_id,
        progress=0,
        message="큐 대기 중",
        stage="queued",
        detail={},
    )

    # Celery enqueue — broker 다운 시 silently 실패하지 않도록 try/log.
    try:
        from app.workers.tasks import run_change_detection

        celery_task_id = _new_celery_task_id()
        row.celery_task_id = celery_task_id
        db.commit()
        async_result = run_change_detection.apply_async(
            args=[task_id],
            queue=settings.change_detection_queue,
            task_id=celery_task_id,
        )
        row.celery_task_id = async_result.id or celery_task_id
        db.commit()
        db.refresh(row)
    except Exception as e:
        row.celery_task_id = None
        db.commit()
        # Celery worker 가 안 떠있어도 task row 는 남음 — 사용자가 재시도 가능.
        print(f"[create_task] Celery enqueue failed: {e}")

    return _task_response(db, row, 0)


@router.get("/{task_id}/status", response_model=Task)
def get_task_status(task_id: str, db: Session = Depends(get_db)) -> Task:
    """진행률 폴링용. DB row 의 status/progress 그대로 반환."""
    return get_task(task_id, db)


@router.post("/{task_id}/start", response_model=Task)
def start_task(task_id: str, db: Session = Depends(get_db)) -> Task:
    """처리 시작 — 미실행/완료/중단/실패 작업을 새 Celery ID로 재큐.

    이미 running 인 경우 409.
    """
    row = db.get(TaskORM, task_id)
    if row is None:
        raise HTTPException(
            status_code=404,
            detail={
                "error": {
                    "code": "RESOURCE_NOT_FOUND",
                    "message": "작업을 찾을 수 없습니다",
                    "details": {"id": task_id},
                }
            },
        )
    if row.status == "running" or (row.status == "pending" and row.celery_task_id):
        raise HTTPException(
            status_code=409,
            detail={
                "error": {
                    "code": "BUSINESS_RULE_VIOLATION",
                    "message": "이미 처리 대기 중이거나 처리 중인 작업입니다",
                    "details": {"task_id": task_id, "status": row.status},
                }
            },
        )

    # 상태 초기화와 새 delivery ID 저장을 한 transaction 으로 묶는다.
    celery_task_id = _new_celery_task_id()
    _prepare_task_run(row, celery_task_id)
    db.commit()
    settings = get_settings()
    write_task_progress(
        settings,
        task_id,
        progress=0,
        message="큐 대기 중",
        stage="queued",
        detail={},
    )

    try:
        from app.workers.tasks import run_change_detection

        async_result = run_change_detection.apply_async(
            args=[task_id],
            queue=settings.change_detection_queue,
            task_id=celery_task_id,
        )
        if async_result.id and async_result.id != celery_task_id:
            raise RuntimeError(
                "Celery returned an unexpected task id: "
                f"expected={celery_task_id} actual={async_result.id}"
            )
    except Exception as e:  # noqa: BLE001
        row.celery_task_id = None
        db.commit()
        # Celery 다운 시 task 는 pending 상태로 남음 — 사용자가 재시도 가능.
        print(f"[start_task] Celery enqueue failed: {e}")

    db.refresh(row)
    return _task_response(db, row, _task_detection_count(db, row.id))


@router.post("/{task_id}/cancel", response_model=Task)
def cancel_task(task_id: str, db: Session = Depends(get_db)) -> Task:
    """처리 중단 — Celery 작업 revoke + task.status='canceled'.

    pending: queue 에서 미실행 상태로 dequeue
    running: 워커에서 즉시 종료 (SIGTERM)
    이미 완료/실패/중단된 task 는 409.
    """
    row = db.get(TaskORM, task_id)
    if row is None:
        raise HTTPException(
            status_code=404,
            detail={
                "error": {
                    "code": "RESOURCE_NOT_FOUND",
                    "message": "작업을 찾을 수 없습니다",
                    "details": {"id": task_id},
                }
            },
        )
    if row.status not in ("pending", "running"):
        raise HTTPException(
            status_code=409,
            detail={
                "error": {
                    "code": "BUSINESS_RULE_VIOLATION",
                    "message": f"현재 상태({row.status})에서는 중단할 수 없습니다",
                    "details": {"task_id": task_id, "status": row.status},
                }
            },
        )

    # Celery worker 에 revoke 요청 (broker 다운 시 silently 무시 — DB 상태는 갱신).
    if row.celery_task_id:
        try:
            from app.workers.celery_app import celery_app

            celery_app.control.revoke(row.celery_task_id, terminate=True, signal="SIGTERM")
        except Exception as e:  # noqa: BLE001
            print(f"[cancel_task] Celery revoke failed: {e}")

    row.status = "canceled"
    row.finished_at = datetime.now(timezone.utc)
    db.commit()
    write_task_progress(
        get_settings(),
        task_id,
        progress=row.progress or 0,
        message="처리 중단됨",
        stage="canceled",
        detail={},
    )
    db.refresh(row)
    return _task_response(db, row, _task_detection_count(db, row.id))


@router.delete("/{task_id}")
def delete_task(task_id: str, db: Session = Depends(get_db)) -> dict[str, object]:
    """프로젝트(=task) 삭제.

    삭제 범위:
      - 본 task 의 sheet_codes 에 해당하면서, sheet.task_id == task_id 인 sheet 들의
        detection 행 삭제 + sheet 의 task 메타·메트릭 reset.
      - task row 자체 삭제.

    Celery 추론 중이면 revoke 를 요청한 뒤 DB row 와 task 산출물 폴더를 삭제.
    """
    row = db.get(TaskORM, task_id)
    if row is None:
        raise HTTPException(
            status_code=404,
            detail={
                "error": {
                    "code": "RESOURCE_NOT_FOUND",
                    "message": "작업을 찾을 수 없습니다",
                    "details": {"id": task_id},
                }
            },
        )

    settings = get_settings()
    if row.celery_task_id:
        try:
            from app.workers.celery_app import celery_app

            celery_app.control.revoke(row.celery_task_id, terminate=True, signal="SIGTERM")
        except Exception as e:  # noqa: BLE001
            print(f"[delete_task] Celery revoke failed: {e}")

    affected_sheets = (
        db.execute(
            select(MapSheetORM).where(
                MapSheetORM.code.in_(row.sheet_codes),
                MapSheetORM.task_id == task_id,
            )
        )
        .scalars()
        .all()
    )
    artifacts_deleted = delete_task_artifacts(settings, task_id)

    deleted_detections = 0
    for sheet in affected_sheets:
        dets = (
            db.execute(
                select(DetectionORM).where(
                    DetectionORM.sheet_code == sheet.code,
                    or_(
                        DetectionORM.task_id == task_id,
                        DetectionORM.task_id.is_(None),
                    ),
                )
            )
            .scalars()
            .all()
        )
        for d in dets:
            db.delete(d)
            deleted_detections += 1
        # sheet 의 task 메타 reset — 미사용 도엽으로 되돌림
        sheet.task_id = None
        sheet.models = None
        sheet.standard_resource_id = None
        sheet.compare_resource_id = None
        sheet.compare_type = None
        sheet.total_detections = 0
        sheet.f1_score = None
        sheet.precision = None
        sheet.recall = None

    db.delete(row)
    db.commit()
    return {
        "deleted": True,
        "id": task_id,
        "reset_sheets": [s.code for s in affected_sheets],
        "deleted_detections": deleted_detections,
        "deleted_artifacts": artifacts_deleted,
    }


@router.patch("/{task_id}", response_model=Task)
def update_task(
    task_id: str,
    payload: TaskUpdatePayload,
    db: Session = Depends(get_db),
) -> Task:
    """프로젝트(=task) 부분 수정 — name/description/과년도·당해년도 자원 변경."""
    row = db.get(TaskORM, task_id)
    if row is None:
        raise HTTPException(
            status_code=404,
            detail={
                "error": {
                    "code": "RESOURCE_NOT_FOUND",
                    "message": "작업을 찾을 수 없습니다",
                    "details": {"id": task_id},
                }
            },
        )
    data = payload.model_dump(exclude_unset=True)
    if "name" in data and data["name"] is not None:
        row.name = data["name"]
    if "description" in data and data["description"] is not None:
        row.description = data["description"]
    if "models" in data and data["models"] is not None:
        row.models = list(data["models"])
    if "standard_resource_id" in data:
        row.standard_resource_id = data["standard_resource_id"]
        if "standard_resource_ids" not in data:
            row.standard_resource_ids = (
                [data["standard_resource_id"]]
                if data["standard_resource_id"] is not None
                else []
            )
    if "compare_resource_id" in data:
        row.compare_resource_id = data["compare_resource_id"]
        if "compare_resource_ids" not in data:
            row.compare_resource_ids = (
                [data["compare_resource_id"]]
                if data["compare_resource_id"] is not None
                else []
            )
    if "standard_resource_ids" in data and data["standard_resource_ids"] is not None:
        row.standard_resource_ids = list(data["standard_resource_ids"])
        row.standard_resource_id = row.standard_resource_ids[0] if row.standard_resource_ids else None
    if "compare_resource_ids" in data and data["compare_resource_ids"] is not None:
        row.compare_resource_ids = list(data["compare_resource_ids"])
        row.compare_resource_id = row.compare_resource_ids[0] if row.compare_resource_ids else None
    try:
        _validate_disjoint_resource_ids(
            list(row.standard_resource_ids or []),
            list(row.compare_resource_ids or []),
        )
    except HTTPException:
        db.rollback()
        raise
    db.commit()
    db.refresh(row)
    return _task_response(db, row, _task_detection_count(db, row.id))
