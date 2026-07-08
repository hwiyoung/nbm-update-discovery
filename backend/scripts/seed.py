"""정적 더미 JSON → PostGIS 시드.

실행: docker compose exec backend python scripts/seed.py

전제: alembic upgrade head 가 먼저 실행되어 테이블이 생성되어 있어야 함.
입력 파일은 frontend/public/data/ 아래 (compose volume 으로 backend 컨테이너에는
보이지 않으므로 호스트에서 docker cp 또는 별도 마운트 필요. 본 스크립트는
환경변수 SEED_DATA_ROOT 로 경로 오버라이드 가능, 기본값은 /data/seed).
"""

from __future__ import annotations

import json
import os
from datetime import datetime
from pathlib import Path
from typing import Any

from pyproj import Transformer
from shapely.geometry import shape
from shapely.ops import transform
from sqlalchemy.orm import Session

from app.database import SessionLocal
from app.models.dataset import DatasetORM
from app.models.detection import DetectionORM
from app.models.sheet import MapSheetORM
from app.models.task import TaskORM
from app.utils.geo import geojson_4326_to_5186_wkt

SEED_ROOT = Path(os.getenv("SEED_DATA_ROOT", "/data/seed"))
SEED_INCLUDE_DEMO = os.getenv("SEED_INCLUDE_DEMO", "false").lower() in {"1", "true", "yes", "y"}
SHEET_GRID_PATH = Path(os.getenv("SHEET_INDEX_PATH", str(SEED_ROOT / "sheets_grid_5179.geojson")))
_TO_5186_FROM_5179 = Transformer.from_crs(5179, 5186, always_xy=True)


def _read_json(path: Path) -> Any:
    with path.open(encoding="utf-8") as f:
        return json.load(f)


def _parse_iso(v: str | None) -> datetime | None:
    if not v:
        return None
    if v.endswith("Z"):
        v = v[:-1] + "+00:00"
    return datetime.fromisoformat(v)


def seed_grid_sheets(db: Session) -> int:
    if not SHEET_GRID_PATH.exists():
        return 0

    data = _read_json(SHEET_GRID_PATH)
    count = 0
    for feature in data.get("features", []):
        props = feature.get("properties") or {}
        code = props.get(os.getenv("SHEET_CODE_FIELD", "MAPIDCD_NO"))
        if not code:
            continue
        code = str(code)
        sheet_name = f"도엽-{code}"
        existing = db.get(MapSheetORM, code)
        if existing:
            if existing.task_id is None and existing.name != sheet_name:
                existing.name = sheet_name
            continue

        geom_5179 = shape(feature["geometry"])
        geom_5186 = transform(_TO_5186_FROM_5179.transform, geom_5179)
        if geom_5186.geom_type == "MultiPolygon":
            geom_5186 = max(geom_5186.geoms, key=lambda g: g.area)
        if geom_5186.is_empty or geom_5186.area <= 0:
            continue

        region = str(props.get("layer") or "").replace(" 권역", "") or "미분류"
        row = MapSheetORM(
            code=code,
            name=sheet_name,
            region=region,
            geometry=f"SRID=5186;{geom_5186.wkt}",
            area_km2=float(geom_5186.area) / 1_000_000.0,
            review_status="pending",
            reviewer=None,
            reviewed_at=None,
            task_id=None,
            models=[],
            compare_type="image-image",
            standard_resource_id=None,
            compare_resource_id=None,
            f1_score=None,
            precision=None,
            recall=None,
            total_detections=0,
            reviewed_detections=0,
            tp_count=0,
            fp_count=0,
            fn_count=0,
        )
        db.add(row)
        count += 1
    db.commit()
    return count


def seed_demo_sheets(db: Session) -> int:
    path = SEED_ROOT / "sheets" / "index.json"
    data = _read_json(path)
    count = 0
    for s in data["sheets"]:
        wkt = geojson_4326_to_5186_wkt(s["geometry"])
        existing = db.get(MapSheetORM, s["code"])
        if existing:
            if SEED_INCLUDE_DEMO:
                existing.name = s["name"]
                existing.region = s["region"]
                existing.review_status = s.get("review_status", "pending")
                existing.reviewer = s.get("reviewer")
                existing.reviewed_at = _parse_iso(s.get("reviewed_at"))
                existing.task_id = s["task_id"]
                existing.models = s.get("models", [])
                existing.compare_type = s.get("compare_type", "image-image")
                existing.standard_resource_id = s["standard_resource_id"]
                existing.compare_resource_id = s["compare_resource_id"]
                existing.f1_score = s.get("f1_score")
                existing.precision = s.get("precision")
                existing.recall = s.get("recall")
                existing.total_detections = s.get("total_detections", 0)
                existing.reviewed_detections = s.get("reviewed_detections", 0)
                existing.tp_count = s.get("tp_count", 0)
                existing.fp_count = s.get("fp_count", 0)
                existing.fn_count = s.get("fn_count", 0)
            continue
        row = MapSheetORM(
            code=s["code"],
            name=s["name"],
            region=s["region"],
            geometry=f"SRID=5186;{wkt}",
            area_km2=s.get("area_km2", 0.0),
            review_status=s.get("review_status", "pending"),
            reviewer=s.get("reviewer"),
            reviewed_at=_parse_iso(s.get("reviewed_at")),
            task_id=s["task_id"],
            models=s.get("models", []),
            compare_type=s.get("compare_type", "image-image"),
            standard_resource_id=s["standard_resource_id"],
            compare_resource_id=s["compare_resource_id"],
            f1_score=s.get("f1_score"),
            precision=s.get("precision"),
            recall=s.get("recall"),
            total_detections=s.get("total_detections", 0),
            reviewed_detections=s.get("reviewed_detections", 0),
            tp_count=s.get("tp_count", 0),
            fp_count=s.get("fp_count", 0),
            fn_count=s.get("fn_count", 0),
        )
        db.add(row)
        count += 1
    db.commit()
    return count


def seed_sheets(db: Session) -> int:
    count = seed_grid_sheets(db)
    if count > 0:
        if SEED_INCLUDE_DEMO:
            seed_demo_sheets(db)
        return count
    if SEED_INCLUDE_DEMO:
        return seed_demo_sheets(db)
    return 0


def seed_detections(db: Session) -> int:
    sheets_dir = SEED_ROOT / "sheets"
    count = 0
    for sheet_dir in sheets_dir.iterdir():
        if not sheet_dir.is_dir():
            continue
        det_path = sheet_dir / "detections.json"
        if not det_path.exists():
            continue
        items = _read_json(det_path)
        for d in items:
            existing = db.get(DetectionORM, d["id"])
            if existing:
                continue
            wkt = geojson_4326_to_5186_wkt(d["geometry"])
            row = DetectionORM(
                id=d["id"],
                sheet_code=d["sheet_code"],
                model=d["model"],
                change_type=d["change_type"],
                confidence=d["confidence"],
                area_m2=d["area_m2"],
                geometry=f"SRID=5186;{wkt}",
                region_code=d.get("region_code", ""),
                address=d.get("address", ""),
                error_class=d.get("error_class"),
                reviewer_memo=d.get("reviewer_memo", ""),
                reviewed_by=d.get("reviewed_by"),
                reviewed_at=_parse_iso(d.get("reviewed_at")),
                is_user_added=d.get("is_user_added", False),
                is_deleted=d.get("is_deleted", False),
            )
            db.add(row)
            count += 1
    db.commit()
    return count


def seed_datasets(db: Session) -> int:
    path = SEED_ROOT / "datasets" / "index.json"
    if not path.exists():
        return 0
    data = _read_json(path)
    count = 0
    for d in data["datasets"]:
        existing = db.get(DatasetORM, d["id"])
        if existing:
            continue
        wkt = geojson_4326_to_5186_wkt(d["bbox"])
        row = DatasetORM(
            id=d["id"],
            source=d["source"],
            display_name=d["display_name"],
            platform=d.get("platform", ""),
            taken_start_at=_parse_iso(d["taken_start_at"]),
            taken_end_at=_parse_iso(d["taken_end_at"]),
            bbox=f"SRID=5186;{wkt}",
            tile_path=d.get("tile_path"),
            sheet_codes=d.get("sheet_codes", []),
            status=d.get("status", "ready"),
            thumbnail_url=d.get("thumbnail_url"),
            size_bytes=d.get("size_bytes"),
        )
        db.add(row)
        count += 1
    db.commit()
    return count


def seed_tasks(db: Session) -> int:
    path = SEED_ROOT / "tasks" / "index.json"
    if not path.exists():
        return 0
    data = _read_json(path)
    count = 0
    for t in data["tasks"]:
        existing = db.get(TaskORM, t["id"])
        if existing:
            continue
        # PROMPTS 의 status 값을 BACKEND_API 의 TaskStatus 로 매핑.
        status_map = {"succeeded": "succeeded", "running": "running", "failed": "failed", "pending": "pending"}
        row = TaskORM(
            id=t["id"],
            name=t["name"],
            description=t.get("description", ""),
            models=t.get("models", []),
            compare_type=t.get("compare_type", "image-image"),
            standard_resource_id=t["standard_resource_id"],
            compare_resource_id=t["compare_resource_id"],
            sheet_codes=t.get("sheet_codes", []),
            status=status_map.get(t.get("status", "pending"), "pending"),
            progress=t.get("progress", 0),
            created_at=_parse_iso(t["created_at"]) or datetime.utcnow(),
            finished_at=_parse_iso(t.get("finished_at")),
            celery_task_id=t.get("celery_task_id"),
        )
        db.add(row)
        count += 1
    db.commit()
    return count


def main() -> None:
    if not SEED_ROOT.exists():
        raise SystemExit(
            f"시드 루트 경로가 없습니다: {SEED_ROOT}\n"
            "SEED_DATA_ROOT 환경변수 또는 docker-compose volume 마운트 확인."
        )

    print(f"[seed] root: {SEED_ROOT}")
    db = SessionLocal()
    try:
        n_sheets = seed_sheets(db)
        print(f"[seed] sheets: {n_sheets}")
        if SEED_INCLUDE_DEMO:
            n_det = seed_detections(db)
            print(f"[seed] detections: {n_det}")
            n_ds = seed_datasets(db)
            print(f"[seed] datasets: {n_ds}")
            n_task = seed_tasks(db)
            print(f"[seed] tasks: {n_task}")
        else:
            print("[seed] demo data: skipped")
        print("[seed] done.")
    finally:
        db.close()


if __name__ == "__main__":
    main()
