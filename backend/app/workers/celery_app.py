"""Celery 앱 설정 — broker = Redis, backend = Redis."""

from __future__ import annotations

from celery import Celery

from app.config import get_settings

_settings = get_settings()

celery_app = Celery(
    "nbm",
    broker=_settings.redis_url,
    backend=_settings.redis_url,
    include=["app.workers.tasks"],
)

celery_app.conf.update(
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    timezone="Asia/Seoul",
    enable_utc=True,
    task_track_started=True,
    # Redis broker/backend 를 함께 쓸 때 세 설정을 동일하게 맞춰야 한다.
    # 본 값은 이 NBM Compose stack 의 Redis 연결에만 적용된다.
    broker_transport_options={
        "visibility_timeout": _settings.change_detection_visibility_timeout_s,
    },
    result_backend_transport_options={
        "visibility_timeout": _settings.change_detection_visibility_timeout_s,
    },
    visibility_timeout=_settings.change_detection_visibility_timeout_s,
)
