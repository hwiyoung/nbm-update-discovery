import type {
  ChangeType,
  ReviewStatus,
  ObjectCategory,
  CompareType,
  DatasetSource,
  DatasetStatus,
  HistoryAction,
} from "@/types";

/**
 * 정적 상수 모음 — UI 라벨/색상/옵션의 단일 진실 원천.
 * PROJECT_BRIEF.md §3.3, §3.4 / DESIGN_SYSTEM.md / CLAUDE.md §5.2 기준.
 */

// ============================================================
// 변화 유형 (CHANGE_TYPES) — 폴리곤·차트 색상 일치
// ============================================================

export interface ChangeTypeMeta {
  code: ChangeType;
  label: string;
  model: ObjectCategory;
  color: string;
}

// 표시 순서: 신축(신설) → 소멸 → 갱신. 색상은 건물·도로 통일.
//   신축/신설 #ef4444 red, 소멸 #10b981 emerald, 갱신 #3b82f6 blue.
export const CHANGE_TYPES: readonly ChangeTypeMeta[] = [
  { code: "building_new", label: "신축", model: "building", color: "#ef4444" },
  { code: "building_removed", label: "소멸", model: "building", color: "#10b981" },
  { code: "building_updated", label: "갱신", model: "building", color: "#3b82f6" },
  { code: "road_new", label: "신설", model: "road", color: "#ef4444" },
  { code: "road_removed", label: "소멸", model: "road", color: "#10b981" },
  { code: "road_updated", label: "갱신", model: "road", color: "#3b82f6" },
] as const;

export const CHANGE_TYPE_BY_CODE: Readonly<Record<ChangeType, ChangeTypeMeta>> =
  Object.fromEntries(CHANGE_TYPES.map((c) => [c.code, c])) as Record<
    ChangeType,
    ChangeTypeMeta
  >;

export const VISIBLE_CHANGE_TYPES: readonly ChangeTypeMeta[] = CHANGE_TYPES.filter(
  (item) => item.code !== "road_updated",
);

// ============================================================
// 처리 상태 (REVIEW_STATUSES) — CLAUDE.md §5.3 색
// ============================================================

export type BadgeTone = "slate" | "blue" | "emerald" | "amber" | "red";

export interface ReviewStatusMeta {
  code: ReviewStatus;
  label: string;
  tone: BadgeTone;
}

export const REVIEW_STATUSES: readonly ReviewStatusMeta[] = [
  { code: "pending", label: "미처리", tone: "slate" },
  { code: "in_progress", label: "진행중", tone: "blue" },
  { code: "completed", label: "완료", tone: "emerald" },
  { code: "on_hold", label: "보류", tone: "amber" },
] as const;

export const REVIEW_STATUS_BY_CODE: Readonly<Record<ReviewStatus, ReviewStatusMeta>> =
  Object.fromEntries(REVIEW_STATUSES.map((s) => [s.code, s])) as Record<
    ReviewStatus,
    ReviewStatusMeta
  >;

// ============================================================
// 라벨 사전
// ============================================================

export const OBJECT_CATEGORY_LABEL: Readonly<Record<ObjectCategory, string>> = {
  building: "건물",
  road: "도로",
};

export const COMPARE_TYPE_LABEL: Readonly<Record<CompareType, string>> = {
  "image-image": "정사영상-정사영상",
};

export const DATASET_SOURCE_LABEL: Readonly<Record<DatasetSource, string>> = {
  upload: "직접 업로드",
  aerial: "항공촬영 자산",
  external: "외부 자산",
};

export const DATASET_STATUS_LABEL: Readonly<Record<DatasetStatus, string>> = {
  pending: "처리 대기",
  processing: "처리 중",
  ready: "준비 완료",
  failed: "처리 실패",
};

export const HISTORY_ACTION_LABEL: Readonly<Record<HistoryAction, string>> = {
  classify: "오류분류 부여",
  edit_geometry: "폴리곤 편집",
  edit_meta: "처리 의견 수정",
  create: "신규 추가",
  delete: "삭제",
  restore: "복원",
};

// ============================================================
// 권역 (PROJECT_BRIEF.md §2.2.1)
// ============================================================

export const REGIONS: readonly string[] = [
  "수도권북부",
  "수도권남부",
  "강원",
  "충청",
  "전라동부",
  "전라서부",
  "경북",
  "경남",
] as const;

// ============================================================
// 차트 색상 (DESIGN_SYSTEM.md §1.4)
// ============================================================

export const CHART_COLORS = {
  primary: "#3b82f6",
  success: "#10b981",
  warning: "#f59e0b",
  danger: "#ef4444",
  slate: "#64748b",
  multi: ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4"],
} as const;

// ============================================================
// 입력 제약
// ============================================================

export const REVIEWER_MEMO_MAX_LENGTH = 100;

// ============================================================
// localStorage 키 — 단순 UI 환경설정만 (CLAUDE.md §6.2)
// 도메인 데이터 저장 금지.
// ============================================================

export const STORAGE_KEY = {
  sidebarCollapsed: "nbm.ui.sidebarCollapsed",
  // mock 단계 임시 저장 (이정표 5에서 제거)
  detectionDraft: "nbm.mock.detectionDraft",
  history: "nbm.mock.history",
} as const;
