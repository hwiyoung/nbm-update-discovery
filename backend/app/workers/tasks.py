"""Celery 작업 정의.

run_change_detection(task_id):
  1. task row 가져오기
  2. compare_resource_id 의 sheet_codes 로 대상 도엽 결정 (또는 standard ∩ compare 교집합)
  3. 실제 변화탐지 알고리즘 호출 → 폴리곤 GeoJSON 받음
  4. 도엽별 DetectionORM INSERT
  5. MapSheetORM total_detections 갱신, task.status='succeeded', progress=100
"""

from __future__ import annotations

import secrets
import shutil
import subprocess
import sys
import time
from concurrent.futures import Future, ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path
from queue import Empty, Queue
from threading import Event
from types import SimpleNamespace
from typing import Any

from sqlalchemy import select

from app.config import get_settings
from app.database import SessionLocal
from app.models.dataset import DatasetORM
from app.models.detection import DetectionORM
from app.models.history import ReviewHistoryORM
from app.models.sheet import MapSheetORM
from app.models.task import TaskORM
from app.services.change_type_mapping import resolve_change_type
from app.services.sheet_stats import recompute_sheet_stats
from app.services.task_artifacts import (
    compact_success_artifacts,
    task_artifact_dir,
    write_category_detection_geojson,
)
from app.services.task_progress import write_task_progress
from app.utils.geo import bbox_from_geometry, geojson_4326_to_5186_wkt, wkb_to_geojson_4326
from app.workers.celery_app import celery_app

from sqlalchemy import delete

# Legacy mock engine import. The real algorithm runtime is resolved from
# CHANGE_DETECTION_ALGORITHM_ROOT in app.services.change_detection_engine.
LEGACY_MOCK_ENGINE_PATH = Path("/engines/change-detection")
if str(LEGACY_MOCK_ENGINE_PATH) not in sys.path:
    sys.path.insert(0, str(LEGACY_MOCK_ENGINE_PATH))

try:
    from run import run as run_engine  # type: ignore[import-not-found]
except ImportError:  # 컨테이너에 마운트 안 된 환경 fallback
    run_engine = None  # type: ignore[assignment]


def _gen_id() -> str:
    return f"obj_{secrets.token_hex(8)}"


def _purge_non_user_detections(db: Any, task_id: str) -> None:
    """재실행 시 엔진 출력만 정리하고 검수자가 직접 추가한 FN 폴리곤은 보존."""
    purged_ids = [
        r[0]
        for r in db.execute(
            select(DetectionORM.id).where(
                DetectionORM.task_id == task_id,
                DetectionORM.is_user_added.is_(False),
            )
        ).all()
    ]
    if not purged_ids:
        return
    db.execute(
        delete(ReviewHistoryORM).where(
            ReviewHistoryORM.object_id.in_(purged_ids)
        )
    )
    db.execute(delete(DetectionORM).where(DetectionORM.id.in_(purged_ids)))
    db.commit()


MODEL_LABELS = {
    "shared": "공통 입력",
    "building": "건물 변화탐지",
    "road": "도로 변화탐지",
}

ALGORITHM_TASK_LABELS = {
    "preflight in progress": "풋프린트·해상도 점검 중",
    "sheet manifest in progress": "도엽 처리 범위 계산 중",
    "resampling in progress": "12cm 리샘플링·도엽 칩 생성 중",
    "resampling done": "도엽 칩 생성 완료",
    "algorithm starting": "모델 실행 준비 중",
    "patch in progress": "패치 생성 중",
    "inference in progress": "추론 중",
    "reconstruct in progress": "결과 재구성 중",
    "vectorize in progress": "벡터화 중",
    "patch done": "패치 생성 완료",
    "inference done": "추론 완료",
    "reconstruct done": "벡터화 진행 중",
    "process completed": "알고리즘 처리 완료",
}

MIN_VISIBLE_ALGORITHM_STAGE_SECONDS = 2.0
MIN_VISIBLE_ALGORITHM_STAGES = {"patch", "reconstruct"}


def _safe_int(value: Any, default: int = 0) -> int:
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return default


def _algorithm_stage(status: dict[str, Any]) -> str:
    current_task = str(status.get("CurrentTask") or "").lower()
    if "preflight" in current_task:
        return "preflight"
    if "manifest" in current_task:
        return "sheet_manifest"
    if "resampling" in current_task:
        return "resampling"
    if "algorithm starting" in current_task:
        return "algorithm_starting"
    if "patch" in current_task:
        return "patch"
    if "inference" in current_task:
        return "inference"
    if "reconstruct" in current_task:
        return "reconstruct"
    if "vectorize" in current_task:
        return "vectorize"
    if "completed" in current_task or str(status.get("Status")) == "done":
        return "algorithm_done"
    if str(status.get("Status")) == "failed":
        return "algorithm_failed"
    return "algorithm"


def _algorithm_message(category: str, status: dict[str, Any]) -> str:
    label = MODEL_LABELS.get(category, category)
    detail_message = str(status.get("DetailMessage") or "")
    if detail_message:
        return f"{label} · {detail_message}"
    current_task = str(status.get("CurrentTask") or "")
    task_label = ALGORITHM_TASK_LABELS.get(current_task, current_task)
    if task_label:
        return f"{label} · {task_label}"
    if str(status.get("Status")) == "pending":
        return f"{label} · 준비 중"
    return f"{label} · 알고리즘 실행 중"


def _overall_algorithm_progress(category_index: int, category_count: int, process: int) -> int:
    process = max(0, min(100, process))
    span = 90.0 / max(1, category_count)
    start = 5.0 + (category_index * span)
    return max(5, min(95, round(start + (span * process / 100.0))))


def _parallel_algorithm_progress(model_processes: dict[str, int]) -> int:
    if not model_processes:
        return 5
    total = sum(max(0, min(100, process)) for process in model_processes.values())
    return max(5, min(95, round(5 + (90.0 * total / (100 * len(model_processes))))))


def _configured_shared_gpu_id(settings: Any) -> str:
    return str(getattr(settings, "change_detection_parallel_gpu_id", "") or "").strip()


def _idle_shared_cuda_device_id(settings: Any) -> str | None:
    explicit = _configured_shared_gpu_id(settings)
    if explicit:
        return explicit

    limit = float(getattr(settings, "change_detection_parallel_gpu_memory_limit", 0.25))
    try:
        result = subprocess.run(
            [
                "nvidia-smi",
                "--query-gpu=index,memory.used,memory.total",
                "--format=csv,noheader,nounits",
            ],
            check=True,
            capture_output=True,
            text=True,
            timeout=5,
        )
    except (OSError, subprocess.SubprocessError, ValueError):
        return None

    for line in result.stdout.splitlines():
        parts = [part.strip() for part in line.split(",")]
        if len(parts) < 3:
            continue
        try:
            used = float(parts[1])
            total = float(parts[2])
        except ValueError:
            continue
        if total > 0 and (used / total) <= limit:
            return parts[0]
    return None


def _parallel_category_process_envs(
    settings: Any,
    categories: list[str],
) -> dict[str, dict[str, str]]:
    if not bool(getattr(settings, "change_detection_parallel_models", False)):
        return {}
    if len(categories) < 2:
        return {}

    device_id = _idle_shared_cuda_device_id(settings)
    if not device_id:
        return {}

    return {
        category: {
            "CUDA_DEVICE_ORDER": "PCI_BUS_ID",
            "CUDA_VISIBLE_DEVICES": device_id,
        }
        for category in categories
    }


@celery_app.task(bind=True, name="nbm.run_change_detection")
def run_change_detection(self, task_id: str) -> dict[str, Any]:
    """변화탐지 작업 실행 — 실제 알고리즘 결과를 DB INSERT."""
    db = SessionLocal()
    try:
        task = db.get(TaskORM, task_id)
        if task is None:
            return {"status": "failed", "error": "task not found"}
        if task.status == "canceled":
            return {"status": "canceled", "task_id": task_id}

        settings = get_settings()
        if task.started_at is None:
            task.started_at = datetime.now(timezone.utc)
        task.status = "running"
        task.progress = 5
        current_celery_id = getattr(getattr(self, "request", None), "id", None)
        if current_celery_id:
            task.celery_task_id = current_celery_id
        db.commit()
        write_task_progress(
            settings,
            task_id,
            progress=5,
            message="추론 작업 준비 중",
            stage="starting",
            detail={},
        )
        self.update_state(state="STARTED", meta={"progress": 5})

        std = db.get(DatasetORM, task.standard_resource_id)
        cmp_ = db.get(DatasetORM, task.compare_resource_id)
        if std is None or cmp_ is None:
            task.status = "failed"
            db.commit()
            return {"status": "failed", "error": "datasets not found"}
        standard_tile_path = str(std.tile_path or "")
        compare_tile_path = str(cmp_.tile_path or "")

        std_set = set(std.sheet_codes)
        cmp_set = set(cmp_.sheet_codes)
        common_codes = std_set & cmp_set
        requested_codes = set(task.sheet_codes or [])
        target_codes = sorted(
            common_codes & requested_codes if requested_codes else common_codes
        )
        if not target_codes:
            task.status = "failed"
            db.commit()
            return {"status": "failed", "error": "no overlapping sheets"}

        task.sheet_codes = target_codes
        db.commit()

        engine_mode = settings.change_detection_engine_mode.strip().lower()
        if engine_mode == "algorithm":
            return _run_algorithm_detection(
                self=self,
                db=db,
                task=task,
                task_id=task_id,
                settings=settings,
                std=std,
                cmp_=cmp_,
                standard_tile_path=standard_tile_path,
                compare_tile_path=compare_tile_path,
                target_codes=target_codes,
            )
        if engine_mode != "mock":
            raise ValueError(
                "unsupported CHANGE_DETECTION_ENGINE_MODE: "
                f"{settings.change_detection_engine_mode}"
            )

        _purge_non_user_detections(db, task_id)

        total_inserted = 0
        for idx, code in enumerate(target_codes):
            sheet = db.get(MapSheetORM, code)
            if sheet is None:
                continue
            geom_4326 = wkb_to_geojson_4326(getattr(sheet.geometry, "desc", sheet.geometry))
            if not geom_4326:
                continue
            sheet_bbox = bbox_from_geometry(geom_4326)

            # 엔진 호출 — 모델 카테고리 별로 1회씩. 엔진 output 은 다음 두 형식 모두
            # 호환 (change_type_mapping 의 표준 정책):
            #   1) {"change_type": "building_new", ...}  (legacy mock)
            #   2) {"type": "1" | 1, ...}                (표준 — manual import 와 동일)
            for category in task.models:
                polygons = _call_engine(sheet_bbox, category)
                for poly in polygons:
                    # change_type 결정 — 직접 부여됐으면 사용, 아니면 model+type 매핑.
                    ct = poly.get("change_type")
                    if not ct:
                        ct = resolve_change_type(category, poly.get("type"))
                    if not ct:
                        continue  # 알 수 없는 매핑 — 폴리곤 skip
                    wkt = geojson_4326_to_5186_wkt(poly["geometry"])
                    det = DetectionORM(
                        id=_gen_id(),
                        sheet_code=code,
                        task_id=task_id,
                        model=category,
                        change_type=ct,
                        confidence=float(poly.get("confidence") or poly.get("accuracy") or 0),
                        area_m2=float(poly.get("area_m2") or poly.get("area") or 0),
                        geometry=f"SRID=5186;{wkt}",  # type: ignore[arg-type]
                        region_code=str(poly.get("region_code") or ""),
                        address=str(poly.get("address") or ""),
                        reviewer_memo=str(poly.get("memo") or ""),
                        is_user_added=False,
                        is_deleted=False,
                    )
                    db.add(det)
                    total_inserted += 1

            db.flush()
            recompute_sheet_stats(db, code)
            db.commit()

            # 진행률 갱신
            progress = 5 + int((idx + 1) / max(1, len(target_codes)) * 90)
            task.progress = progress
            db.commit()
            self.update_state(state="PROGRESS", meta={"progress": progress})

        task.status = "succeeded"
        task.progress = 100
        task.finished_at = datetime.now(timezone.utc)
        db.commit()

        return {
            "status": "succeeded",
            "task_id": task_id,
            "sheet_codes": target_codes,
            "total_inserted": total_inserted,
        }

    except Exception as e:
        db.rollback()
        task = db.get(TaskORM, task_id)
        if task is not None:
            task.status = "failed"
            db.commit()
            write_task_progress(
                get_settings(),
                task_id,
                progress=task.progress or 0,
                message=f"추론 실패: {e}",
                stage="failed",
                detail={"error": str(e)},
            )
        return {"status": "failed", "error": str(e)}
    finally:
        db.close()


def _run_algorithm_detection(
    *,
    self: Any,
    db: Any,
    task: TaskORM,
    task_id: str,
    settings: Any,
    std: DatasetORM,
    cmp_: DatasetORM,
    standard_tile_path: str,
    compare_tile_path: str,
    target_codes: list[str],
) -> dict[str, Any]:
    """실제 변화탐지 알고리즘 경로.

    알고리즘이 성공적으로 끝난 뒤에만 기존 엔진 결과를 purge 하므로, 추론 실패가
    기존 검수 결과를 지우지 않는다.
    """
    if not standard_tile_path or not compare_tile_path:
        task.status = "failed"
        db.commit()
        return {"status": "failed", "error": "dataset tile_path missing"}

    from app.services.change_detection_engine import (
        prepare_shared_algorithm_inputs,
        run_algorithm_category,
    )

    sheet_rows = (
        db.execute(select(MapSheetORM).where(MapSheetORM.code.in_(target_codes)))
        .scalars()
        .all()
    )
    sheet_by_code = {sheet.code: sheet for sheet in sheet_rows}
    target_sheets = [
        SimpleNamespace(
            code=sheet_by_code[code].code,
            geometry=getattr(
                sheet_by_code[code].geometry,
                "desc",
                sheet_by_code[code].geometry,
            ),
        )
        for code in target_codes
        if code in sheet_by_code
    ]
    if not target_sheets:
        task.status = "failed"
        db.commit()
        return {"status": "failed", "error": "no target sheets found"}

    categories = [m for m in task.models if m in ("building", "road")]
    if not categories:
        task.status = "failed"
        db.commit()
        return {"status": "failed", "error": "no supported models selected"}

    artifact_root = task_artifact_dir(settings, task_id)
    for category in categories:
        category_workspace = artifact_root / category
        if category_workspace.exists():
            shutil.rmtree(category_workspace)

    last_progress = task.progress or 0
    last_message = ""
    last_stage = ""
    last_stage_at = 0.0
    last_write_at = 0.0
    analysis_detail: dict[str, Any] | None = None

    def update_progress(
        *,
        progress: int,
        message: str,
        stage: str,
        detail: dict[str, Any] | None = None,
        force: bool = False,
    ) -> None:
        nonlocal analysis_detail, last_progress, last_message, last_stage, last_stage_at, last_write_at
        now = time.monotonic()
        progress = max(last_progress, max(5, min(99, int(progress))))
        detail_payload = dict(detail or {})
        if isinstance(detail_payload.get("analysis"), dict):
            analysis_detail = detail_payload["analysis"]
        elif analysis_detail is not None:
            detail_payload["analysis"] = analysis_detail
        if (
            not force
            and progress == last_progress
            and message == last_message
            and stage == last_stage
            and now - last_write_at < 2.0
        ):
            return
        if (
            not force
            and stage != last_stage
            and last_stage in MIN_VISIBLE_ALGORITHM_STAGES
        ):
            remaining = MIN_VISIBLE_ALGORITHM_STAGE_SECONDS - (now - last_stage_at)
            if remaining > 0:
                time.sleep(remaining)
                now = time.monotonic()
        task.progress = progress
        db.commit()
        write_task_progress(
            settings,
            task_id,
            progress=progress,
            message=message,
            stage=stage,
            detail=detail_payload,
        )
        self.update_state(
            state="PROGRESS",
            meta={
                "progress": progress,
                "message": message,
                "stage": stage,
                "detail": detail_payload,
            },
        )
        last_progress = progress
        last_message = message
        if stage != last_stage:
            last_stage = stage
            last_stage_at = now
        last_write_at = now

    def on_algorithm_status(
        *,
        category: str,
        category_index: int,
        status: dict[str, Any],
    ) -> None:
        process = _safe_int(status.get("Process"), 0)
        progress = _overall_algorithm_progress(
            category_index,
            len(categories),
            process,
        )
        progress = max(last_progress, progress)
        detail = {
            "model": category,
            "model_label": MODEL_LABELS.get(category, category),
            "model_index": category_index + 1,
            "model_count": len(categories),
            "algorithm_process": process,
            "algorithm_status": status.get("Status"),
            "current_task": status.get("CurrentTask"),
            "current_step": status.get("Current_step"),
            "total_step": status.get("Total_step"),
            "elapsed_time": status.get("ElapsedTime"),
            "final_name": status.get("final_name"),
            "phase_message": status.get("DetailMessage"),
            "source": status.get("source"),
            "rgb_nodata_color": status.get("rgb_nodata_color"),
            "rgb_nodata_tolerance": status.get("rgb_nodata_tolerance"),
            "polygon_count": status.get("polygon_count"),
            "chip_index": status.get("chip_index"),
            "chip_count": status.get("chip_count"),
            "block_index": status.get("block_index"),
            "block_count": status.get("block_count"),
            "skipped": status.get("skipped"),
            "skip_reason": status.get("skip_reason"),
            "t1_valid_pixel_count": status.get("t1_valid_pixel_count"),
            "t2_valid_pixel_count": status.get("t2_valid_pixel_count"),
            "skipped_count": status.get("skipped_count"),
            "target_gsd_m": status.get("target_gsd_m"),
            "buffer_m": status.get("buffer_m"),
            "resampling": status.get("resampling"),
            "prepare_mode": status.get("prepare_mode"),
            "intersection_area_m2": status.get("intersection_area_m2"),
            "analysis": status.get("analysis"),
        }
        update_progress(
            progress=progress,
            message=_algorithm_message(category, status),
            stage=_algorithm_stage(status),
            detail=detail,
        )

    all_records = []
    records_by_category: dict[str, list[Any]] = {}
    prepared_inputs = None
    if settings.change_detection_prepare_mode.strip().lower() in {
        "legacy",
        "full",
        "full-image",
        "sheet",
        "sheet_12cm",
        "sheet-chips",
        "sheet_chips",
    }:
        update_progress(
            progress=5,
            message="공통 입력 준비 중",
            stage="preparing",
            detail={
                "model": "shared",
                "model_label": "공통 입력",
                "model_index": 0,
                "model_count": len(categories),
                "algorithm_process": 0,
                "prepare_mode": settings.change_detection_prepare_mode,
            },
            force=True,
        )
        prepared_inputs = prepare_shared_algorithm_inputs(
            settings=settings,
            task_id=task_id,
            standard_path=standard_tile_path,
            compare_path=compare_tile_path,
            sheets=target_sheets,
            progress_callback=lambda status: on_algorithm_status(
                category="shared",
                category_index=0,
                status=status,
            ),
        )

    parallel_envs = _parallel_category_process_envs(settings, categories)
    if parallel_envs:
        model_processes = {category: 0 for category in categories}
        progress_events: Queue[tuple[str, int, dict[str, Any]]] = Queue()
        cancel_event = Event()

        update_progress(
            progress=_parallel_algorithm_progress(model_processes),
            message="모델 병렬 실행 준비 중",
            stage="preparing",
            detail={
                "parallel": True,
                "gpu_mode": "single",
                "model_count": len(categories),
                "model_processes": model_processes.copy(),
                "shared_gpu_id": next(iter(parallel_envs.values())).get(
                    "CUDA_VISIBLE_DEVICES"
                ),
            },
            force=True,
        )

        def run_one_category(idx: int, category: str) -> tuple[str, list[Any]]:
            return (
                category,
                run_algorithm_category(
                    settings=settings,
                    task_id=task_id,
                    category=category,
                    standard_path=standard_tile_path,
                    compare_path=compare_tile_path,
                    sheets=target_sheets,
                    prepared_inputs=prepared_inputs,
                    process_env=parallel_envs[category],
                    cancel_event=cancel_event,
                    progress_callback=lambda status: progress_events.put(
                        (category, idx, status)
                    ),
                ),
            )

        error: Exception | None = None
        with ThreadPoolExecutor(max_workers=len(categories)) as executor:
            futures: dict[Future[tuple[str, list[Any]]], tuple[int, str]] = {}
            for idx, category in enumerate(categories):
                futures[executor.submit(run_one_category, idx, category)] = (idx, category)

            while futures:
                try:
                    category, idx, status = progress_events.get(timeout=0.5)
                except Empty:
                    pass
                else:
                    process = _safe_int(status.get("Process"), 0)
                    model_processes[category] = max(
                        model_processes.get(category, 0),
                        process,
                    )
                    detail = {
                        "parallel": True,
                        "gpu_mode": "single",
                        "gpu_id": parallel_envs[category].get("CUDA_VISIBLE_DEVICES"),
                        "model_processes": model_processes.copy(),
                        "model": category,
                        "model_label": MODEL_LABELS.get(category, category),
                        "model_index": idx + 1,
                        "model_count": len(categories),
                        "algorithm_process": process,
                        "algorithm_status": status.get("Status"),
                        "current_task": status.get("CurrentTask"),
                        "current_step": status.get("Current_step"),
                        "total_step": status.get("Total_step"),
                        "elapsed_time": status.get("ElapsedTime"),
                        "final_name": status.get("final_name"),
                        "phase_message": status.get("DetailMessage"),
                        "source": status.get("source"),
                        "rgb_nodata_color": status.get("rgb_nodata_color"),
                        "rgb_nodata_tolerance": status.get("rgb_nodata_tolerance"),
                        "polygon_count": status.get("polygon_count"),
                        "chip_index": status.get("chip_index"),
                        "chip_count": status.get("chip_count"),
                        "block_index": status.get("block_index"),
                        "block_count": status.get("block_count"),
                        "skipped": status.get("skipped"),
                        "skip_reason": status.get("skip_reason"),
                        "t1_valid_pixel_count": status.get("t1_valid_pixel_count"),
                        "t2_valid_pixel_count": status.get("t2_valid_pixel_count"),
                        "skipped_count": status.get("skipped_count"),
                        "target_gsd_m": status.get("target_gsd_m"),
                        "buffer_m": status.get("buffer_m"),
                        "resampling": status.get("resampling"),
                        "prepare_mode": status.get("prepare_mode"),
                        "intersection_area_m2": status.get("intersection_area_m2"),
                        "analysis": status.get("analysis"),
                    }
                    update_progress(
                        progress=_parallel_algorithm_progress(model_processes),
                        message=_algorithm_message(category, status),
                        stage=_algorithm_stage(status),
                        detail=detail,
                    )

                done_futures = [future for future in futures if future.done()]
                for future in done_futures:
                    idx, category = futures.pop(future)
                    label = MODEL_LABELS.get(category, category)
                    try:
                        _, records = future.result()
                    except Exception as exc:
                        if error is None:
                            error = exc
                        cancel_event.set()
                        print(
                            f"[worker] parallel category failed: "
                            f"category={category} error={exc}",
                            flush=True,
                        )
                        update_progress(
                            progress=last_progress,
                            message=f"{label} · 실패",
                            stage="algorithm_failed",
                            detail={
                                "parallel": True,
                                "gpu_mode": "single",
                                "model": category,
                                "model_label": label,
                                "model_index": idx + 1,
                                "model_count": len(categories),
                                "error": str(exc),
                            },
                            force=True,
                        )
                    else:
                        records_by_category[category] = records
                        model_processes[category] = 100
                        update_progress(
                            progress=_parallel_algorithm_progress(model_processes),
                            message=f"{label} · 완료",
                            stage="algorithm_done",
                            detail={
                                "parallel": True,
                                "gpu_mode": "single",
                                "gpu_id": parallel_envs[category].get("CUDA_VISIBLE_DEVICES"),
                                "model_processes": model_processes.copy(),
                                "model": category,
                                "model_label": label,
                                "model_index": idx + 1,
                                "model_count": len(categories),
                                "algorithm_process": 100,
                                "record_count": len(records),
                            },
                            force=True,
                        )

                if error is not None:
                    cancel_event.set()

        if error is not None:
            raise error
        for category in categories:
            all_records.extend(records_by_category.get(category, []))
    else:
        for idx, category in enumerate(categories):
            label = MODEL_LABELS.get(category, category)
            update_progress(
                progress=_overall_algorithm_progress(idx, len(categories), 0),
                message=f"{label} · 준비 중",
                stage="preparing",
                detail={
                    "model": category,
                    "model_label": label,
                    "model_index": idx + 1,
                    "model_count": len(categories),
                    "algorithm_process": 0,
                    "parallel": False,
                },
                force=True,
            )
            records = run_algorithm_category(
                settings=settings,
                task_id=task_id,
                category=category,
                standard_path=standard_tile_path,
                compare_path=compare_tile_path,
                sheets=target_sheets,
                prepared_inputs=prepared_inputs,
                progress_callback=lambda status, category=category, idx=idx: on_algorithm_status(
                    category=category,
                    category_index=idx,
                    status=status,
                ),
            )
            records_by_category[category] = records
            all_records.extend(records)
            update_progress(
                progress=_overall_algorithm_progress(idx, len(categories), 100),
                message=f"{label} · 완료",
                stage="algorithm_done",
                detail={
                    "model": category,
                    "model_label": label,
                    "model_index": idx + 1,
                    "model_count": len(categories),
                    "algorithm_process": 100,
                    "record_count": len(records),
                    "parallel": False,
                },
                force=True,
            )

    update_progress(
        progress=96,
        message="통합 탐지 결과 저장 중",
        stage="saving",
        detail={"model_count": len(categories), "record_count": len(all_records)},
        force=True,
    )
    merged_artifacts: dict[str, str] = {}
    for category in categories:
        merged_path = write_category_detection_geojson(
            settings,
            task_id,
            category,
            records_by_category.get(category, []),
        )
        merged_artifacts[category] = str(merged_path)

    _purge_non_user_detections(db, task_id)

    total_inserted = 0
    for record in all_records:
        det = DetectionORM(
            id=_gen_id(),
            sheet_code=record.sheet_code,
            task_id=task_id,
            model=record.model,
            change_type=record.change_type,
            confidence=record.confidence,
            area_m2=record.area_m2,
            geometry=f"SRID=5186;{record.geometry_wkt_5186}",  # type: ignore[arg-type]
            region_code=record.region_code,
            address=record.address,
            reviewer_memo=record.memo,
            is_user_added=False,
            is_deleted=False,
        )
        db.add(det)
        total_inserted += 1

    db.flush()
    for code in target_codes:
        recompute_sheet_stats(db, code)
    removed_artifacts: list[str] = []
    artifact_cleanup_error: str | None = None
    try:
        removed_artifacts = compact_success_artifacts(settings, task_id, categories)
    except OSError as exc:
        artifact_cleanup_error = str(exc)
        print(
            f"[worker] artifact cleanup failed: task={task_id} error={exc}",
            flush=True,
        )
    task.status = "succeeded"
    task.progress = 100
    task.finished_at = datetime.now(timezone.utc)
    db.commit()
    final_detail: dict[str, Any] = {
        "model_count": len(categories),
        "record_count": total_inserted,
        "merged_artifacts": merged_artifacts,
        "removed_artifacts": removed_artifacts,
    }
    if analysis_detail is not None:
        final_detail["analysis"] = analysis_detail
    if artifact_cleanup_error is not None:
        final_detail["artifact_cleanup_error"] = artifact_cleanup_error
    write_task_progress(
        settings,
        task_id,
        progress=100,
        message="추론 완료",
        stage="done",
        detail=final_detail,
    )
    self.update_state(state="PROGRESS", meta={"progress": 100})

    return {
        "status": "succeeded",
        "task_id": task_id,
        "sheet_codes": target_codes,
        "total_inserted": total_inserted,
        "engine_mode": "algorithm",
    }


def _call_engine(sheet_bbox: list[float], category: str) -> list[dict[str, Any]]:
    """Legacy mock 엔진 호출. /engines/change-detection/run.py 의 run() 사용.

    Fallback: 엔진 마운트 안 된 경우 직접 무작위 폴리곤 생성.
    """
    if run_engine is not None:
        return run_engine(bbox=sheet_bbox, category=category)
    # 매우 간단한 fallback — 사실상 사용 안 됨
    time.sleep(0.1)
    return []
