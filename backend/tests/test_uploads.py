from __future__ import annotations

import os
from pathlib import Path

from app.api.uploads import _link_server_file, _upload_filename
from app.services.orthomosaic_registry import _absolute_preserve_symlink


def test_upload_filename_is_unique_and_strips_path():
    first = _upload_filename("../same.tif")
    second = _upload_filename("../same.tif")

    assert first != second
    assert first.endswith("_same.tif")
    assert second.endswith("_same.tif")
    assert "/" not in first
    assert "\\" not in first


def test_link_server_file_creates_symlink_without_copy(tmp_path: Path):
    source_dir = tmp_path / "media"
    upload_root = tmp_path / "orthomosaic"
    source_dir.mkdir()
    upload_root.mkdir()
    source = source_dir / "large.tif"
    source.write_bytes(b"fake-tiff")

    target, created = _link_server_file(source, upload_root)

    assert target == upload_root / "large.tif"
    assert created == target
    assert target.is_symlink()
    assert target.resolve() == source.resolve()


def test_link_server_file_reuses_existing_symlink(tmp_path: Path):
    source_dir = tmp_path / "media"
    upload_root = tmp_path / "orthomosaic"
    source_dir.mkdir()
    upload_root.mkdir()
    source = source_dir / "large.tif"
    source.write_bytes(b"fake-tiff")

    first, first_created = _link_server_file(source, upload_root)
    second, second_created = _link_server_file(source, upload_root)

    assert first_created == first
    assert second == first
    assert second_created is None


def test_link_server_file_preserves_file_already_in_upload_root(tmp_path: Path):
    upload_root = tmp_path / "orthomosaic"
    upload_root.mkdir()
    source = upload_root / "already-there.tif"
    source.write_bytes(b"fake-tiff")

    target, created = _link_server_file(source, upload_root)

    assert target == source
    assert created is None
    assert not target.is_symlink()


def test_link_server_file_reuses_same_underlying_file(tmp_path: Path):
    source_dir = tmp_path / "media"
    upload_root = tmp_path / "orthomosaic"
    source_dir.mkdir()
    upload_root.mkdir()
    source = source_dir / "same.tif"
    target_file = upload_root / "same.tif"
    source.write_bytes(b"fake-tiff")
    os.link(source, target_file)

    target, created = _link_server_file(source, upload_root)

    assert target == target_file
    assert created is None
    assert not (upload_root / "same__link2.tif").exists()


def test_registry_absolute_path_preserves_symlink_location(tmp_path: Path):
    source_dir = tmp_path / "media"
    upload_root = tmp_path / "orthomosaic"
    source_dir.mkdir()
    upload_root.mkdir()
    source = source_dir / "source.tif"
    source.write_bytes(b"fake-tiff")
    link = upload_root / "linked.tif"
    link.symlink_to(source)

    assert _absolute_preserve_symlink(link) == str(link)
    assert str(link.resolve()) == str(source)
