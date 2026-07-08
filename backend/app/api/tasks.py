"""변화탐지 작업 라우터 — 읽기 + 등록 + 진행률 (이정표 4·5).

등록 시 Celery enqueue → 워커가 run_change_detection 실행.
진행률은 task.progress (DB) + Celery state 둘 중 fresh 한 값.
"""

from __future__ import annotations

import secrets
from datetime import datetime, timezone

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

    return [task_to_schema(r, counts.get(r.id, 0)) for r in rows]


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
    return task_to_schema(row, _task_detection_count(db, task_id))


@router.post("", response_model=Task, status_code=202)
def create_task(payload: TaskCreatePayload, db: Session = Depends(get_db)) -> Task:
    """위저드 등록 + Celery enqueue.

    유효성: 두 자원 sheet_codes 교집합 ≥ 1.
    """
    std = db.get(DatasetORM, payload.standard_resource_id)
    cmp_ = db.get(DatasetORM, payload.compare_resource_id)
    if std is None or cmp_ is None:
        raise HTTPException(
            status_code=404,
            detail={
                "error": {
                    "code": "RESOURCE_NOT_FOUND",
                    "message": "데이터셋을 찾을 수 없습니다",
                    "details": {
                        "standard_resource_id": payload.standard_resource_id,
                        "compare_resource_id": payload.compare_resource_id,
                    },
                }
            },
        )
    common = sorted(set(std.sheet_codes) & set(cmp_.sheet_codes))
    if not common:
        raise HTTPException(
            status_code=400,
            detail={
                "error": {
                    "code": "BUSINESS_RULE_VIOLATION",
                    "message": "두 자원의 공통 도엽이 없어 작업을 등록할 수 없습니다",
                    "details": {
                        "standard_id": payload.standard_resource_id,
                        "compare_id": payload.compare_resource_id,
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
        standard_resource_id=payload.standard_resource_id,
        compare_resource_id=payload.compare_resource_id,
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
        return task_to_schema(row, 0)

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

        async_result = run_change_detection.apply_async(
            args=[task_id],
            queue=settings.change_detection_queue,
        )
        row.celery_task_id = async_result.id
        db.commit()
        db.refresh(row)
    except Exception as e:
        # Celery worker 가 안 떠있어도 task row 는 남음 — 사용자가 재시도 가능.
        print(f"[create_task] Celery enqueue failed: {e}")

    return task_to_schema(row, 0)


@router.get("/{task_id}/status", response_model=Task)
def get_task_status(task_id: str, db: Session = Depends(get_db)) -> Task:
    """진행률 폴링용. DB row 의 status/progress 그대로 반환."""
    return get_task(task_id, db)


@router.post("/{task_id}/start", response_model=Task)
def start_task(task_id: str, db: Session = Depends(get_db)) -> Task:
    """처리 시작 — pending/canceled/failed 상태에서 Celery 작업 재큐.

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
    if row.status == "running":
        raise HTTPException(
            status_code=409,
            detail={
                "error": {
                    "code": "BUSINESS_RULE_VIOLATION",
                    "message": "이미 처리 중인 작업입니다",
                    "details": {"task_id": task_id, "status": row.status},
                }
            },
        )

    # 재시도면 이전 finished_at / celery_task_id / progress 초기화.
    row.status = "pending"
    row.progress = 0
    row.started_at = None
    row.finished_at = None
    row.celery_task_id = None
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
        )
        row.celery_task_id = async_result.id
        db.commit()
    except Exception as e:  # noqa: BLE001
        # Celery 다운 시 task 는 pending 상태로 남음 — 사용자가 재시도 가능.
        print(f"[start_task] Celery enqueue failed: {e}")

    db.refresh(row)
    return task_to_schema(row, _task_detection_count(db, row.id))


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
    return task_to_schema(row, _task_detection_count(db, row.id))


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
    if "compare_resource_id" in data:
        row.compare_resource_id = data["compare_resource_id"]
    db.commit()
    db.refresh(row)
    return task_to_schema(row, _task_detection_count(db, row.id))
