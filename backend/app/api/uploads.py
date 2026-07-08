"""파일 업로드 라우터 — multipart 수신 + bbox/sheet_codes 자동 추출.

흐름:
  POST /api/v1/uploads (multipart: file, display_name, platform, taken_start_at, taken_end_at)
  1. 파일을 ORTHOMOSAIC_DIR 에 저장
  2. rasterio 로 bbox + CRS 추출 (5186 변환)
  3. PostGIS ST_Intersects 로 도엽 격자 교집합 → sheet_codes
  4. 성공: status='ready' + 메타·sheet_codes 채워서 datasets row 생성
     실패: status='failed' + thumbnail_url 에 사유 임시 저장 (전용 컬럼 없어 우회)
"""

from __future__ import annotations

import os
import secrets
import shutil
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.config import get_settings
from app.database import get_db
from app.models.dataset import DatasetORM
from app.models.sheet import MapSheetORM
from app.schemas import Dataset
from app.services.serializers import dataset_to_schema
from app.services.upload_processor import process as process_upload
from sqlalchemy import distinct, select, text

router = APIRouter(prefix="/uploads", tags=["uploads"])


def _ensure_upload_root() -> Path:
    settings = get_settings()
    root = Path(settings.orthomosaic_dir)
    root.mkdir(parents=True, exist_ok=True)
    return root


def _upload_filename(filename: str | None) -> str:
    safe_name = Path(filename or "upload.tif").name
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")
    return f"{stamp}_{secrets.token_hex(4)}_{safe_name}"


@router.post("", response_model=Dataset, status_code=201)
def upload_file(
    file: UploadFile = File(...),
    display_name: str = Form(...),
    platform: str = Form(...),
    taken_start_at: str = Form(...),
    taken_end_at: str = Form(...),
    db: Session = Depends(get_db),
) -> Dataset:
    """정사영상 파일 + 메타 → bbox·sheet_codes 자동 → datasets row 생성."""
    # 메타 검증
    try:
        start = datetime.fromisoformat(taken_start_at.replace("Z", "+00:00"))
        end = datetime.fromisoformat(taken_end_at.replace("Z", "+00:00"))
    except ValueError as e:
        raise HTTPException(
            status_code=422,
            detail={
                "error": {
                    "code": "VALIDATION_ERROR",
                    "message": f"잘못된 날짜 형식: {e}",
                    "details": {"taken_start_at": taken_start_at, "taken_end_at": taken_end_at},
                }
            },
        ) from e

    # 파일 저장
    upload_root = _ensure_upload_root()
    safe_name = Path(file.filename or "upload.tif").name
    target = upload_root / _upload_filename(file.filename)
    with target.open("wb") as out:
        shutil.copyfileobj(file.file, out)
    size_bytes = os.path.getsize(target)

    # bbox + sheet_codes 자동 추출
    result = process_upload(target, db)

    if result.error and result.bbox_5186 is None:
        # 치명적 처리 실패 — 파일 삭제 + 422 (사용자가 다시 시도 가능)
        try:
            target.unlink()
        except OSError:
            pass
        raise HTTPException(
            status_code=422,
            detail={
                "error": {
                    "code": "VALIDATION_ERROR",
                    "message": result.error,
                    "details": {"filename": safe_name},
                }
            },
        )

    # bbox 는 추출됐는데 sheet_codes 가 비면 status='failed' 로 row 생성
    # (사용자가 데이터셋 카드에서 사유 확인 가능)
    is_failed = not result.sheet_codes
    bbox_wkt = result.bbox_5186.wkt  # type: ignore[union-attr]

    row = DatasetORM(
        source="upload",
        display_name=display_name,
        platform=platform,
        taken_start_at=start,
        taken_end_at=end,
        bbox=f"SRID=5186;{bbox_wkt}",  # type: ignore[arg-type]
        tile_path=str(target),
        sheet_codes=result.sheet_codes,
        status="failed" if is_failed else "ready",
        # 실패 사유를 thumbnail_url 에 임시 저장 (전용 컬럼 없어 우회).
        # 정식 컬럼 도입 시 alembic 마이그레이션 + schema 추가.
        thumbnail_url=result.error if is_failed else None,
        size_bytes=size_bytes,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return dataset_to_schema(row)


class RegionPreviewResponse(BaseModel):
    """파일의 bbox + 매칭되는 권역(들). 위저드에서 등록 전 미리보기."""
    bbox_5186: list[float]
    """[left, bottom, right, top] in EPSG:5186."""
    regions: list[str]
    """겹치는 행정 권역 이름 — 예: ['수도권남부'].
    중복 없이 sorted. 빈 배열이면 한반도 격자와 인터섹션 없음."""
    sheet_count: int
    """겹치는 1:5000 도엽 개수 (참고용)."""
    error: str | None = None


@router.get("/preview-region", response_model=RegionPreviewResponse)
def preview_capture_region(
    server_path: str,
    db: Session = Depends(get_db),
) -> RegionPreviewResponse:
    """서버 path 의 영상에서 bbox 읽고 매칭 권역 반환 — 등록 전 미리보기.

    실제 등록과 같은 process_upload() 함수를 재사용 (rasterio + transform_bounds +
    PostGIS ST_Intersects). 한반도 외 좌표면 error 필드에 사유.
    """
    from app.api.filesystem import _within_allowed_root

    target = Path(server_path)
    if not _within_allowed_root(str(target.resolve())):
        raise HTTPException(403, f"허용된 경로 밖: {server_path}")
    if not target.exists() or not target.is_file():
        raise HTTPException(404, f"파일 없음: {server_path}")

    result = process_upload(target, db)
    if result.bbox_5186 is None:
        return RegionPreviewResponse(
            bbox_5186=[0, 0, 0, 0],
            regions=[],
            sheet_count=0,
            error=result.error,
        )

    bounds = result.bbox_5186.bounds  # (left, bottom, right, top)
    regions: list[str] = []
    if result.sheet_codes:
        rows = db.execute(
            select(distinct(MapSheetORM.region)).where(
                MapSheetORM.code.in_(result.sheet_codes)
            )
        ).all()
        regions = sorted({r[0] for r in rows if r[0]})

    return RegionPreviewResponse(
        bbox_5186=[bounds[0], bounds[1], bounds[2], bounds[3]],
        regions=regions,
        sheet_count=len(result.sheet_codes),
        error=result.error,
    )


class RegisterFromServerPayload(BaseModel):
    """POST /uploads/from-server — 서버 측 기존 파일을 업로드 저장소에 링크 후 등록."""
    server_path: str
    display_name: str
    platform: str = "항공"
    taken_start_at: str
    taken_end_at: str


def _absolute_preserve_symlink(path: Path) -> Path:
    """Return an absolute path without resolving symlink targets."""
    return Path(os.path.abspath(path))


def _is_under_path(path: Path, root: Path) -> bool:
    try:
        _absolute_preserve_symlink(path).relative_to(_absolute_preserve_symlink(root))
    except ValueError:
        return False
    return True


def _points_to_source(path: Path, source: Path) -> bool:
    if not path.exists() and not path.is_symlink():
        return False
    try:
        if path.exists() and source.exists() and os.path.samefile(path, source):
            return True
        return path.resolve() == source.resolve()
    except OSError:
        return False


def _available_link_path(upload_root: Path, filename: str, source: Path) -> Path:
    base = upload_root / Path(filename).name
    if _points_to_source(base, source):
        return base
    if not base.exists() and not base.is_symlink():
        return base

    suffix = base.suffix
    stem = base.stem
    for idx in range(2, 1000):
        candidate = upload_root / f"{stem}__link{idx}{suffix}"
        if _points_to_source(candidate, source):
            return candidate
        if not candidate.exists() and not candidate.is_symlink():
            return candidate
    raise OSError(f"사용 가능한 링크 파일명을 찾지 못했습니다: {base.name}")


def _link_server_file(source: Path, upload_root: Path) -> tuple[Path, Path | None]:
    """Return the dataset path and the newly-created symlink, if any."""
    source_abs = _absolute_preserve_symlink(source)
    if _is_under_path(source_abs, upload_root):
        return source_abs, None

    target = _available_link_path(upload_root, source_abs.name, source_abs)
    if _points_to_source(target, source_abs):
        return target, None

    target.symlink_to(source_abs.resolve())
    return target, target


def _find_existing_dataset_for_source(db: Session, source: Path) -> DatasetORM | None:
    """Find a dataset whose tile_path already points at the same on-disk file."""
    try:
        source_real = source.resolve()
    except OSError:
        return None

    rows = db.execute(
        select(DatasetORM).where(DatasetORM.tile_path.is_not(None))
    ).scalars().all()
    for row in rows:
        if not row.tile_path:
            continue
        tile_path = Path(row.tile_path)
        if not tile_path.exists():
            continue
        try:
            if os.path.samefile(tile_path, source) or tile_path.resolve() == source_real:
                return row
        except OSError:
            continue
    return None


@router.post("/from-server", response_model=Dataset, status_code=201)
def register_from_server_path(
    payload: RegisterFromServerPayload,
    db: Session = Depends(get_db),
) -> Dataset:
    """ServerFileBrowser 에서 선택한 파일을 orthomosaic 링크로 등록."""
    # 메타 검증
    try:
        start = datetime.fromisoformat(payload.taken_start_at.replace("Z", "+00:00"))
        end = datetime.fromisoformat(payload.taken_end_at.replace("Z", "+00:00"))
    except ValueError as e:
        raise HTTPException(422, f"잘못된 날짜 형식: {e}") from e

    # 경로 보안 검증 (filesystem.py 와 동일 규칙)
    from app.api.filesystem import _within_allowed_root
    source = Path(payload.server_path)
    if not _within_allowed_root(str(source.resolve())):
        raise HTTPException(403, f"허용된 경로 밖: {payload.server_path}")
    if not source.exists() or not source.is_file():
        raise HTTPException(404, f"파일 없음: {payload.server_path}")
    if source.suffix.lower() not in {".tif", ".tiff"}:
        raise HTTPException(422, f"TIFF 파일만 등록할 수 있습니다: {payload.server_path}")

    existing = _find_existing_dataset_for_source(db, source)
    if existing is not None:
        return dataset_to_schema(existing)

    upload_root = _ensure_upload_root()
    try:
        target, created_link = _link_server_file(source, upload_root)
    except OSError as e:
        raise HTTPException(
            500,
            {
                "error": {
                    "code": "UPLOAD_LINK_FAILED",
                    "message": f"선택한 영상을 업로드 저장소에 링크하지 못했습니다: {e}",
                    "details": {"source_path": str(source), "upload_root": str(upload_root)},
                }
            },
        ) from e

    size_bytes = target.stat().st_size

    # bbox + sheet_codes 자동 추출
    try:
        result = process_upload(target, db)
    except Exception as e:  # noqa: BLE001
        if created_link is not None:
            try:
                created_link.unlink()
            except OSError:
                pass
        raise HTTPException(
            422,
            {
                "error": {
                    "code": "PROCESSING_FAILED",
                    "message": f"링크된 영상 처리에 실패했습니다: {e}",
                    "details": {"source_path": str(source), "linked_path": str(target)},
                }
            },
        ) from e

    if result.error and result.bbox_5186 is None:
        if created_link is not None:
            try:
                created_link.unlink()
            except OSError:
                pass
        raise HTTPException(
            422,
            {
                "error": {
                    "code": "VALIDATION_ERROR",
                    "message": result.error,
                    "details": {"source_path": str(source), "linked_path": str(target)},
                }
            },
        )

    is_failed = not result.sheet_codes
    bbox_wkt = result.bbox_5186.wkt  # type: ignore[union-attr]
    row = DatasetORM(
        source="aerial",
        display_name=payload.display_name,
        platform=payload.platform,
        taken_start_at=start,
        taken_end_at=end,
        bbox=f"SRID=5186;{bbox_wkt}",  # type: ignore[arg-type]
        tile_path=str(target),
        sheet_codes=result.sheet_codes,
        status="failed" if is_failed else "ready",
        thumbnail_url=result.error if is_failed else None,
        size_bytes=size_bytes,
    )
    db.add(row)
    try:
        db.commit()
    except Exception:  # noqa: BLE001
        db.rollback()
        if created_link is not None:
            try:
                created_link.unlink()
            except OSError:
                pass
        raise
    db.refresh(row)
    return dataset_to_schema(row)
