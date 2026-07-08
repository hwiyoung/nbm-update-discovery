import type { Polygon } from "geojson";
import type { ChangeType, DetectionObject } from "./detection";
import type { ObjectCategory } from "./sheet";

/**
 * 처리 이력 (ReviewHistory) — PROJECT_BRIEF.md §3.6
 * Undo/Redo 의 before/after 단위로도 사용.
 */
export type HistoryAction =
  | "classify"
  | "edit_geometry"
  | "edit_meta"
  | "create"
  | "delete"
  | "restore";

export interface ReviewHistory {
  id: string;
  object_id: string;
  sheet_code: string;
  /** 본 이력이 속한 프로젝트. legacy 행은 null — sheet_code fallback 으로 노출됨. */
  task_id: string | null;
  model: ObjectCategory;
  change_type: ChangeType;
  geometry: Polygon; // 변경 시점 형상

  action: HistoryAction;
  before: Partial<DetectionObject> | null;
  after: Partial<DetectionObject> | null;

  reviewer: string;
  reviewed_at: string;
  memo: string | null;
}
