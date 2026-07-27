"""처리 히스토리 액션 분류 회귀 테스트."""

from app.services.history import infer_update_action


def test_change_type_update_is_classification():
    assert infer_update_action(
        {"change_type": "building_removed"},
        before={"change_type": "building_new"},
    ) == "classify"


def test_model_update_is_classification():
    assert infer_update_action(
        {"model": "road"},
        before={"model": "building"},
    ) == "classify"


def test_geometry_takes_precedence_over_classification():
    assert infer_update_action(
        {"geometry": {"type": "Polygon", "coordinates": []}, "model": "road"},
        before={},
    ) == "edit_geometry"
