"""Pydantic 스키마 — 프론트 src/types 와 1:1.

좌표는 모든 응답이 EPSG:4326 (백엔드가 5186 → 4326 변환).
"""

from app.schemas.common import (
    BboxArray,
    ErrorResponse,
    GeoJsonPolygon,
    HealthResponse,
)
from app.schemas.dataset import (
    Dataset,
    DatasetCreate,
    DatasetFilterQuery,
    DatasetPreflightRaster,
    DatasetPreflightResult,
    DatasetPreflightWarning,
    DatasetSource,
    DatasetStatus,
    DatasetStatusUpdate,
    DatasetUploadMeta,
    OverlapResult,
)
from app.schemas.detection import (
    ChangeType,
    DetectionCreatePayload,
    DetectionObject,
    DetectionUpdatePayload,
    ObjectCategory,
)
from app.schemas.history import HistoryAction, ReviewHistory
from app.schemas.sheet import CompareType, MapSheet, ReviewStatus, SheetStatusUpdate
from app.schemas.task import Task, TaskCreatePayload, TaskStatus, TaskUpdatePayload

__all__ = [
    "BboxArray",
    "ErrorResponse",
    "GeoJsonPolygon",
    "HealthResponse",
    "Dataset",
    "DatasetCreate",
    "DatasetFilterQuery",
    "DatasetPreflightRaster",
    "DatasetPreflightResult",
    "DatasetPreflightWarning",
    "DatasetSource",
    "DatasetStatus",
    "DatasetStatusUpdate",
    "DatasetUploadMeta",
    "OverlapResult",
    "ChangeType",
    "DetectionCreatePayload",
    "DetectionObject",
    "DetectionUpdatePayload",
    "ObjectCategory",
    "HistoryAction",
    "ReviewHistory",
    "CompareType",
    "MapSheet",
    "ReviewStatus",
    "SheetStatusUpdate",
    "Task",
    "TaskCreatePayload",
    "TaskStatus",
    "TaskUpdatePayload",
]
