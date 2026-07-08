"""Runtime progress metadata for change-detection tasks."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from app.config import Settings
from app.services.task_artifacts import task_artifact_dir


def progress_path(settings: Settings, task_id: str) -> Path:
    return task_artifact_dir(settings, task_id) / "progress.json"


def write_task_progress(
    settings: Settings,
    task_id: str,
    *,
    progress: int,
    message: str,
    stage: str,
    detail: dict[str, Any] | None = None,
) -> None:
    """Write a small sidecar file that API serializers can expose live.

    The DB remains the source for task status/progress. This file carries volatile
    UI labels and raw algorithm status details without requiring a migration.
    """
    path = progress_path(settings, task_id)
    payload = {
        "progress": max(0, min(100, int(progress))),
        "message": message,
        "stage": stage,
        "detail": detail or {},
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp_path = path.with_suffix(".json.tmp")
        tmp_path.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        tmp_path.replace(path)
    except OSError as exc:
        print(f"[task-progress] write failed task={task_id}: {exc}", flush=True)


def read_task_progress(settings: Settings, task_id: str) -> dict[str, Any] | None:
    path = progress_path(settings, task_id)
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
