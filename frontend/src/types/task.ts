import type { CompareType, ObjectCategory } from "./sheet";
import type { MultiPolygon, Polygon } from "geojson";

/**
 * 변화탐지 작업 (Task) — 1 작업이 N 도엽을 포함.
 * PROMPTS §1 결정: compare_type 은 'image-image' 단일.
 */
export type TaskStatus =
  | "pending" // 큐 대기
  | "running"
  | "succeeded"
  | "failed"
  | "canceled";

export interface Task {
  id: string;
  name: string;
  description: string;
  models: ObjectCategory[];
  compare_type: CompareType;

  standard_resource_id: number | null;
  compare_resource_id: number | null;
  standard_resource_ids: number[];
  compare_resource_ids: number[];

  sheet_codes: string[]; // 작업이 커버하는 도엽
  status: TaskStatus;
  progress: number; // 0~100
  progress_message: string | null;
  progress_stage: string | null;
  progress_detail: Record<string, unknown> | null;
  /** 입력 영상 묶음 양쪽의 합집합을 교차한 실제 처리영역 (EPSG:4326). */
  processing_geometry?: Polygon | MultiPolygon | null;
  processing_area_m2?: number | null;
  progress_updated_at: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  celery_task_id: string | null;

  // 백엔드 단일 진실 원천 — DB 의 활성 detection (NOT is_deleted) 개수.
  // detection import/삭제/추가/복원 시 백엔드 응답에서 갱신된 값을 받아온다.
  detection_count: number;
}

/**
 * 위저드 등록 페이로드 (api/client.ts createTask).
 *
 * auto_run:
 *   true (기본) — 등록 직후 Celery enqueue, 즉시 추론 시작
 *   false — 작업 row 만 생성 (status='pending'), 추후 수동 시작
 */
export interface TaskCreatePayload {
  name: string;
  description: string;
  models: ObjectCategory[];
  compare_type: CompareType;
  standard_resource_id: number;
  compare_resource_id: number;
  standard_resource_ids?: number[];
  compare_resource_ids?: number[];
  auto_run?: boolean;
}
