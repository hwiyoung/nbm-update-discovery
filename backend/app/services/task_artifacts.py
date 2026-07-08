"""Filesystem helpers for task-scoped generated artifacts."""

from __future__ import annotations

import logging
import json
import shutil
from pathlib import Path
from typing import Any

from shapely import wkt
from shapely.geometry import mapping

from app.config import Settings

logger = logging.getLogger(__name__)


class UnsafeTaskArtifactPathError(ValueError):
    """Raised when a task artifact path escapes the configured workspace root."""


def task_artifact_dir(settings: Settings, task_id: str) -> Path:
    """Return the task-scoped artifact directory under the workspace root."""
    root = Path(settings.change_detection_workspace_root).resolve()
    target = (root / task_id).resolve()
    try:
        target.relative_to(root)
    except ValueError as exc:
        raise UnsafeTaskArtifactPathError(
            f"task artifact path escapes workspace root: {task_id}"
        ) from exc
    return target


def delete_task_artifacts(settings: Settings, task_id: str) -> bool:
    """Delete all generated files for one task.

    Returns True when a directory was removed, False when nothing existed.
    """
    target = task_artifact_dir(settings, task_id)
    if not target.exists():
        return False
    if target.is_symlink() or not target.is_dir():
        raise OSError(f"task artifact path is not a directory: {target}")
    shutil.rmtree(target)
    logger.info("deleted task artifact directory task=%s path=%s", task_id, target)
    return True


def write_category_detection_geojson(
    settings: Settings,
    task_id: str,
    category: str,
    records: list[Any],
) -> Path:
    """Write one merged EPSG:5186 GeoJSON result for a model category."""

    target = task_artifact_dir(settings, task_id) / f"{category}.geojson"
    target.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "type": "FeatureCollection",
        "crs": {"type": "name", "properties": {"name": "EPSG:5186"}},
        "features": [
            {
                "type": "Feature",
                "properties": {
                    "sheet_code": record.sheet_code,
                    "model": record.model,
                    "change_type": record.change_type,
                    "confidence": record.confidence,
                    "area_m2": record.area_m2,
                    "region_code": record.region_code,
                    "address": record.address,
                    "memo": record.memo,
                },
                "geometry": mapping(wkt.loads(record.geometry_wkt_5186)),
            }
            for record in records
        ],
    }
    tmp_path = target.with_suffix(".geojson.tmp")
    tmp_path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    tmp_path.replace(target)
    return target


def compact_success_artifacts(
    settings: Settings,
    task_id: str,
    categories: list[str],
) -> list[str]:
    """Remove heavy successful-run intermediates and keep merged model results."""

    root = task_artifact_dir(settings, task_id)
    removed: list[str] = []
    input_dir = root / "input"
    if input_dir.exists():
        shutil.rmtree(input_dir)
        removed.append("input")
    for category in categories:
        category_dir = root / category
        if category_dir.exists():
            shutil.rmtree(category_dir)
            removed.append(category)
    return removed
