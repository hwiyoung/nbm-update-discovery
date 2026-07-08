"""파일시스템 browse API — 서버 측 디렉토리 탐색.

aerial-survey-manager 패턴: 사용자가 PC 파일 input 대신, 서버(컨테이너)에
마운트된 폴더를 직접 탐색해 TIFF 파일을 선택. 선택된 파일은 업로드 저장소로
복사된 뒤 일반 업로드와 같은 방식으로 등록된다.

허용 root: /media, /mnt, /data/storage, /data/orthomosaic.
첫 화면은 기본적으로 /media/dell 직하위의 마운트된 디스크만 노출한다.
"""
from __future__ import annotations

import os
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, HTTPException, Query, status
from pydantic import BaseModel

router = APIRouter(prefix="/filesystem", tags=["Filesystem"])

# 영상 확장자
IMAGE_EXTENSIONS = {".tif", ".tiff", ".jpg", ".jpeg", ".png"}

# 컨테이너 안에서 허용되는 root 경로 — docker-compose 의 volume mount 와 일치.
# root 목록은 /media/dell 직하위 마운트를 우선 노출한다. /mnt, /data/storage,
# /data/orthomosaic 은 직접 browse 요청과 dataset path validation 용으로 유지한다.
ALLOWED_ROOTS = ["/media", "/mnt", "/data/storage", "/data/orthomosaic"]
MEDIA_ROOT = Path(os.getenv("FILESYSTEM_MEDIA_ROOT", "/media"))
MEDIA_USER_ROOT = Path(os.getenv("FILESYSTEM_MEDIA_USER_ROOT", "/media/dell"))

SKIP_PREFIXES = ("snap-", "loop", ".")


def _within_allowed_root(path: str) -> bool:
    resolved = str(Path(path).resolve())
    return any(
        resolved == root or resolved.startswith(root.rstrip("/") + "/")
        for root in ALLOWED_ROOTS
    )


def _disk_usage(path: str) -> tuple[Optional[float], Optional[float]]:
    try:
        stat = os.statvfs(path)
        total = stat.f_blocks * stat.f_frsize
        used = total - (stat.f_bavail * stat.f_frsize)
        return round(total / (1024**3), 1), round(used / (1024**3), 1)
    except (OSError, PermissionError):
        return None, None


def _root_entry(path: Path) -> RootEntry:
    total, used = _disk_usage(str(path))
    return RootEntry(
        name=path.name,
        path=str(path),
        label=path.name,
        total_gb=total,
        used_gb=used,
    )


def _list_direct_mount_roots(parent: Path) -> list[RootEntry]:
    roots: list[RootEntry] = []
    try:
        for entry in parent.iterdir():
            if entry.name.startswith(SKIP_PREFIXES) or not entry.is_dir():
                continue
            roots.append(_root_entry(entry))
    except PermissionError:
        return roots
    return roots


class FileEntry(BaseModel):
    name: str
    path: str
    is_dir: bool
    size: Optional[int] = None
    modified: Optional[float] = None


class BrowseResponse(BaseModel):
    current_path: str
    parent_path: Optional[str] = None
    entries: list[FileEntry]
    image_count: int = 0


class RootEntry(BaseModel):
    name: str
    path: str
    label: str
    total_gb: Optional[float] = None
    used_gb: Optional[float] = None


class RootsResponse(BaseModel):
    roots: list[RootEntry]
    hint: str = "마운트된 디스크에서 TIFF 파일을 선택하세요."


@router.get("/roots", response_model=RootsResponse)
def get_filesystem_roots() -> RootsResponse:
    """접근 가능한 root 폴더 목록.

    운영 PC 기준으로는 /media/dell/<disk>만 첫 화면에 보여준다. 개발 장비처럼
    /media/dell이 없으면 기존 Ubuntu auto-mount 패턴(/media/<user>/<device>)을
    한 단계만 평탄화해서 fallback 한다.
    """
    roots: list[RootEntry] = []
    if MEDIA_USER_ROOT.exists() and MEDIA_USER_ROOT.is_dir():
        return RootsResponse(roots=_list_direct_mount_roots(MEDIA_USER_ROOT))

    if not MEDIA_ROOT.exists():
        return RootsResponse(roots=roots)

    try:
        for user_dir in MEDIA_ROOT.iterdir():
            if user_dir.name.startswith(SKIP_PREFIXES) or not user_dir.is_dir():
                continue
            try:
                devices = [
                    d for d in user_dir.iterdir()
                    if d.is_dir() and not d.name.startswith(SKIP_PREFIXES)
                ]
            except PermissionError:
                devices = []
            if devices:
                for dev in devices:
                    roots.append(_root_entry(dev))
            else:
                # /media 바로 아래 device 가 있는 경우 (단일 단계)
                roots.append(_root_entry(user_dir))
    except PermissionError:
        pass

    return RootsResponse(roots=roots)


@router.get("/browse", response_model=BrowseResponse)
def browse_filesystem(
    path: str = Query(..., description="탐색할 디렉토리 경로"),
) -> BrowseResponse:
    """디렉토리 listing — 하위 폴더 + TIFF 등 영상 파일만."""
    target = Path(path).resolve()
    if not _within_allowed_root(str(target)):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"허용된 경로 밖입니다 ({', '.join(ALLOWED_ROOTS)})",
        )
    if ".." in Path(path).parts:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="상위 경로(..) 접근 차단",
        )
    if not target.exists():
        raise HTTPException(404, f"경로 없음: {path}")
    if not target.is_dir():
        raise HTTPException(400, f"디렉토리가 아닙니다: {path}")

    entries: list[FileEntry] = []
    image_count = 0
    try:
        for entry in os.scandir(str(target)):
            try:
                st = entry.stat(follow_symlinks=False)
            except (PermissionError, OSError):
                continue
            if entry.name.startswith("."):
                continue
            if entry.is_dir(follow_symlinks=False):
                entries.append(FileEntry(
                    name=entry.name,
                    path=str(Path(entry.path).resolve()),
                    is_dir=True,
                    modified=st.st_mtime,
                ))
            elif entry.is_file(follow_symlinks=False):
                ext = Path(entry.name).suffix.lower()
                if ext in IMAGE_EXTENSIONS:
                    image_count += 1
                    entries.append(FileEntry(
                        name=entry.name,
                        path=str(Path(entry.path).resolve()),
                        is_dir=False,
                        size=st.st_size,
                        modified=st.st_mtime,
                    ))
    except PermissionError:
        raise HTTPException(403, f"권한 없음: {path}")

    entries.sort(key=lambda e: (not e.is_dir, e.name.lower()))
    parent = str(target.parent)
    parent_path = parent if _within_allowed_root(parent) else None
    return BrowseResponse(
        current_path=str(target),
        parent_path=parent_path,
        entries=entries,
        image_count=image_count,
    )
