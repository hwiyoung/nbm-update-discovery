"""환경 변수 로드 (pydantic-settings)."""

from __future__ import annotations

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # Product release version. Production injects this from APP_VERSION.
    app_version: str = "dev"

    # DB / Cache
    database_url: str = (
        "postgresql+psycopg2://nbm:nbm_dev_change_me@postgres:5432/nbm"
    )
    redis_url: str = "redis://redis:6379/0"

    # Auth (이정표 4·5 시점에 도입)
    jwt_secret: str = "__replace_in_production__"
    secret_key: str = "__replace_in_production__"

    # CORS — 1차 출시 dev. 단일 사용자 + LAN 환경이라 모든 origin 허용.
    # 운영(이정표 6)은 nginx reverse proxy 로 same-origin 만들어 CORS 회피.
    cors_origins: list[str] = ["*"]
    cors_origin_regex: str = (
        r"https?://(localhost|127\.0\.0\.1|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+)(:\d+)?"
    )

    # Storage — 이정표 4·5 시점에 사용
    storage_root: str = "/data/storage"

    # 3D DXF Export (DEM Z 주입) — 이정표 5 보강
    # sheet_index: compose 가 frontend/public/data → /data/seed:ro 로 마운트.
    # dem_dir: 운영 환경에서 .env 로 실제 경로 지정 (도엽별 .img 타일).
    sheet_index_path: str = "/data/seed/sheets_grid_5179.geojson"
    sheet_code_field: str = "MAPIDCD_NO"
    dem_dir: str = "/data/dem"
    dem_target_crs: str = "EPSG:5186"
    dem_filename_pattern: str = "{sheet_code}.img"
    dem_sample_method: str = "bilinear"
    # DXF 출력 루트 (task_id 별 하위 디렉토리). storage_root 하위로 통일.
    export_output_root: str = "/data/storage/exports"

    # 실감정사영상 산출물 디렉토리 — startup 시 .tif 자동 스캔 → aerial 데이터셋 등록.
    # 컨테이너 안에서 read-only 로 마운트되는 호스트 경로.
    orthomosaic_dir: str = "/data/orthomosaic"
    # UI 표시용 호스트 실제 경로. 컨테이너 내부 경로(/data/orthomosaic)를 노출하지 않고
    # 배포 서버에서 사용자가 찾을 수 있는 경로로 변환할 때 사용한다.
    host_orthomosaic_dir: str | None = None

    # Change detection engine
    # mock: 기존 경량 mock 엔진 사용. algorithm: 실제 도로/건물 변화탐지 알고리즘 사용.
    change_detection_queue: str = "engine"
    # Redis 기본 visibility timeout(1시간)보다 긴 변화탐지 작업이 앞에 있을 때
    # 뒤 작업의 예약 메시지가 재전달되지 않도록 최대 예상 실행시간보다 길게 둔다.
    change_detection_visibility_timeout_s: int = 72 * 60 * 60
    change_detection_engine_mode: str = "algorithm"
    change_detection_algorithm_root: str = "/engines/pm"
    change_detection_workspace_root: str = "/data/storage/exports"
    change_detection_preflight_cache_root: str = "/data/storage/preflight-cache"
    change_detection_preflight_cache_enabled: bool = True
    change_detection_preflight_mode: str = "fast_safe"
    change_detection_preflight_progress_interval_s: float = 2.0
    change_detection_preflight_rgb_nodata_tolerance: int = 3
    change_detection_preflight_rgb_nodata_sieve_pixels: int = 16
    change_detection_preflight_rgb_zero_sieve_pixels: int = 16
    change_detection_crop_pixels: int = 0
    change_detection_prepare_mode: str = "sheet_12cm"
    change_detection_target_gsd_m: float = 0.12
    change_detection_sheet_buffer_m: float = 32.0
    change_detection_resampling: str = "cubic"
    change_detection_sheet_prefilter_enabled: bool = True
    change_detection_sheet_prefilter_max_sample_pixels: int = 262_144
    change_detection_sheet_prefilter_min_valid_ratio: float = 0.0
    change_detection_output_valid_mask_min_ratio: float = 0.5
    change_detection_patch_size: int = 1024
    change_detection_overlap_ratio: str = "25"
    change_detection_batch_size: int = 4
    change_detection_parallel_models: bool = True
    change_detection_parallel_gpu_memory_limit: float = 0.25
    change_detection_parallel_gpu_id: str = ""
    road_confidence_threshold: float = 0.45
    road_min_area_m2: float = 30.0
    road_simplify_tolerance: float = 0.8
    building_confidence_threshold: float = 0.7
    building_min_area_m2: float = 20.0
    building_min_component_pixels: int = 200
    building_simplify_tolerance: float = 0.2


@lru_cache
def get_settings() -> Settings:
    return Settings()
