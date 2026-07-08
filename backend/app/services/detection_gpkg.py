"""task_id 의 detection 폴리곤들을 임시 GPKG (EPSG:5186) 로 직렬화.

DEMZExportService 가 파일 경로 기반이므로, DB → 임시 파일 변환이 필요하다.
"""

from __future__ import annotations

import tempfile
from pathlib import Path

from shapely import wkb
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.detection import DetectionORM


def write_task_detections_gpkg(
    db: Session,
    task_id: str,
    dest_dir: str | Path | None = None,
) -> tuple[Path, int]:
    # geopandas 는 dem_z_export 와 동일 의존 라인 — 컨테이너 재빌드 전까지는
    # 미설치. import 를 함수 본문으로 지연시켜 서버 startup 을 보호한다.
    import geopandas as gpd

    """task_id 에 속한 (미삭제) detection 들을 GPKG 파일로 직렬화.

    Returns
    -------
    (path, count) — 작성한 임시 GPKG 의 절대 경로와 폴리곤 수.
    count == 0 이면 호출 측이 422 또는 400 으로 처리.

    Notes
    -----
    - geometry 컬럼은 PostGIS Geometry(SRID=5186) → WKB 그대로 shapely 로 로드.
    - 부수 속성은 module 의 _extract_attributes 에서 그대로 export 결과에 포함되므로
      detection.id / change_type / confidence / area_m2 / region_code / error_class 만 노출.
    """
    rows = (
        db.execute(
            select(DetectionORM).where(
                DetectionORM.task_id == task_id,
                DetectionORM.is_deleted.is_(False),
            )
        )
        .scalars()
        .all()
    )

    records: list[dict] = []
    geoms = []
    for row in rows:
        raw = getattr(row.geometry, "desc", row.geometry)
        if raw is None:
            continue
        if isinstance(raw, str):
            geom = wkb.loads(bytes.fromhex(raw))
        else:
            geom = wkb.loads(raw)
        if geom.is_empty:
            continue
        records.append({
            "id": row.id,
            "sheet_code": row.sheet_code,
            "change_type": row.change_type,
            "confidence": row.confidence,
            "area_m2": row.area_m2,
            "region_code": row.region_code,
            "error_class": row.error_class or "",
        })
        geoms.append(geom)

    if not records:
        return Path(""), 0

    gdf = gpd.GeoDataFrame(records, geometry=geoms, crs="EPSG:5186")

    # pandas 2.2+ 가 string 컬럼을 StringDtype(na_value=nan) 으로 추론하면
    # geopandas .to_file(engine="fiona") 의 schema infer 가 TypeError 를 던진다.
    # 작성 직전 numpy object dtype 으로 강제.
    import pandas as pd
    for col in gdf.columns:
        if col == "geometry":
            continue
        if isinstance(gdf[col].dtype, pd.StringDtype):
            gdf[col] = gdf[col].astype(object)

    if dest_dir is None:
        # mkstemp 는 0 바이트 placeholder 를 생성하는데, fiona 의 GPKG driver 는
        # 빈 파일을 "지원 안 되는 포맷" 으로 보고 실패한다. placeholder 제거 후
        # to_file 이 새로 작성하게 한다.
        import os
        fd, path_str = tempfile.mkstemp(suffix=".gpkg", prefix=f"task_{task_id}_")
        os.close(fd)
        path = Path(path_str)
        path.unlink(missing_ok=True)
    else:
        path = Path(dest_dir) / f"task_{task_id}.gpkg"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.unlink(missing_ok=True)

    gdf.to_file(path, driver="GPKG")
    return path, len(gdf)


def cleanup_gpkg(path: Path | str) -> None:
    """임시 GPKG 삭제 (호출 측이 finally 에서 호출)."""
    p = Path(path)
    if p.exists():
        p.unlink(missing_ok=True)
