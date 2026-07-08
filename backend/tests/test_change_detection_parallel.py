from __future__ import annotations

from types import SimpleNamespace

from app.workers.tasks import _parallel_category_process_envs


def test_parallel_category_process_envs_uses_one_shared_gpu(monkeypatch):
    settings = SimpleNamespace(
        change_detection_parallel_models=True,
        change_detection_parallel_gpu_memory_limit=0.25,
        change_detection_parallel_gpu_id="",
    )

    def fake_run(*args, **kwargs):
        return SimpleNamespace(
            stdout="0, 1200, 24576\n1, 91, 24576\n",
        )

    monkeypatch.setattr("app.workers.tasks.subprocess.run", fake_run)

    envs = _parallel_category_process_envs(settings, ["building", "road"])

    assert envs["building"]["CUDA_VISIBLE_DEVICES"] == "0"
    assert envs["road"]["CUDA_VISIBLE_DEVICES"] == "0"


def test_parallel_category_process_envs_requires_idle_shared_gpu(monkeypatch):
    settings = SimpleNamespace(
        change_detection_parallel_models=True,
        change_detection_parallel_gpu_memory_limit=0.25,
        change_detection_parallel_gpu_id="",
    )

    def fake_run(*args, **kwargs):
        return SimpleNamespace(stdout="0, 9000, 24576\n")

    monkeypatch.setattr("app.workers.tasks.subprocess.run", fake_run)

    assert _parallel_category_process_envs(settings, ["building", "road"]) == {}


def test_parallel_category_process_envs_allows_explicit_shared_gpu():
    settings = SimpleNamespace(
        change_detection_parallel_models=True,
        change_detection_parallel_gpu_memory_limit=0.25,
        change_detection_parallel_gpu_id="0",
    )

    envs = _parallel_category_process_envs(settings, ["building", "road"])

    assert envs["building"]["CUDA_VISIBLE_DEVICES"] == "0"
    assert envs["road"]["CUDA_VISIBLE_DEVICES"] == "0"
