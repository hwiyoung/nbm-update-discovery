from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace

import numpy as np
import pytest
import rasterio
from rasterio.transform import from_origin
from shapely.geometry import box

import app.services.change_detection_engine as cde
from app.services.change_detection_engine import (
    AlgorithmSpec,
    _prepare_algorithm_inputs,
    prepare_shared_algorithm_inputs,
    run_algorithm_category,
)


def _write_rgb(path: Path, *, value: int, pixel_size: float = 1.0) -> None:
    data = np.full((3, 12, 12), value, dtype=np.uint8)
    transform = from_origin(0, 12, pixel_size, pixel_size)
    with rasterio.open(
        path,
        "w",
        driver="GTiff",
        width=12,
        height=12,
        count=3,
        dtype="uint8",
        crs="EPSG:5186",
        transform=transform,
    ) as dst:
        dst.write(data)


def _settings(mode: str):
    return SimpleNamespace(
        change_detection_prepare_mode=mode,
        change_detection_crop_pixels=0,
        change_detection_target_gsd_m=1.0,
        change_detection_sheet_buffer_m=0.0,
        change_detection_resampling="cubic",
    )


def test_prepare_algorithm_inputs_keeps_legacy_full_image_path(tmp_path: Path) -> None:
    t1 = tmp_path / "t1.tif"
    t2 = tmp_path / "t2.tif"
    _write_rgb(t1, value=10)
    _write_rgb(t2, value=20)

    prepared = _prepare_algorithm_inputs(
        settings=_settings("legacy"),
        standard_path=str(t1),
        compare_path=str(t2),
        sheets=[SimpleNamespace(code="A", geometry=box(0, 0, 12, 12).wkb)],
        input_root=tmp_path / "input",
    )

    assert prepared.dataset_names == ("full",)
    assert prepared.mode == "full-image"
    assert (tmp_path / "input" / "T1" / "full.tif").is_symlink()
    assert (tmp_path / "input" / "T2" / "full.tif").is_symlink()


def test_prepare_algorithm_inputs_writes_sheet_chip_pairs(tmp_path: Path) -> None:
    t1 = tmp_path / "t1.tif"
    t2 = tmp_path / "t2.tif"
    _write_rgb(t1, value=30)
    _write_rgb(t2, value=70)

    prepared = _prepare_algorithm_inputs(
        settings=_settings("sheet_12cm"),
        standard_path=str(t1),
        compare_path=str(t2),
        sheets=[
            SimpleNamespace(code="A", geometry=box(0, 0, 6, 12).wkb),
            SimpleNamespace(code="B", geometry=box(20, 0, 30, 12).wkb),
        ],
        input_root=tmp_path / "input",
    )

    assert prepared.dataset_names == ("A",)
    assert prepared.mode == "sheet_12cm"
    assert prepared.core_geometries_5186 is not None
    assert sorted(prepared.core_geometries_5186) == ["A"]
    assert prepared.valid_mask_paths_5186 is not None
    assert sorted(prepared.valid_mask_paths_5186) == ["A"]
    t1_chip = tmp_path / "input" / "T1" / "A.tif"
    t2_chip = tmp_path / "input" / "T2" / "A.tif"
    valid_mask = tmp_path / "input" / "_valid_masks" / "A.tif"
    assert t1_chip.exists()
    assert t2_chip.exists()
    assert valid_mask.exists()
    assert not (tmp_path / "input" / "T1" / "B.tif").exists()

    with rasterio.open(t1_chip) as src:
        assert src.width == 6
        assert src.height == 12
        assert src.res == (1.0, 1.0)
        assert int(src.read(1).max()) == 30
    with rasterio.open(t2_chip) as src:
        assert src.width == 6
        assert src.height == 12
        assert src.res == (1.0, 1.0)
        assert int(src.read(1).max()) == 70


def test_prepare_shared_algorithm_inputs_writes_task_scoped_input_once(tmp_path: Path) -> None:
    t1 = tmp_path / "t1.tif"
    t2 = tmp_path / "t2.tif"
    _write_rgb(t1, value=30)
    _write_rgb(t2, value=70)

    settings = _settings("sheet_12cm")
    settings.change_detection_workspace_root = str(tmp_path / "artifacts")
    stale = tmp_path / "artifacts" / "task1" / "input" / "stale.txt"
    stale.parent.mkdir(parents=True)
    stale.write_text("old", encoding="utf-8")

    prepared = prepare_shared_algorithm_inputs(
        settings=settings,
        task_id="task1",
        standard_path=str(t1),
        compare_path=str(t2),
        sheets=[SimpleNamespace(code="A", geometry=box(0, 0, 6, 12).wkb)],
    )

    assert prepared.input_root == tmp_path / "artifacts" / "task1" / "input"
    assert prepared.dataset_names == ("A",)
    assert not stale.exists()
    assert (prepared.input_root / "T1" / "A.tif").exists()
    assert (prepared.input_root / "T2" / "A.tif").exists()
    assert (prepared.input_root / "_valid_masks" / "A.tif").exists()


def test_run_algorithm_category_reuses_prepared_shared_inputs(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    t1 = tmp_path / "t1.tif"
    t2 = tmp_path / "t2.tif"
    _write_rgb(t1, value=30)
    _write_rgb(t2, value=70)

    settings = _settings("sheet_12cm")
    settings.change_detection_workspace_root = str(tmp_path / "artifacts")
    sheets = [SimpleNamespace(code="A", geometry=box(0, 0, 6, 12).wkb)]
    prepared = prepare_shared_algorithm_inputs(
        settings=settings,
        task_id="task1",
        standard_path=str(t1),
        compare_path=str(t2),
        sheets=sheets,
    )

    dataset_roots: list[Path] = []

    def fake_algorithm(
        settings,
        spec,
        dataset_dir: Path,
        output_dir: Path,
        progress_callback=None,
        **kwargs,
    ) -> None:
        dataset_roots.append(dataset_dir)
        output_dir.mkdir(parents=True, exist_ok=True)
        (output_dir / "A.json").write_text(
            '{"type":"FeatureCollection","features":[]}',
            encoding="utf-8",
        )

    monkeypatch.setattr(
        cde,
        "_algorithm_spec",
        lambda settings, category: AlgorithmSpec(
            script="unused.py",
            model_dir="unused-model",
            confidence_threshold=0.1,
            min_area_m2=1.0,
            simplify_tolerance=0.0,
        ),
    )
    monkeypatch.setattr(cde, "_run_algorithm", fake_algorithm)

    run_algorithm_category(
        settings=settings,
        task_id="task1",
        category="building",
        standard_path=str(t1),
        compare_path=str(t2),
        sheets=sheets,
        prepared_inputs=prepared,
    )
    run_algorithm_category(
        settings=settings,
        task_id="task1",
        category="road",
        standard_path=str(t1),
        compare_path=str(t2),
        sheets=sheets,
        prepared_inputs=prepared,
    )

    assert dataset_roots == [prepared.input_root, prepared.input_root]
    assert not (tmp_path / "artifacts" / "task1" / "building" / "input").exists()
    assert not (tmp_path / "artifacts" / "task1" / "road" / "input").exists()
    assert (tmp_path / "artifacts" / "task1" / "building" / "output" / "A.json").exists()
    assert (tmp_path / "artifacts" / "task1" / "road" / "output" / "A.json").exists()
