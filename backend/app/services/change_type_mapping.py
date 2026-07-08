"""변화탐지 결과의 표준 속성 매핑 — 단일 진실 원천.

본 시스템 외부에서 들어오는 모든 변화탐지 결과(사용자 manual import GeoJSON,
변화탐지 엔진 worker output 등) 는 다음 표준 속성을 가진다고 가정:

    {
      "model": "building" | "road",
      "type":  "1" | "2" | "3",         # int 도 허용 — 내부에서 str 정규화
      "accuracy": number (0~100),
      "area": number (m²),
      "address": str,
      "region_code": str,
      "memo": str,
      "id": optional (외부 식별자, 보존 안 함),
    }

본 모듈의 두 헬퍼만 거치면 외부 형식이 우리 시스템의 DetectionORM 필드로 일관 변환:
  - resolve_change_type(model, type_value) → "building_new" 등 또는 None (미지원 조합)
  - normalize_properties(properties) → DetectionORM 생성에 바로 쓸 수 있는 dict

향후 type=4, road type 확장 등 도메인 변경은 본 모듈 한 곳만 수정.
"""
from __future__ import annotations

from typing import Any, TypedDict


# ============================================================
# 핵심 매핑 — (model, type 문자열) → change_type
# ============================================================

TYPE_TO_CHANGE_TYPE: dict[tuple[str, str], str] = {
    ("building", "1"): "building_new",      # 신축
    ("building", "2"): "building_removed",  # 철거/소멸
    ("building", "3"): "building_updated",  # 갱신
    ("road", "1"): "road_new",              # 신설
    ("road", "2"): "road_removed",          # 철거/소멸
    ("road", "3"): "road_updated",          # 갱신
}


def resolve_change_type(model: Any, type_value: Any) -> str | None:
    """model + type 숫자(문자열·int 모두 허용) 를 표준 change_type 으로 변환.

    매핑 표에 없으면 None — 호출자가 skip 처리.
    """
    if model is None or type_value is None:
        return None
    return TYPE_TO_CHANGE_TYPE.get((str(model).strip(), str(type_value).strip()))


# ============================================================
# 전체 properties 정규화
# ============================================================

class NormalizedDetection(TypedDict, total=False):
    """DetectionORM 생성에 바로 쓸 수 있는 형태."""
    model: str                # "building" | "road"
    change_type: str          # "building_new" 등
    confidence: float         # 0~100
    area_m2: float
    address: str
    region_code: str
    reviewer_memo: str


def _to_float(value: Any, default: float = 0.0) -> float:
    """문자열·숫자 모두 허용. 변환 실패 시 default."""
    if value is None:
        return default
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def normalize_properties(props: dict[str, Any]) -> NormalizedDetection | None:
    """표준 GeoJSON properties → DetectionORM 필드 dict.

    매핑 미지원(model+type 조합 unknown) 시 None — 호출자가 skip 카운트.
    """
    model = props.get("model")
    change_type = resolve_change_type(model, props.get("type"))
    if not change_type or model not in ("building", "road"):
        return None

    return {
        "model": str(model),
        "change_type": change_type,
        "confidence": _to_float(props.get("accuracy"), 0.0),
        "area_m2": _to_float(props.get("area"), 0.0),
        "address": str(props.get("address") or ""),
        "region_code": str(props.get("region_code") or ""),
        "reviewer_memo": str(props.get("memo") or ""),
    }
