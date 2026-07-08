import type { Polygon } from "geojson";

/**
 * 데이터셋 (Dataset) — 입력 자원.
 * PROMPTS §1 결정: type 필드 없음 (수치지도 비교는 별도 플랫폼).
 */
export type DatasetSource = "upload" | "aerial" | "external";

export type DatasetStatus =
  | "pending" // 등록만 됨, 처리 대기
  | "processing" // COG 변환 / 메타 추출 중
  | "ready" // 변화탐지 가능
  | "failed";

export interface Dataset {
  id: number;
  source: DatasetSource;
  display_name: string; // 파일명, 예: "Anyang_2023.tif"
  platform: string; // 내부 호환용. 현재 UI 에서는 항공사진으로 고정.
  taken_start_at: string; // ISO 8601
  taken_end_at: string;
  bbox: Polygon; // 자원 커버리지 EPSG:4326
  tile_path: string | null; // 내부 처리/타일 렌더링용 경로
  sheet_codes: string[]; // 커버하는 도엽코드
  regions: string[]; // 커버 도엽이 속한 권역 목록
  primary_region: string | null; // 대표 권역
  capture_year: number | null; // 촬영연도
  host_path: string | null; // UI 표시용 호스트 경로
  status: DatasetStatus;
  thumbnail_url: string | null;
  size_bytes: number | null;
}

export interface DatasetPreflightWarning {
  code: string;
  severity: "warning" | "strong";
  message: string;
  details: Record<string, unknown>;
}

export interface DatasetPreflightRaster {
  dataset_id: number;
  path: string;
  crs: string;
  width: number;
  height: number;
  band_count: number;
  gsd_x_m: number;
  gsd_y_m: number;
  mean_gsd_m: number;
  footprint_area_m2: number;
  footprint_method: string;
  valid_pixel_count: number;
}

export interface DatasetPreflightResult {
  standard: DatasetPreflightRaster;
  compare: DatasetPreflightRaster;
  target_gsd_m: number;
  intersection_area_m2: number;
  overlap_ratio: number;
  overlap_method: string;
  intersection_bounds_5186: number[] | null;
  can_proceed: boolean;
  warnings: DatasetPreflightWarning[];
}

export interface DatasetFilter {
  search: string;
  sources: DatasetSource[]; // 다중선택 (빈 배열 = 전체)
  statuses: DatasetStatus[];
  platform: string | null;
  takenFrom: string | null; // ISO date (YYYY-MM-DD)
  takenTo: string | null;
}

/**
 * 자원 등록 모달 메타 입력값.
 */
export interface DatasetUploadMeta {
  display_name: string;
  platform: string;
  taken_start_at: string;
  taken_end_at: string;
}

/**
 * 자원 등록 진행 상태 (services/upload.ts 가 emit).
 */
export type UploadStage =
  | "idle"
  | "preparing"
  | "uploading"
  | "processing" // 서버측 COG 변환 등
  | "done"
  | "error";

export interface UploadProgress {
  uploadId: string;
  percent: number; // 0~100
  stage: UploadStage;
  message?: string;
}
