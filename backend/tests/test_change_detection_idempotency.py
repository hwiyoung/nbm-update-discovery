from __future__ import annotations

from types import SimpleNamespace

from app.workers.tasks import _change_detection_skip_result


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


def test_pending_without_recorded_celery_id_is_allowed():
    result = _change_detection_skip_result(
        _task(status="pending", celery_task_id=None),
        "celery_new",
    )

    assert result is None
