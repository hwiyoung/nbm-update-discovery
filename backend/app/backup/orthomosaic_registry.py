"""실감정사영상 산출물 자동 등록 — startup·주기·수동 스캔 공용 진입점.

흐름:
  1. settings.orthomosaic_dir 의 .tif/.tiff 파일 목록 조회
  2. 이미 datasets.tile_path 에 등록된 경로는 skip
  3. 신규 파일은 upload_processor.process() 로 bbox·sheet_codes 추출
  4. 성공 시 source='aerial', status='ready' 로 DatasetORM row insert
  5. 파일명 패턴 `{uuid}_orthomosaic_EPSG{epsg}_{YYYYMMDD}_{HHMMSS}.tif` 파싱:
     - taken_start_at / taken_end_at 에 촬영 시각 주입 (실패 시 파일 mtime)
  6. **고아 정리** — orthomosaic_dir 하위 tile_path 를 가진 aerial 데이터셋 중
     실제 파일이 사라진 row 는 자동 제거. 단, task 가 standard/compare 로 참조 중인
     row 는 보존하고 경고 로그만 (사용자가 task 정리 후 다시 호출).
"""
from __future__ import annotations

import logging
import re
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.config import Settings
from app.models.dataset import DatasetORM
from app.models.task import TaskORM
from app.services.upload_processor import process as process_upload

logger = logging.getLogger(__name__)

IMAGE_EXTENSIONS = {".tif", ".tiff"}

# 파일명 끝부분 패턴: ..._{YYYYMMDD}_{HHMMSS}.tif
_FILENAME_TIMESTAMP_RE = re.compile(r"(\d{8})_(\d{6})\.tiff?$", re.IGNORECASE)


def _parse_taken_at(path: Path) -> datetime:
    """파일명에서 촬영 시각 추출 — 실패 시 파일 mtime fallback."""
    m = _FILENAME_TIMESTAMP_RE.search(path.name)
    if m:
        try:
            return datetime.strptime(m.group(1) + m.group(2), "%Y%m%d%H%M%S").replace(
                tzinfo=timezone.utc
            )
        except ValueError:
            pass
    return datetime.fromtimestamp(path.stat().st_mtime, tz=timezone.utc)


def _cleanup_missing(root: Path, db: Session) -> tuple[int, int]:
    """orthomosaic_dir 하위 tile_path 를 갖는 aerial dataset 중 파일이 사라진 row 정리.

    반환: (removed, blocked) — blocked 는 task 참조 때문에 보존된 건수.
    """
    root_str = str(root.resolve()).rstrip("/") + "/"
    rows = db.execute(
        select(DatasetORM).where(
            DatasetORM.source == "aerial",
            DatasetORM.tile_path.is_not(None),
            DatasetORM.tile_path.startswith(root_str),
        )
    ).scalars().all()

    removed = 0
    blocked = 0
    for row in rows:
        if row.tile_path and Path(row.tile_path).exists():
            continue
        # 파일 사라짐 — task 참조 여부 확인
        ref = db.execute(
            select(TaskORM.id).where(
                or_(
                    TaskORM.standard_resource_id == row.id,
                    TaskORM.compare_resource_id == row.id,
                )
            ).limit(1)
        ).first()
        if ref is not None:
            blocked += 1
            logger.warning(
                "orthomosaic_registry: file missing but task %s references dataset #%d (%s) — skip removal",
                ref[0], row.id, row.display_name,
            )
            continue
        db.delete(row)
        removed += 1
        logger.info(
            "orthomosaic_registry: removed dataset #%d (%s) — file missing",
            row.id, row.display_name,
        )
    if removed or blocked:
        try:
            db.commit()
        except Exception as e:  # noqa: BLE001
            db.rollback()
            logger.warning("orthomosaic_registry: cleanup commit failed: %s", e)
            return 0, blocked
    return removed, blocked


def scan_and_register(settings: Settings, db: Session) -> dict[str, int]:
    """orthomosaic_dir 스캔 → 신규 .tif 등록 + 사라진 파일에 대응되는 row 제거.

    반환:
      scanned    — 디스크에서 발견된 .tif 개수
      registered — 신규 등록된 dataset row 수
      skipped    — 이미 등록되어 있어 건너뛴 row 수
      failed     — 처리 중 에러난 파일 수 (bbox 추출 실패 등)
      removed    — 파일이 사라져 자동 삭제된 dataset row 수
      blocked    — 파일은 사라졌지만 task 참조 중이라 보존된 row 수
    """
    root = Path(settings.orthomosaic_dir)
    stats = {"scanned": 0, "registered": 0, "skipped": 0, "failed": 0, "removed": 0, "blocked": 0}

    if not root.exists() or not root.is_dir():
        logger.info(
            "orthomosaic_registry: scan skipped — directory not found (%s)", root
        )
        return stats

    # 이미 등록된 tile_path 집합 — O(1) 조회용
    existing_paths: set[str] = {
        row[0]
        for row in db.execute(
            select(DatasetORM.tile_path).where(DatasetORM.tile_path.is_not(None))
        ).all()
    }

    for entry in sorted(root.iterdir()):
        if not entry.is_file():
            continue
        if entry.suffix.lower() not in IMAGE_EXTENSIONS:
            continue
        stats["scanned"] += 1
        abs_path = str(entry.resolve())
        if abs_path in existing_paths:
            stats["skipped"] += 1
            continue

        try:
            result = process_upload(entry, db)
        except Exception as e:  # noqa: BLE001 — 한 파일이 깨져도 나머지는 진행
            logger.warning("orthomosaic_registry: process failed %s: %s", entry.name, e)
            stats["failed"] += 1
            continue

        if result.bbox_5186 is None or not result.sheet_codes:
            logger.warning(
                "orthomosaic_registry: skip %s — %s",
                entry.name,
                result.error or "no_sheet_codes",
            )
            stats["failed"] += 1
            continue

        taken_at = _parse_taken_at(entry)
        size_bytes = entry.stat().st_size
        bbox_wkt = result.bbox_5186.wkt

        row = DatasetORM(
            source="aerial",
            display_name=entry.name,
            platform="항공",
            taken_start_at=taken_at,
            taken_end_at=taken_at,
            bbox=f"SRID=5186;{bbox_wkt}",  # type: ignore[arg-type]
            tile_path=abs_path,
            sheet_codes=result.sheet_codes,
            status="ready",
            thumbnail_url=None,
            size_bytes=size_bytes,
        )
        db.add(row)
        try:
            db.commit()
            stats["registered"] += 1
            logger.info(
                "orthomosaic_registry: registered %s (sheets=%d)",
                entry.name,
                len(result.sheet_codes),
            )
        except Exception as e:  # noqa: BLE001
            db.rollback()
            logger.warning(
                "orthomosaic_registry: db commit failed %s: %s", entry.name, e
            )
            stats["failed"] += 1

    # 사라진 파일에 대응되는 row 정리
    removed, blocked = _cleanup_missing(root, db)
    stats["removed"] = removed
    stats["blocked"] = blocked

    logger.info("orthomosaic_registry: %s", stats)
    return stats