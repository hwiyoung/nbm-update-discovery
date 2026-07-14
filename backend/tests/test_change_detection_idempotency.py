from __future__ import annotations

from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import MagicMock

from app.api.tasks import _prepare_task_run
from app.config import get_settings
from app.workers.celery_app import celery_app
from app.workers.tasks import (
    _change_detection_skip_result,
    _claim_change_detection_task,
    run_change_detection,
)


def _task(
    *,
    status: str,
    task_id: str = "task_1",
    celery_task_id: str | None = None,
):
    return SimpleNamespace(
        id=task_id,
        status=status,
        celery_task_id=celery_task_id,
    )


def test_completed_task_delivery_is_skipped():
    result = _change_detection_skip_result(
        _task(status="succeeded", celery_task_id="celery_old"),
        "celery_old",
    )

    assert result is not None
    assert result["skipped"] is True
    assert result["reason"] == "terminal_status"
    assert result["status"] == "succeeded"


def test_stale_celery_delivery_is_skipped():
    result = _change_detection_skip_result(
        _task(status="pending", celery_task_id="celery_new"),
        "celery_old",
    )

    assert result is not None
    assert result["skipped"] is True
    assert result["reason"] == "stale_celery_task"
    assert result["current_celery_id"] == "celery_old"
    assert result["expected_celery_task_id"] == "celery_new"


def test_matching_pending_delivery_is_allowed():
    result = _change_detection_skip_result(
        _task(status="pending", celery_task_id="celery_new"),
        "celery_new",
    )

    assert result is None


def test_pending_without_recorded_celery_id_is_skipped():
    result = _change_detection_skip_result(
        _task(status="pending", celery_task_id=None),
        "celery_new",
    )

    assert result is not None
    assert result["reason"] == "missing_expected_celery_task_id"


def test_running_delivery_is_not_claimed_again():
    result = _change_detection_skip_result(
        _task(status="running", celery_task_id="celery_current"),
        "celery_current",
    )

    assert result is not None
    assert result["reason"] == "not_pending"


def test_completed_task_can_be_prepared_for_manual_rerun():
    completed_at = datetime.now(timezone.utc)
    task = _task(status="succeeded", celery_task_id="celery_old")
    task.progress = 100
    task.started_at = completed_at
    task.finished_at = completed_at

    _prepare_task_run(task, "celery_new")

    assert task.status == "pending"
    assert task.progress == 0
    assert task.started_at is None
    assert task.finished_at is None
    assert task.celery_task_id == "celery_new"
    assert _change_detection_skip_result(task, "celery_new") is None
    stale = _change_detection_skip_result(task, "celery_old")
    assert stale is not None
    assert stale["reason"] == "stale_celery_task"


def test_atomic_claim_allows_only_one_delivery():
    db = MagicMock()
    db.scalar.side_effect = ["task_1", None]

    assert _claim_change_detection_task(db, "task_1", "celery_1") is True
    assert _claim_change_detection_task(db, "task_1", "celery_1") is False
    assert db.commit.call_count == 1
    assert db.rollback.call_count == 1


def test_change_detection_delivery_policy_matches_long_engine_queue():
    timeout = get_settings().change_detection_visibility_timeout_s

    assert run_change_detection.acks_late is True
    assert celery_app.conf.broker_transport_options["visibility_timeout"] == timeout
    assert celery_app.conf.result_backend_transport_options["visibility_timeout"] == timeout
    assert celery_app.conf.visibility_timeout == timeout
