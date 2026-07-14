from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path

from app.models.dataset import DatasetORM
from app.services.orthomosaic_registry import _apply_current_metadata, _parse_taken_at
from app.services.serializers import _dataset_capture_year


def _row(
    display_name: str,
    *,
    source: str = "aerial",
    tile_path: str | None = None,
) -> DatasetORM:
    return DatasetORM(
        source=source,
        display_name=display_name,
        platform="항공",
        taken_start_at=datetime(2026, 7, 8, tzinfo=timezone.utc),
        taken_end_at=datetime(2026, 7, 8, tzinfo=timezone.utc),
        bbox=None,  # type: ignore[arg-type]
        tile_path=tile_path,
        sheet_codes=[],
        status="ready",
    )


def test_dataset_capture_year_prefers_four_digit_filename_year():
    row = _row("수도권남부_권역_2024_6B.tif")

    assert _dataset_capture_year(row) == 2024


def test_dataset_capture_year_ignores_upload_timestamp_prefix():
    row = _row("20260617085811_a54d2b2e_asan_25_ta.tif")

    assert _dataset_capture_year(row) == 2025


def test_dataset_capture_year_uses_taken_at_for_non_aerial_uploads():
    row = _row("upload_2024.tif", source="upload")

    assert _dataset_capture_year(row) == 2026


def test_registry_metadata_refresh_preserves_manual_upload_source(tmp_path: Path):
    path = tmp_path / "manual_2024.tif"
    path.write_bytes(b"fake")
    row = _row("manual_2024.tif", source="upload", tile_path=str(path))

    _apply_current_metadata(row, path, "POLYGON ((0 0, 1 0, 1 1, 0 0))", ["A"])

    assert row.source == "upload"


def test_registry_taken_at_reads_leading_four_digit_year(tmp_path: Path):
    path = tmp_path / "2024_Asan_clip_1.tif"
    path.write_bytes(b"fake")

    taken_at = _parse_taken_at(path)

    assert taken_at == datetime(2024, 1, 1, tzinfo=timezone.utc)
