import type { Polygon } from "geojson";

/**
 * 도엽 (MapSheet) — 처리의 1차 단위.
 * PROJECT_BRIEF.md §3.1 기준. compare_type 은 PROMPTS §1 결정에 따라 'image-image' 단일.
 */
export type ReviewStatus =
  | "pending" // 미처리
  | "in_progress" // 진행중
  | "completed" // 완료
  | "on_hold"; // 보류

export type ObjectCategory = "building" | "road";

export type CompareType = "image-image";

export interface MapSheet {
  code: string; // 도엽코드 8자리
  name: string;
  region: string;
  bbox: [number, number, number, number]; // [minLon, minLat, maxLon, maxLat] EPSG:4326
  geometry: Polygon;
  area_km2: number;

  // 처리 상태
  review_status: ReviewStatus;
  reviewer: string | null;
  reviewed_at: string | null;

  // 작업 메타
  task_id: string;
  models: ObjectCategory[];
  compare_type: CompareType;
  standard_resource_id: number;
  compare_resource_id: number;

  // 메트릭
  f1_score: number | null;
  precision: number | null;
  recall: number | null;

  // 통계
  total_detections: number;
  reviewed_detections: number;
  tp_count: number;
  fp_count: number;
  fn_count: number;
}

/**
 * 도엽 목록 화면(/sheets)의 단일 진실 원천 필터.
 * 좌 사이드바·카드 리스트·지도 격자 색이 모두 동시 구독.
 */
export interface SheetFilter {
  search: string; // 도엽코드·도엽명
  reviewStatuses: ReviewStatus[]; // 다중선택 (빈 배열 = 전체)
  region: string | null; // 단일 권역 ('수도권북부', ...)
  categories: ObjectCategory[]; // 다중선택 (빈 배열 = 전체)
}
