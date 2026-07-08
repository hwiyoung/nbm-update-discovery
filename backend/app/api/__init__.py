"""API 라우터 — main.py 가 include."""

from app.api.datasets import router as datasets_router
from app.api.detections import router as detections_router
from app.api.exports import router as exports_router
from app.api.filesystem import router as filesystem_router
from app.api.history import router as history_router
from app.api.imports import router as imports_router
from app.api.sheets import router as sheets_router
from app.api.tasks import router as tasks_router
from app.api.uploads import router as uploads_router

__all__ = [
    "datasets_router",
    "detections_router",
    "exports_router",
    "filesystem_router",
    "history_router",
    "imports_router",
    "sheets_router",
    "tasks_router",
    "uploads_router",
]
