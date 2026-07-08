from __future__ import annotations

from types import SimpleNamespace

import pytest

from app.services.task_artifacts import (
    UnsafeTaskArtifactPathError,
    compact_success_artifacts,
    delete_task_artifacts,
    task_artifact_dir,
    write_category_detection_geojson,
)


def _settings(root):
    return SimpleNamespace(change_detection_workspace_root=str(root))


def test_task_artifact_dir_resolves_under_workspace(tmp_path):
    settings = _settings(tmp_path / "exports")

    assert task_artifact_dir(settings, "task_123") == (
        tmp_path / "exports" / "task_123"
    ).resolve()


def test_task_artifact_dir_rejects_escape(tmp_path):
    settings = _settings(tmp_path / "exports")

    with pytest.raises(UnsafeTaskArtifactPathError):
        task_artifact_dir(settings, "../outside")


def test_delete_task_artifacts_removes_task_directory(tmp_path):
    settings = _settings(tmp_path / "exports")
    task_dir = tmp_path / "exports" / "task_123"
    (task_dir / "building").mkdir(parents=True)
    (task_dir / "building" / "result.geojson").write_text("{}", encoding="utf-8")
    (task_dir / "progress.json").write_text("{}", encoding="utf-8")

    assert delete_task_artifacts(settings, "task_123") is True
    assert not task_dir.exists()
    assert (tmp_path / "exports").exists()


def test_delete_task_artifacts_returns_false_when_missing(tmp_path):
    settings = _settings(tmp_path / "exports")

    assert delete_task_artifacts(settings, "missing_task") is False


def test_write_category_detection_geojson_merges_records(tmp_path):
    settings = _settings(tmp_path / "exports")
    records = [
        SimpleNamespace(
            sheet_code="36701075",
            model="building",
            change_type="building_new",
            confidence=0.91,
            area_m2=12.5,
            geometry_wkt_5186="POLYGON ((0 0, 1 0, 1 1, 0 0))",
            region_code="",
            address="",
            memo="",
        )
    ]

    path = write_category_detection_geojson(settings, "task_123", "building", records)

    text = path.read_text(encoding="utf-8")
    assert '"FeatureCollection"' in text
    assert '"building_new"' in text
    assert path.name == "building.geojson"


def test_compact_success_artifacts_removes_intermediates_only(tmp_path):
    settings = _settings(tmp_path / "exports")
    task_dir = task_artifact_dir(settings, "task_123")
    (task_dir / "input" / "T1").mkdir(parents=True)
    (task_dir / "building" / "output").mkdir(parents=True)
    (task_dir / "road" / "output").mkdir(parents=True)
    (task_dir / "building.geojson").write_text("{}", encoding="utf-8")
    (task_dir / "road.geojson").write_text("{}", encoding="utf-8")

    removed = compact_success_artifacts(settings, "task_123", ["building", "road"])

    assert removed == ["input", "building", "road"]
    assert (task_dir / "building.geojson").exists()
    assert (task_dir / "road.geojson").exists()
    assert not (task_dir / "input").exists()
    assert not (task_dir / "building").exists()
    assert not (task_dir / "road").exists()
