"""실감정사영상 산출물 자동 등록 — startup·주기·수동 스캔 공용 진입점.

흐름:
  1. settings.orthomosaic_dir 의 .tif/.tiff 파일 목록 조회
  2. 신규 파일은 upload_processor.process() 로 bbox·sheet_codes 추출 후 row insert
  3. 기존 파일은 현재 파일 기준으로 bbox·sheet_codes·size 등을 갱신
  4. 같은 원본 파일에 매달린 중복 row 는 task 참조가 없으면 제거
  5. 파일명 패턴 `{uuid}_orthomosaic_EPSG{epsg}_{YYYYMMDD}_{HHMMSS}.tif` 파싱:
     - taken_start_at / taken_end_at 에 촬영 시각 주입 (실패 시 파일 mtime)
  6. **고아 정리** — orthomosaic_dir 하위 tile_path 를 가진 aerial 데이터셋 중
     실제 파일이 사라진 row 는 자동 제거. 단, task 가 standard/compare 로 참조 중인
     row 는 보존하고 경고 로그만 (사용자가 task 정리 후 다시 호출).
"""
from __future__ import annotations

import logging
import os
import re
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.config import Settings
from app.models.dataset import DatasetORM
from app.models.task import TaskORM
from app.services.upload_processor import process as process_upload

logger = logging.getLogger(__name__)

IMAGE_EXTENSIONS = {".tif", ".tiff"}

# 파일명 끝부분 패턴: ..._{YYYYMMDD}_{HHMMSS}.tif
_FILENAME_TIMESTAMP_RE = re.compile(r"(\d{8})_(\d{6})\.tiff?$", re.IGNORECASE)
# 간단한 연도 접두사 패턴: 2024_Asan_clip.tif, 2025-foo.tif
_FILENAME_YEAR_PREFIX_RE = re.compile(r"^((?:19|20)\d{2})(?:[_-]|$)")


def _absolute_preserve_symlink(path: Path) -> str:
    """Absolute path string without following symlink targets."""
    return os.path.abspath(path)


def _same_existing_file(path: Path, existing_paths: set[str]) -> bool:
    for existing in existing_paths:
        existing_path = Path(existing)
        if not existing_path.exists():
            continue
        try:
            if os.path.samefile(path, existing_path):
                return True
        except OSError:
            continue
    return False


def _is_task_referenced(row: DatasetORM, db: Session) -> bool:
    ref = db.execute(
        select(TaskORM.id).where(
            or_(
                TaskORM.standard_resource_id == row.id,
                TaskORM.compare_resource_id == row.id,
                func.array_position(TaskORM.standard_resource_ids, row.id).is_not(None),
                func.array_position(TaskORM.compare_resource_ids, row.id).is_not(None),
            )
        ).limit(1)
    ).first()
    return ref is not None


def _select_primary(rows: list[DatasetORM], db: Session) -> DatasetORM:
    """Choose the row to keep when multiple rows point at the same file."""
    referenced = [row for row in rows if _is_task_referenced(row, db)]
    candidates = referenced or rows
    return sorted(candidates, key=lambda row: row.id)[0]


def _apply_current_metadata(
    row: DatasetORM,
    path: Path,
    bbox_wkt: str,
    sheet_codes: list[str],
) -> bool:
    """Apply file-derived metadata and return whether user-visible fields changed."""
    taken_at = _parse_taken_at(path)
    size_bytes = path.stat().st_size
    changed = (
        row.display_name != path.name
        or row.platform != "항공"
        or row.taken_start_at != taken_at
        or row.taken_end_at != taken_at
        or row.tile_path != str(path)
        or list(row.sheet_codes or []) != sheet_codes
        or row.status != "ready"
        or row.thumbnail_url is not None
        or row.size_bytes != size_bytes
    )
    row.display_name = path.name
    row.platform = "항공"
    row.taken_start_at = taken_at
    row.taken_end_at = taken_at
    row.bbox = f"SRID=5186;{bbox_wkt}"  # type: ignore[assignment]
    row.tile_path = str(path)
    row.sheet_codes = sheet_codes
    row.status = "ready"
    row.thumbnail_url = None
    row.size_bytes = size_bytes
    return changed


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
    year_match = _FILENAME_YEAR_PREFIX_RE.search(path.name)
    if year_match:
        return datetime(int(year_match.group(1)), 1, 1, tzinfo=timezone.utc)
    return datetime.fromtimestamp(path.stat().st_mtime, tz=timezone.utc)


def _cleanup_missing(root: Path, db: Session) -> tuple[int, int]:
    """orthomosaic_dir 하위 tile_path 를 갖는 dataset 중 파일이 사라진 row 정리.

    반환: (removed, blocked) — blocked 는 task 참조 때문에 보존된 건수.
    """
    root_str = _absolute_preserve_symlink(root).rstrip("/") + "/"
    rows = db.execute(
        select(DatasetORM).where(
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
                    func.array_position(TaskORM.standard_resource_ids, row.id).is_not(None),
                    func.array_position(TaskORM.compare_resource_ids, row.id).is_not(None),
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
        path = Path(row.tile_path) if row.tile_path else None
        if path is not None and path.is_symlink():
            try:
                path.unlink()
            except OSError as e:
                logger.warning(
                    "orthomosaic_registry: failed to remove broken symlink %s: %s",
                    row.tile_path,
                    e,
                )
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
    """orthomosaic_dir 스캔 → 신규 등록, 기존 row 현재화, 고아 row 제거.

    반환:
      scanned    — 디스크에서 발견된 .tif 개수
      registered — 신규 등록된 dataset row 수
      updated    — 기존 dataset row metadata 갱신 수
      skipped    — 이미 최신 상태라 건너뛴 row 수
      deduped    — 중복 tile_path 제거 row 수
      failed     — 처리 중 에러난 파일 수 (bbox 추출 실패 등)
      removed    — 파일이 사라졌거나 현재 등록 불가라 자동 삭제된 dataset row 수
      blocked    — task 참조 때문에 삭제하지 못하고 보존한 row 수
    """
    root = Path(settings.orthomosaic_dir)
    stats = {
        "scanned": 0,
        "registered": 0,
        "updated": 0,
        "skipped": 0,
        "deduped": 0,
        "failed": 0,
        "removed": 0,
        "blocked": 0,
    }

    if not root.exists() or not root.is_dir():
        logger.info(
            "orthomosaic_registry: scan skipped — directory not found (%s)", root
        )
        return stats

    existing_rows = db.execute(
        select(DatasetORM).where(DatasetORM.tile_path.is_not(None))
    ).scalars().all()
    existing_by_path: dict[str, list[DatasetORM]] = defaultdict(list)
    existing_by_real_path: dict[str, list[DatasetORM]] = defaultdict(list)
    for row in existing_rows:
        if not row.tile_path:
            continue
        existing_by_path[row.tile_path].append(row)
        existing_path = Path(row.tile_path)
        if not existing_path.exists():
            continue
        try:
            existing_by_real_path[str(existing_path.resolve())].append(row)
        except OSError:
            continue

    for entry in sorted(root.rglob("*")):
        if not entry.is_file():
            continue
        if entry.suffix.lower() not in IMAGE_EXTENSIONS:
            continue
        stats["scanned"] += 1
        abs_path = _absolute_preserve_symlink(entry)
        try:
            real_path = str(entry.resolve())
        except OSError:
            real_path = None

        matches: list[DatasetORM] = []
        seen_ids: set[int] = set()
        for row in existing_by_path.get(abs_path, []):
            matches.append(row)
            seen_ids.add(row.id)
        if real_path is not None:
            for row in existing_by_real_path.get(real_path, []):
                if row.id not in seen_ids:
                    matches.append(row)
                    seen_ids.add(row.id)
        if not matches:
            for row in existing_rows:
                if not row.tile_path or row.id in seen_ids:
                    continue
                if _same_existing_file(entry, {row.tile_path}):
                    matches.append(row)
                    seen_ids.add(row.id)

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
            for row in matches:
                if _is_task_referenced(row, db):
                    stats["blocked"] += 1
                    logger.warning(
                        "orthomosaic_registry: invalid current file but task references dataset #%d (%s) — keep row",
                        row.id,
                        row.display_name,
                    )
                    continue
                db.delete(row)
                stats["removed"] += 1
                logger.info(
                    "orthomosaic_registry: removed dataset #%d (%s) — current file no longer registerable",
                    row.id,
                    row.display_name,
                )
            if matches:
                try:
                    db.commit()
                except Exception as e:  # noqa: BLE001
                    db.rollback()
                    logger.warning(
                        "orthomosaic_registry: invalid-row cleanup commit failed %s: %s",
                        entry.name,
                        e,
                    )
            stats["failed"] += 1
            continue

        bbox_wkt = result.bbox_5186.wkt

        if matches:
            primary = _select_primary(matches, db)
            changed = _apply_current_metadata(primary, entry, bbox_wkt, result.sheet_codes)
            for duplicate in matches:
                if duplicate.id == primary.id:
                    continue
                if _is_task_referenced(duplicate, db):
                    stats["blocked"] += 1
                    logger.warning(
                        "orthomosaic_registry: duplicate dataset #%d references task — keep row",
                        duplicate.id,
                    )
                    continue
                db.delete(duplicate)
                stats["deduped"] += 1
                logger.info(
                    "orthomosaic_registry: removed duplicate dataset #%d for %s; kept #%d",
                    duplicate.id,
                    entry.name,
                    primary.id,
                )
            try:
                db.commit()
                if changed:
                    stats["updated"] += 1
                    logger.info(
                        "orthomosaic_registry: updated %s (dataset=%d sheets=%d)",
                        entry.name,
                        primary.id,
                        len(result.sheet_codes),
                    )
                else:
                    stats["skipped"] += 1
            except Exception as e:  # noqa: BLE001
                db.rollback()
                logger.warning(
                    "orthomosaic_registry: update commit failed %s: %s", entry.name, e
                )
                stats["failed"] += 1
            continue

        taken_at = _parse_taken_at(entry)
        size_bytes = entry.stat().st_size
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
            existing_rows.append(row)
            existing_by_path[abs_path].append(row)
            if real_path is not None:
                existing_by_real_path[real_path].append(row)
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
    stats["removed"] += removed
    stats["blocked"] += blocked

    logger.info("orthomosaic_registry: %s", stats)
    return stats
