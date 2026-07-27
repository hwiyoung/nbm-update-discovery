"""3D DXF Export (vertex 단위 DEM Z 주입) — 요청/응답 스키마.

spec: 3D_DXF_Export/3D_DXF_EXPORT_SPEC.md §4.1
"""

from __future__ import annotations

from pydantic import BaseModel, Field


class ExportSelectionRequest(BaseModel):
    """관심지역에서 계산한 객체 ID 목록으로 결과를 제한한다."""

    object_ids: list[str] = Field(default_factory=list, max_length=100_000)


class Export3dDxfRequest(BaseModel):
    """엔드포인트 요청 본문."""

    layer_name: str = Field(
        default="CHANGE_DETECTION",
        max_length=64,
        description="DXF 내부 레이어명. ASCII/숫자/_- 권장.",
    )
    object_ids: list[str] | None = Field(default=None, max_length=100_000)


class Export3dStatistics(BaseModel):
    """ExportResult.to_dict() 매핑."""

    total_objects: int
    total_vertices: int
    sheets_used: list[str]
    missing_sheets: list[str]
    nodata_vertex_count: int
    objects_with_nodata: list[str]
    elapsed_seconds: float


class Export3dDxfResponse(BaseModel):
    """엔드포인트 200 응답."""

    download_url: str = Field(..., description="GET 으로 다운로드 가능한 상대 URL.")
    filename: str
    statistics: Export3dStatistics
