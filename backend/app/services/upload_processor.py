"""업로드 TIFF 후처리 — bbox 추출 + sheet_codes 자동.

호출자: api/uploads.py 가 파일 저장 직후 본 모듈 호출.

흐름:
  1. rasterio 로 TIFF 열기 → bounds + CRS
  2. CRS 가 EPSG:5186 이 아니면 transform_bounds 로 5186 변환
     - 한국 표준 CRS 5185 (서부원점) / 5186 (중부원점) / 5187 (동부원점)
     - 5179 (UTM-K), 4326 (WGS84), 32652 (UTM52N) 등 PROJ 가 아는 모든 CRS 지원
  3. 5186 영역 sanity 검사 (한반도 외 좌표면 조기 실패)
  4. PostGIS 로 도엽 격자와 교집합 면적 비율 계산 → 임계값 이상만 sheet_codes
     - 단순 ST_Intersects 는 mm 단위 boundary 침범도 true 라 3×3 ortho 가
       5×5 (25 도엽) 로 부풀려지는 부작용이 있어, 교차 면적 / 도엽 면적
       비율 >= SHEET_OVERLAP_MIN_RATIO 인 도엽만 채택.
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import NamedTuple

import rasterio
from rasterio.warp import transform_bounds
from shapely.geometry import box, mapping
from shapely.geometry.base import BaseGeometry
from sqlalchemy import text
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

# 한반도 EPSG:5186 영역 대략 — 외곽 약간 여유. 변환 후 이 범위 밖이면 비한국 영상.
KOREA_5186_BOUNDS = (-200_000, 0, 1_000_000, 1_500_000)  # (left, bottom, right, top)

# 도엽 격자 교집합 면적 / 도엽 전체 면적 비율 임계값.
# 1:5000 도엽이 ≈ 6,190,000 m² (≈2.2 km × 2.8 km) 이므로 1% 면 ≈ 60,000 m² (245m 변두리).
# bbox 가 도엽 경계를 수 미터~수십 미터 침범하는 경우는 0.5% 이하라 1% 면 안전히 분리.
SHEET_OVERLAP_MIN_RATIO = 0.01


class UploadProcessResult(NamedTuple):
    """upload_processor.process() 결과."""

    bbox_5186: BaseGeometry | None
    """5186 좌표계 polygon. 추출 실패 시 None."""
    sheet_codes: list[str]
    """교집합 도엽 코드 리스트 (없으면 빈 배열)."""
    error: str | None
    """실패 사유. 성공이면 None."""


def _crs_label(src_crs: rasterio.crs.CRS) -> str:
    """디버그·에러용 CRS 라벨. EPSG 가 있으면 'EPSG:NNNN', 아니면 짧은 to_string()."""
    epsg = src_crs.to_epsg()
    if epsg:
        return f"EPSG:{epsg}"
    s = src_crs.to_string()
    return s if len(s) < 80 else f"{s[:77]}..."


def process(file_path: str | Path, db: Session) -> UploadProcessResult:
    """업로드된 TIFF 파일을 처리해 bbox + sheet_codes 추출."""
    path = Path(file_path)
    if not path.exists():
        return UploadProcessResult(None, [], f"파일이 없습니다: {path}")

    try:
        with rasterio.open(str(path)) as src:
            src_bounds = src.bounds  # (left, bottom, right, top)
            src_crs = src.crs
    except Exception as e:
        return UploadProcessResult(None, [], f"TIFF 읽기 실패: {e}")

    if src_crs is None:
        return UploadProcessResult(
            None, [], "TIFF 에 CRS 정보가 없습니다 (georeferenced 가 아닙니다)"
        )

    crs_label = _crs_label(src_crs)
    src_epsg = src_crs.to_epsg()

    # CRS 변환 — 5186 으로 통일. EPSG 비교를 우선 (정확) 후 to_string() fallback.
    same_as_target = src_epsg == 5186 or src_crs.to_string() == "EPSG:5186"
    try:
        if same_as_target:
            left, bottom, right, top = (
                src_bounds.left,
                src_bounds.bottom,
                src_bounds.right,
                src_bounds.top,
            )
        else:
            left, bottom, right, top = transform_bounds(
                src_crs,
                "EPSG:5186",
                src_bounds.left,
                src_bounds.bottom,
                src_bounds.right,
                src_bounds.top,
                densify_pts=21,
            )
    except Exception as e:
        return UploadProcessResult(
            None, [], f"좌표계 변환 실패 ({crs_label} → EPSG:5186): {e}"
        )

    logger.info(
        "upload_processor: file=%s crs=%s src_bounds=%s → 5186_bounds=%s",
        path.name,
        crs_label,
        tuple(src_bounds),
        (left, bottom, right, top),
    )

    # Sanity: 변환 후 좌표가 한반도 영역 안에 있어야 함.
    kx0, ky0, kx1, ky1 = KOREA_5186_BOUNDS
    cx, cy = (left + right) / 2, (bottom + top) / 2
    if not (kx0 <= cx <= kx1 and ky0 <= cy <= ky1):
        return UploadProcessResult(
            None,
            [],
            (
                f"변환된 좌표가 한반도 영역을 벗어났습니다 "
                f"(CRS={crs_label}, 중심=({cx:.0f},{cy:.0f}) 5186). "
                f"정사영상 좌표계 또는 georeference 설정을 확인해 주세요."
            ),
        )

    bbox_5186 = box(left, bottom, right, top)

    # 교집합 면적 비율 >= SHEET_OVERLAP_MIN_RATIO 인 도엽만 채택.
    # 1단계 ST_Intersects 로 후보를 좁힌 뒤 (공간 인덱스 사용),
    # 2단계 ST_Area(ST_Intersection) / ST_Area(geometry) 로 비율 필터.
    bbox_wkt = bbox_5186.wkt
    try:
        rows = db.execute(
            text(
                """
                WITH candidates AS (
                  SELECT code, geometry
                    FROM sheets
                   WHERE ST_Intersects(
                           geometry,
                           ST_GeomFromText(:wkt, 5186)
                         )
                )
                SELECT code
                  FROM candidates
                 WHERE ST_Area(geometry) > 0
                   AND ST_Area(ST_Intersection(geometry, ST_GeomFromText(:wkt, 5186)))
                       / ST_Area(geometry) >= :min_ratio
                """
            ).bindparams(wkt=bbox_wkt, min_ratio=SHEET_OVERLAP_MIN_RATIO)
        ).all()
        sheet_codes = sorted({r[0] for r in rows})
    except Exception as e:
        return UploadProcessResult(
            bbox_5186, [], f"도엽 격자 인터섹션 쿼리 실패: {e}"
        )

    if not sheet_codes:
        return UploadProcessResult(
            bbox_5186,
            [],
            (
                f"한반도 1:5000 도엽 격자와 교집합이 없습니다 "
                f"(CRS={crs_label}, 5186 bbox=({left:.0f},{bottom:.0f},{right:.0f},{top:.0f}))"
            ),
        )

    return UploadProcessResult(bbox_5186, sheet_codes, None)


def bbox_to_geojson(geom: BaseGeometry) -> dict:
    """디버깅·로깅용. 5186 → 5186 GeoJSON dict."""
    return mapping(geom)
