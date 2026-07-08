"""DEMZExportService 통합 테스트 — 합성 GPKG + mocked DEM 2개로 동작 검증.

수락 기준 (spec §8):
  - 단일 도엽 객체: 모든 vertex 에 정확한 Z
  - 도엽 경계 객체: vertex 간 단차 없음 (양쪽 도엽 Z 가 다르면 vertex 별 Z 가 다르게 부여)
  - NoData vertex: DXF z=0 + objects_with_nodata 에 ID
  - DEM 누락: MissingDEMError
"""

from __future__ import annotations

from pathlib import Path

import ezdxf
import pytest

from app.services.dem_z_export import (
    DEMZExportService,
    MissingDEMError,
)


def _make_service(env, **overrides) -> DEMZExportService:
    return DEMZExportService(
        sheet_index_path=env["sheet_index_path"],
        dem_dir=env["dem_dir"],
        sheet_code_field="MAPIDCD_NO",
        target_crs="EPSG:5186",
        dem_filename_pattern=overrides.pop("dem_filename_pattern", "{sheet_code}.tif"),
        sample_method=overrides.pop("sample_method", "bilinear"),
    )


def test_happy_path(export_env, tmp_path):
    """전체 흐름 — 2개 도엽 + 2개 폴리곤. DXF 생성, 통계, vertex Z 정확."""
    service = _make_service(export_env)
    out = tmp_path / "out.dxf"

    result = service.export(
        polygons_path=export_env["polygons_path"],
        output_dxf_path=out,
        layer_name="VARIATION",
    )

    assert out.exists(), "DXF 파일 생성됨"
    assert result.total_objects == 2
    # P1 exterior ring 4 + closing = 5, P2 동일 → 10 vertex
    assert result.total_vertices == 10
    assert sorted(result.sheets_used) == [
        export_env["sheet_a_code"],
        export_env["sheet_b_code"],
    ]
    assert result.missing_sheets == []
    assert result.nodata_vertex_count == 0
    assert result.objects_with_nodata == []
    assert result.elapsed_seconds > 0


def test_dxf_vertex_z_values(export_env, tmp_path):
    """생성된 DXF 의 3D POLYLINE vertex Z 가 DEM 값과 일치."""
    service = _make_service(export_env)
    out = tmp_path / "z_check.dxf"
    service.export(
        polygons_path=export_env["polygons_path"],
        output_dxf_path=out,
        layer_name="VARIATION",
    )

    doc = ezdxf.readfile(str(out))
    msp = doc.modelspace()
    polylines = list(msp.query("POLYLINE"))
    assert len(polylines) == 2, "객체당 1개 polyline (exterior only)"

    sheet_a_z = export_env["sheet_a_z"]
    sheet_b_z = export_env["sheet_b_z"]

    # P1 (도엽 A 내부): 모든 vertex Z ≈ sheet_a_z
    p1_vertices = [v.dxf.location for v in polylines[0].vertices]
    for v in p1_vertices:
        assert abs(v.z - sheet_a_z) < 0.01, (
            f"P1 vertex z={v.z} should be ≈ {sheet_a_z}"
        )

    # P2 (도엽 A·B 경계): x<2000 → sheet_a_z, x>2000 → sheet_b_z
    # 경계 바로 위 (x≈2000) 는 bilinear 로 두 도엽 평균에 가까울 수 있으나
    # 본 테스트는 좌측 (x=1800) 우측 (x=2200) 두 점이 확실히 서로 다른 도엽에 속함.
    p2_vertices = [v.dxf.location for v in polylines[1].vertices]
    left = [v for v in p2_vertices if v.x < 1900]
    right = [v for v in p2_vertices if v.x > 2100]
    assert left and right, "P2 가 경계를 가로지름"
    for v in left:
        assert abs(v.z - sheet_a_z) < 0.01
    for v in right:
        assert abs(v.z - sheet_b_z) < 0.01


def test_missing_dem_dir_raises(export_env, tmp_path):
    """DEM 디렉토리가 비어있으면 MissingDEMError."""
    empty_dem_dir = tmp_path / "empty_dem"
    empty_dem_dir.mkdir()

    service = DEMZExportService(
        sheet_index_path=export_env["sheet_index_path"],
        dem_dir=empty_dem_dir,
        sheet_code_field="MAPIDCD_NO",
        target_crs="EPSG:5186",
        dem_filename_pattern="{sheet_code}.tif",
    )
    out = tmp_path / "should_fail.dxf"

    with pytest.raises(MissingDEMError):
        service.export(
            polygons_path=export_env["polygons_path"],
            output_dxf_path=out,
            layer_name="VARIATION",
        )


def test_partial_missing_dem(export_env, tmp_path):
    """DEM 중 일부만 누락 — 진행 + missing_sheets 에 보고."""
    # 도엽 B 의 DEM 삭제
    (export_env["dem_dir"] / f"{export_env['sheet_b_code']}.tif").unlink()

    service = _make_service(export_env)
    out = tmp_path / "partial.dxf"
    result = service.export(
        polygons_path=export_env["polygons_path"],
        output_dxf_path=out,
        layer_name="VARIATION",
    )

    assert out.exists()
    assert export_env["sheet_b_code"] in result.missing_sheets
    assert export_env["sheet_a_code"] not in result.missing_sheets

    # P2 의 우측 vertex (도엽 B 영역) 는 NoData → DXF z=0 + 영향 객체 보고
    assert result.nodata_vertex_count > 0
    assert "obj_002" in result.objects_with_nodata


def test_empty_polygons_writes_empty_dxf(export_env, tmp_path):
    """빈 입력 GPKG — empty DXF, total_objects=0."""
    import geopandas as gpd
    empty_gpkg = tmp_path / "empty.gpkg"
    # GeoPandas 가 빈 GeoDataFrame 도 GPKG 로 직렬화하려면 컬럼/CRS 필요.
    gdf = gpd.GeoDataFrame({"id": []}, geometry=[], crs="EPSG:5186")
    gdf.to_file(empty_gpkg, driver="GPKG")

    service = _make_service(export_env)
    out = tmp_path / "empty.dxf"
    result = service.export(
        polygons_path=empty_gpkg,
        output_dxf_path=out,
        layer_name="VARIATION",
    )

    assert out.exists()
    assert result.total_objects == 0
    assert result.total_vertices == 0
