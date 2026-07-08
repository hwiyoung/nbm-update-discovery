"""Smoke test the real change-detection adapter without writing detections to DB."""

from __future__ import annotations

import argparse
import json
from typing import Any

from sqlalchemy import select

from app.config import get_settings
from app.database import SessionLocal
from app.models.dataset import DatasetORM
from app.models.sheet import MapSheetORM
from app.models.task import TaskORM
from app.services.change_detection_engine import run_algorithm_category


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--task-id", default="")
    parser.add_argument("--sheet-code", default="")
    parser.add_argument(
        "--category",
        choices=["building", "road", "both"],
        default="building",
    )
    parser.add_argument("--crop-pixels", type=int, default=1024)
    parser.add_argument("--batch-size", type=int, default=1)
    args = parser.parse_args()

    settings = get_settings()
    settings.change_detection_crop_pixels = args.crop_pixels
    settings.change_detection_batch_size = args.batch_size
    settings.change_detection_engine_mode = "algorithm"

    db = SessionLocal()
    try:
        task = _load_task(db, args.task_id)
        std = db.get(DatasetORM, task.standard_resource_id)
        cmp_ = db.get(DatasetORM, task.compare_resource_id)
        if std is None or cmp_ is None or not std.tile_path or not cmp_.tile_path:
            raise RuntimeError("task datasets or tile_path are missing")

        sheet_code = args.sheet_code or (task.sheet_codes or [None])[0]
        if not sheet_code:
            raise RuntimeError("task has no sheet_codes")
        sheet = db.get(MapSheetORM, sheet_code)
        if sheet is None:
            raise RuntimeError(f"sheet not found: {sheet_code}")

        categories = ["building", "road"] if args.category == "both" else [args.category]
        summary: dict[str, Any] = {
            "task_id": task.id,
            "sheet_code": sheet_code,
            "crop_pixels": args.crop_pixels,
            "categories": {},
        }
        for category in categories:
            records = run_algorithm_category(
                settings=settings,
                task_id=f"smoke_{task.id}",
                category=category,
                standard_path=std.tile_path,
                compare_path=cmp_.tile_path,
                sheets=[sheet],
            )
            summary["categories"][category] = {
                "count": len(records),
                "first": records[0].__dict__ if records else None,
            }
        print(json.dumps(summary, ensure_ascii=False, indent=2))
        return 0
    finally:
        db.close()


def _load_task(db: Any, task_id: str) -> TaskORM:
    if task_id:
        task = db.get(TaskORM, task_id)
        if task is None:
            raise RuntimeError(f"task not found: {task_id}")
        return task
    task = (
        db.execute(select(TaskORM).order_by(TaskORM.created_at.desc()).limit(1))
        .scalars()
        .first()
    )
    if task is None:
        raise RuntimeError("no task found")
    return task


if __name__ == "__main__":
    raise SystemExit(main())
