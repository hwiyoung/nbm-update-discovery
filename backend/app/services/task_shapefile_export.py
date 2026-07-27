"""Task 변화탐지 객체를 UTF-8 Shapefile ZIP으로 직렬화한다.

DBF 문자열은 브라우저 라이브러리가 아니라 Fiona/GDAL이 직접 작성한다.
좌표는 DB에 저장된 EPSG:5186을 그대로 유지하며, QGIS가 인코딩을 확실히
판별하도록 ``.cpg``도 함께 넣는다.
"""

from __future__ import annotations

import io
import tempfile
import zipfile
from pathlib import Path
from typing import Iterable

from shapely import wkb
from shapely.geometry import mapping
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.detection import DetectionORM


OBJECT_LABELS = {
    "building": "건물",
    "road": "도로",
}

CHANGE_TYPE_LABELS = {
    "building_new": "신축",
    "building_removed": "소멸",
    "building_updated": "갱신",
    "road_new": "신설",
    "road_removed": "소멸",
    "road_updated": "갱신",
}

# Shapefile DBF의 문자 필드는 최대 254 byte다. 폭을 byte 기준으로 명시하고,
# 긴 한글 문자열은 UTF-8 문자 중간에서 잘리지 않도록 사전에 안전하게 줄인다.
STRING_FIELD_WIDTHS = {
    "MAP_IDX": 16,
    "CLASS": 16,
    "TYPE": 32,
    "TYPE_KO": 16,
    "REGION": 48,
    "ADDR": 254,
    "MEMO": 254,
    "OBJ_ID": 64,
}

SHAPEFILE_SCHEMA = {
    "geometry": "Polygon",
    "properties": {
        "NO": "int",
        "MAP_IDX": f"str:{STRING_FIELD_WIDTHS['MAP_IDX']}",
        "CLASS": f"str:{STRING_FIELD_WIDTHS['CLASS']}",
        "TYPE": f"str:{STRING_FIELD_WIDTHS['TYPE']}",
        "TYPE_KO": f"str:{STRING_FIELD_WIDTHS['TYPE_KO']}",
        "CONF": "float:10.3",
        "AREA_M2": "float:18.3",
        "REGION": f"str:{STRING_FIELD_WIDTHS['REGION']}",
        "ADDR": f"str:{STRING_FIELD_WIDTHS['ADDR']}",
        "MEMO": f"str:{STRING_FIELD_WIDTHS['MEMO']}",
        "OBJ_ID": f"str:{STRING_FIELD_WIDTHS['OBJ_ID']}",
    },
}


def create_task_shapefile_zip(
    db: Session,
    task_id: str,
    layer_name: str,
    object_ids: list[str] | None = None,
) -> tuple[bytes, int]:
    """Task의 활성 변화탐지 객체를 조회해 ZIP bytes와 작성 건수를 반환한다."""
    if object_ids is not None and not object_ids:
        return b"", 0
    stmt = select(DetectionORM).where(
        DetectionORM.task_id == task_id,
        DetectionORM.is_deleted.is_(False),
        DetectionORM.change_type != "building_color",
    )
    if object_ids is not None:
        stmt = stmt.where(DetectionORM.id.in_(list(dict.fromkeys(object_ids))))
    rows = (
        db.execute(
            stmt.order_by(DetectionORM.id)
        )
        .scalars()
        .all()
    )
    return build_shapefile_zip(rows, layer_name)


def build_shapefile_zip(
    detections: Iterable[DetectionORM],
    layer_name: str,
) -> tuple[bytes, int]:
    """주어진 detection들을 Fiona/GDAL로 직렬화한다.

    Fiona import는 함수 실행 시점까지 늦춰, 지리공간 런타임이 없는 환경에서도
    API 모듈 자체는 import할 수 있게 한다.
    """
    import fiona

    records: list[tuple[object, dict[str, object]]] = []
    for row in detections:
        geometry = _load_geometry(row.geometry)
        if geometry is None or geometry.is_empty:
            continue
        properties = {
            "NO": len(records) + 1,
            "MAP_IDX": _dbf_text(row.sheet_code, "MAP_IDX"),
            "CLASS": _dbf_text(OBJECT_LABELS.get(row.model, row.model), "CLASS"),
            "TYPE": _dbf_text(row.change_type, "TYPE"),
            "TYPE_KO": _dbf_text(
                CHANGE_TYPE_LABELS.get(row.change_type, row.change_type),
                "TYPE_KO",
            ),
            "CONF": float(row.confidence),
            "AREA_M2": float(row.area_m2),
            "REGION": _dbf_text(row.region_code, "REGION"),
            "ADDR": _dbf_text(row.address, "ADDR"),
            "MEMO": _dbf_text(row.reviewer_memo, "MEMO"),
            "OBJ_ID": _dbf_text(row.id, "OBJ_ID"),
        }
        records.append((geometry, properties))

    if not records:
        return b"", 0

    with tempfile.TemporaryDirectory(prefix="nbm_shp_") as temp_dir:
        shp_path = Path(temp_dir) / f"{layer_name}.shp"
        with fiona.open(
            shp_path,
            mode="w",
            driver="ESRI Shapefile",
            schema=SHAPEFILE_SCHEMA,
            crs="EPSG:5186",
            encoding="UTF-8",
        ) as sink:
            for geometry, properties in records:
                sink.write({
                    "type": "Feature",
                    "geometry": mapping(geometry),
                    "properties": properties,
                })

        # GDAL 버전에 따라 표기가 달라지지 않도록 명시적으로 고정한다.
        shp_path.with_suffix(".cpg").write_text("UTF-8", encoding="ascii")

        archive = io.BytesIO()
        with zipfile.ZipFile(
            archive,
            mode="w",
            compression=zipfile.ZIP_DEFLATED,
        ) as output_zip:
            for suffix in (".shp", ".shx", ".dbf", ".prj", ".cpg"):
                sidecar = shp_path.with_suffix(suffix)
                if not sidecar.is_file():
                    raise RuntimeError(f"Shapefile 구성 파일 누락: {sidecar.name}")
                output_zip.write(sidecar, arcname=sidecar.name)

    return archive.getvalue(), len(records)


def _load_geometry(value):
    raw = getattr(value, "desc", value)
    if raw is None:
        return None
    if isinstance(raw, str):
        raw = bytes.fromhex(raw)
    elif isinstance(raw, memoryview):
        raw = raw.tobytes()
    return wkb.loads(raw)


def _dbf_text(value: object, field_name: str) -> str:
    text = "" if value is None else str(value)
    max_bytes = STRING_FIELD_WIDTHS[field_name]
    encoded = text.encode("utf-8")
    if len(encoded) <= max_bytes:
        return text
    return encoded[:max_bytes].decode("utf-8", errors="ignore")
