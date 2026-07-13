from __future__ import annotations

import pytest
from fastapi import HTTPException
from shapely.geometry import box

from app.api.tasks import _normalize_resource_ids, _validate_disjoint_resource_ids
from app.services.task_processing_geometry import intersect_processing_footprints


def test_multi_resource_ids_are_unique_and_keep_fallback_order() -> None:
    assert _normalize_resource_ids([43, 42, 43], 43) == [43, 42]


def test_past_and_current_resource_ids_must_be_disjoint() -> None:
    with pytest.raises(HTTPException) as error:
        _validate_disjoint_resource_ids([43, 42], [41, 42])

    assert error.value.status_code == 400
    assert error.value.detail["error"]["details"]["duplicated_resource_ids"] == [42]


def test_disjoint_multi_resource_ids_are_allowed() -> None:
    _validate_disjoint_resource_ids([43, 42], [41])


def test_processing_footprint_merges_disconnected_standard_union() -> None:
    result = intersect_processing_footprints(
        [box(0, 0, 2, 4), box(2.5, 2, 4.5, 4)],
        [box(-1, -1, 6, 5)],
    )

    assert result is not None
    assert result.geom_type == "Polygon"
    assert result.intersection(box(0, 0, 2, 4)).area == pytest.approx(8.0)
    assert result.intersection(box(2.5, 2, 4.5, 4)).area == pytest.approx(4.0)
    assert result.area < result.envelope.area


def test_processing_footprint_intersects_both_input_sides() -> None:
    result = intersect_processing_footprints(
        [box(0, 0, 6, 4)],
        [box(2, -1, 8, 3)],
    )

    assert result is not None
    assert result.equals(box(2, 0, 6, 3))
