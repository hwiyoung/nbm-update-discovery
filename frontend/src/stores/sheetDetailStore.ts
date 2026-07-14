import { useMemo } from "react";
import { create } from "zustand";
import type { Polygon } from "geojson";
import type {
  ChangeType,
  DetectionFilter,
  DetectionObject,
  MapSheet,
  ObjectCategory,
  ReviewHistory,
  ReviewStatus,
} from "@/types";
import {
  createDetection,
  createTaskDetection,
  editDetectionGeometry,
  editDetectionMeta,
  getDataset,
  getSheet,
  getTaskStatus,
  hardDeleteDetection,
  listDetections,
  listHistory,
  listTaskDetections,
  listTaskHistory,
  softDeleteDetection,
  updateDetection,
  updateSheetStatus,
} from "@/api/client";
import type { Dataset, Task } from "@/types";
import { useTasksStore } from "@/stores/tasksStore";

/**
 * /sheets/:sheetCode 단일 진실 원천 (CLAUDE.md §9.5).
 * 좌 6 아코디언 + 지도 + 우 패널 모두 본 스토어를 구독.
 */
export type ViewerMode = "single" | "split" | "swipe-x" | "swipe-y";
export type EditTool = "select" | "lasso" | "draw" | "edit";
export type RightPanelMode = "closed" | "info" | "report";

interface SheetDetailState {
  // ---- 데이터 ----
  sheet: MapSheet | null;
  detections: DetectionObject[];
  history: ReviewHistory[];

  /** 프로젝트(=task) 단위 진입 시 연결된 영상 (과년도/당해년도). 도엽 단위 진입에선 둘 다 null. */
  standardDataset: Dataset | null;
  compareDataset: Dataset | null;
  /** 다중 입력 작업의 전체 영상 목록. 단일 필드는 기존 컴포넌트 호환용 첫 항목이다. */
  standardDatasets: Dataset[];
  compareDatasets: Dataset[];
  /** 프로젝트 단위 진입 시 현재 task. sheet 단위 진입에선 null. 검수/시작/중단 버튼이 본 값을 구독. */
  task: Task | null;

  // ---- UI 상태 ----
  filter: DetectionFilter;
  viewerMode: ViewerMode;
  editTool: EditTool;
  selectedIds: string[];
  hoveredId: string | null;
  rightPanel: RightPanelMode;

  // ---- 일시 표시 ----
  /** 삭제 이력 시 일정 시간 표시되는 마커 (centerLng, centerLat, expireAt ms). */
  deletionMarkers: DeletionMarker[];

  // ---- 메타 ----
  loading: boolean;
  error: string | null;
}

export interface DeletionMarker {
  id: string;
  lng: number;
  lat: number;
  expireAt: number;
}

interface SheetDetailActions {
  load: (sheetCode: string) => Promise<void>;
  /**
   * Task(=프로젝트) 단위 로드. 도엽 분할 없이 전체 폴리곤 집계.
   * - sheet 슬롯에는 task 의 union bbox + sheet_codes 메타를 담은 synthetic MapSheet 주입.
   * - detections 는 모든 sheet 의 객체 합쳐서 로드.
   */
  loadByTask: (taskId: string) => Promise<void>;
  reset: () => void;

  setFilter: (partial: Partial<DetectionFilter>) => void;
  resetFilter: () => void;
  setViewerMode: (mode: ViewerMode) => void;
  setEditTool: (tool: EditTool) => void;
  selectObject: (id: string | null) => void;
  /** 외부(리포트/이력 리스트)에서 선택할 때 사용 — 지도 fly 도 발동.
      map 폴리곤 직접 클릭은 selectObject (fly 안 함). */
  selectAndFly: (id: string) => void;
  /** SelectionFlyController 가 구독. 명시적 fly 요청 시 1 증가. */
  selectFlyTick: number;
  /**
   * 선택 없이 좌표(폴리곤) 위치로만 이동. 처리 히스토리에서 삭제된 폴리곤
   * 위치로 이동할 때 사용 — detection 이 hard-delete 되어 store 에 없어도
   * history.geometry 가 보존되므로 위치 panTo 가능.
   */
  flyToGeometry: (geometry: Polygon) => void;
  /** SelectionFlyController 가 구독. flyToGeometry 호출 시 1 증가. */
  geometryFlyTick: number;
  /** flyToGeometry 직전 호출에서 들어간 폴리곤 좌표. */
  pendingFlyGeometry: Polygon | null;
  selectMany: (ids: string[]) => void;
  clearSelection: () => void;
  setHovered: (id: string | null) => void;
  openRightPanel: (mode: Exclude<RightPanelMode, "closed">) => void;
  closeRightPanel: () => void;

  // 액션 (백엔드 swap-ready)
  applyEditGeometry: (
    id: string,
    geometry: Polygon,
    memo: string,
  ) => Promise<void>;
  applyEditMeta: (id: string, reviewerMemo: string) => Promise<void>;
  /** 편집 모드에서 객체 카테고리(model) / 변화 유형(change_type) 수정. */
  applyEditDetails: (
    id: string,
    patch: { model?: ObjectCategory; change_type?: ChangeType },
  ) => Promise<void>;
  applySoftDelete: (id: string, deleted: boolean, memo: string) => Promise<void>;
  /** 다중 선택 일괄 삭제 (soft) — 각 객체마다 history 1건씩 기록, refresh 1회. */
  applySoftDeleteMany: (ids: string[], memo: string) => Promise<void>;
  /** 영구 삭제 — DB row 삭제. Undo 불가. */
  applyHardDelete: (id: string) => Promise<void>;
  /** 다중 선택 일괄 영구 삭제. */
  applyHardDeleteMany: (ids: string[]) => Promise<void>;
  applyCreate: (
    draft: Omit<DetectionObject, "id" | "sheet_code">,
  ) => Promise<void>;

  setSheetReviewStatus: (status: ReviewStatus) => Promise<void>;

  pruneDeletionMarkers: () => void;
}

type Store = SheetDetailState & SheetDetailActions;

const ALL_CHANGE_TYPE_CODES: ChangeType[] = [
  "building_new",
  "building_removed",
  "building_updated",
  "road_new",
  "road_removed",
];

const initialFilter: DetectionFilter = {
  confidenceMin: 0,
  confidenceMax: 100,
  changeTypes: [...ALL_CHANGE_TYPE_CODES],
  regionCode: null,
};

const initialState: SheetDetailState & {
  selectFlyTick: number;
  geometryFlyTick: number;
  pendingFlyGeometry: Polygon | null;
} = {
  sheet: null,
  detections: [],
  history: [],
  standardDataset: null,
  compareDataset: null,
  standardDatasets: [],
  compareDatasets: [],
  task: null,
  filter: { ...initialFilter },
  viewerMode: "split",
  editTool: "select",
  selectedIds: [],
  hoveredId: null,
  rightPanel: "closed",
  deletionMarkers: [],
  loading: false,
  error: null,
  selectFlyTick: 0,
  geometryFlyTick: 0,
  pendingFlyGeometry: null,
};

export const useSheetDetailStore = create<Store>((set, get) => ({
  ...initialState,

  load: async (sheetCode) => {
    // 진입 시 이전 도엽 잔재 정리 + 로딩 상태
    set({ ...initialState, loading: true });
    try {
      const [sheet, detections, history] = await Promise.all([
        getSheet(sheetCode),
        listDetections(sheetCode),
        listHistory(sheetCode),
      ]);
      set({
        sheet,
        detections,
        history,
        loading: false,
      });
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : String(err),
        loading: false,
      });
    }
  },

  loadByTask: async (taskId) => {
    set({ ...initialState, loading: true });
    try {
      // 1) task + 모든 detections + 처리 이력 동시에
      const [task, detections, history] = await Promise.all([
        getTaskStatus(taskId),
        listTaskDetections(taskId),
        listTaskHistory(taskId),
      ]);

      // 2) sheet_codes 의 첫 sheet 로 메타(권역 등) 가져오기 + 모든 sheet 의 bbox/geometry 로 union 계산
      let mergedSheet: MapSheet;
      if (task.sheet_codes.length > 0) {
        const sheets = await Promise.all(
          task.sheet_codes.map((c) => getSheet(c).catch(() => null)),
        );
        const validSheets = sheets.filter((s): s is MapSheet => s !== null);
        if (validSheets.length === 0) {
          throw new Error("프로젝트 처리 도엽 정보를 불러오지 못했습니다");
        }
        // bbox union (4326): minLng, minLat, maxLng, maxLat
        let minLng = Infinity, minLat = Infinity;
        let maxLng = -Infinity, maxLat = -Infinity;
        for (const s of validSheets) {
          minLng = Math.min(minLng, s.bbox[0]);
          minLat = Math.min(minLat, s.bbox[1]);
          maxLng = Math.max(maxLng, s.bbox[2]);
          maxLat = Math.max(maxLat, s.bbox[3]);
        }
        const totalDet = validSheets.reduce(
          (sum, s) => sum + (s.total_detections ?? 0),
          0,
        );

        mergedSheet = {
          code: task.id,
          name: task.name,
          region: validSheets[0]?.region ?? "기타",
          bbox: [minLng, minLat, maxLng, maxLat],
          // synthetic geometry는 도엽 메타 호환 및 결과가 없을 때의 초기 뷰용이다.
          geometry: {
            type: "Polygon",
            coordinates: [[
              [minLng, minLat],
              [maxLng, minLat],
              [maxLng, maxLat],
              [minLng, maxLat],
              [minLng, minLat],
            ]],
          },
          area_km2: validSheets.reduce((sum, s) => sum + (s.area_km2 ?? 0), 0),
          review_status: "in_progress" as ReviewStatus,
          reviewer: null,
          reviewed_at: null,
          task_id: task.id,
          models: task.models,
          compare_type: task.compare_type,
          standard_resource_id: task.standard_resource_id,
          compare_resource_id: task.compare_resource_id,
          f1_score: null,
          precision: null,
          recall: null,
          total_detections: totalDet,
          reviewed_detections: 0,
          tp_count: 0,
          fp_count: 0,
          fn_count: 0,
        } as MapSheet;
      } else {
        throw new Error("프로젝트에 매칭된 도엽이 없습니다");
      }

      // 3) 과년도/당해년도 전체 dataset fetch. 새 배열 필드를 우선 사용하고,
      // 배열이 없는 기존 작업만 호환용 단일 ID로 대체한다.
      const standardIds = normalizeTaskResourceIds(
        task.standard_resource_ids,
        task.standard_resource_id,
      );
      const compareIds = normalizeTaskResourceIds(
        task.compare_resource_ids,
        task.compare_resource_id,
      );
      const [stdDatasets, cmpDatasets] = await Promise.all([
        loadDatasetsByIds(standardIds),
        loadDatasetsByIds(compareIds),
      ]);
      const stdDs = stdDatasets[0] ?? null;
      const cmpDs = cmpDatasets[0] ?? null;

      set({
        sheet: mergedSheet,
        detections,
        history,
        standardDataset: stdDs,
        compareDataset: cmpDs,
        standardDatasets: stdDatasets,
        compareDatasets: cmpDatasets,
        task,
        loading: false,
      });
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : String(err),
        loading: false,
      });
    }
  },

  reset: () => set({ ...initialState }),

  setFilter: (partial) =>
    set((state) => ({ filter: { ...state.filter, ...partial } })),
  resetFilter: () => set({ filter: { ...initialFilter } }),

  setViewerMode: (viewerMode) => set({ viewerMode }),
  setEditTool: (editTool) => set({ editTool, selectedIds: [] }),

  selectFlyTick: 0,
  selectAndFly: (id) =>
    set((state) => ({
      selectedIds: [id],
      rightPanel: state.rightPanel === "closed" ? "info" : state.rightPanel,
      selectFlyTick: state.selectFlyTick + 1,
    })),
  geometryFlyTick: 0,
  pendingFlyGeometry: null,
  flyToGeometry: (geometry) =>
    set((state) => ({
      pendingFlyGeometry: geometry,
      geometryFlyTick: state.geometryFlyTick + 1,
    })),
  selectObject: (id) =>
    set((state) => ({
      selectedIds: id ? [id] : [],
      // 단건 선택 시 우 패널 자동 열기 (정보 모드) + 객체로 fly
      rightPanel: id ? "info" : state.rightPanel,
      selectFlyTick: id ? state.selectFlyTick + 1 : state.selectFlyTick,
    })),
  selectMany: (ids) =>
    set((state) => ({
      selectedIds: ids,
      // 다중 선택 시에도 우 패널 자동 열기 (일괄 분류 UX)
      rightPanel: ids.length > 0 ? "info" : state.rightPanel,
    })),
  clearSelection: () => set({ selectedIds: [] }),
  setHovered: (id) => set({ hoveredId: id }),
  openRightPanel: (mode) => set({ rightPanel: mode }),
  closeRightPanel: () => set({ rightPanel: "closed" }),

  applyEditGeometry: async (id, geometry, memo) => {
    const sheet = get().sheet;
    if (!sheet) return;
    const det = get().detections.find((d) => d.id === id);
    if (!det) return;
    const before = { geometry: det.geometry };
    await editDetectionGeometry(det.sheet_code, id, geometry, memo, sheet.task_id ?? null);
    pushHistory(set, [makeHistoryEntry({
      det, action: "edit_geometry", before, after: { geometry }, memo,
    })]);
    await refreshDetections(set, sheet);
  },

  applyEditMeta: async (id, reviewerMemo) => {
    const sheet = get().sheet;
    if (!sheet) return;
    const det = get().detections.find((d) => d.id === id);
    if (!det) return;
    const before = { reviewer_memo: det.reviewer_memo };
    await editDetectionMeta(det.sheet_code, id, reviewerMemo, sheet.task_id ?? null);
    pushHistory(set, [makeHistoryEntry({
      det, action: "edit_meta", before, after: { reviewer_memo: reviewerMemo }, memo: reviewerMemo,
    })]);
    await refreshDetections(set, sheet);
  },

  applyEditDetails: async (id, patch) => {
    const sheet = get().sheet;
    if (!sheet) return;
    const det = get().detections.find((d) => d.id === id);
    if (!det) return;
    const before: Partial<DetectionObject> = {};
    if (patch.model !== undefined) before.model = det.model;
    if (patch.change_type !== undefined) before.change_type = det.change_type;
    await updateDetection(det.sheet_code, id, patch, sheet.task_id ?? null);
    pushHistory(set, [makeHistoryEntry({
      det, action: "edit_meta", before, after: patch, memo: null,
    })]);
    await refreshDetections(set, sheet);
  },

  applySoftDelete: async (id, deleted, memo) => {
    const sheet = get().sheet;
    if (!sheet) return;
    const target = get().detections.find((d) => d.id === id);
    if (!target) return;
    const before = { is_deleted: target.is_deleted };
    await softDeleteDetection(target.sheet_code, id, deleted, memo, sheet.task_id ?? null);
    pushHistory(set, [makeHistoryEntry({
      det: target,
      action: deleted ? "delete" : "restore",
      before,
      after: { is_deleted: deleted },
      memo,
    })]);
    await refreshDetections(set, sheet);
    // 삭제 마커 5초 표시
    if (deleted && target) {
      const marker = makeDeletionMarker(target);
      if (marker) set((s) => ({ deletionMarkers: [...s.deletionMarkers, marker] }));
    }
  },

  applyHardDelete: async (id) => {
    const sheet = get().sheet;
    if (!sheet) return;
    const target = get().detections.find((d) => d.id === id);
    if (!target) return;
    await hardDeleteDetection(id, sheet.task_id ?? null);
    // 영구 삭제는 Undo 불가 — pushHistory 호출 안 함.
    // 백엔드가 review_histories 에 'delete' 이력은 기록함 (감사용).
    await refreshDetections(set, sheet);
    const marker = makeDeletionMarker(target);
    if (marker) set((s) => ({ deletionMarkers: [...s.deletionMarkers, marker] }));
    set({ selectedIds: [] });
  },

  applyHardDeleteMany: async (ids) => {
    const sheet = get().sheet;
    if (!sheet) return;
    const taskId = sheet.task_id ?? null;
    const detections = get().detections;
    const targets = ids
      .map((id) => detections.find((d) => d.id === id))
      .filter((d): d is DetectionObject => d != null);
    if (targets.length === 0) return;
    const newMarkers: DeletionMarker[] = [];
    for (const det of targets) {
      try {
        await hardDeleteDetection(det.id, taskId);
        const marker = makeDeletionMarker(det);
        if (marker) newMarkers.push(marker);
      } catch (err) {
        console.error(`[applyHardDeleteMany] failed for ${det.id}:`, err);
      }
    }
    if (newMarkers.length > 0) {
      set((s) => ({ deletionMarkers: [...s.deletionMarkers, ...newMarkers] }));
    }
    await refreshDetections(set, sheet);
    set({ selectedIds: [] });
  },

  applySoftDeleteMany: async (ids, memo) => {
    const sheet = get().sheet;
    if (!sheet) return;
    const taskId = sheet.task_id ?? null;
    const detections = get().detections;
    const targets = ids
      .map((id) => detections.find((d) => d.id === id))
      .filter((d): d is DetectionObject => d != null && !d.is_deleted);
    if (targets.length === 0) return;

    // 각 detection 의 sheet_code 가 다를 수 있어 개별 호출 — 백엔드 트랜잭션은 행 단위.
    const entries: ReviewHistory[] = [];
    const newMarkers: DeletionMarker[] = [];
    for (const det of targets) {
      try {
        await softDeleteDetection(det.sheet_code, det.id, true, memo, taskId);
        entries.push(makeHistoryEntry({
          det,
          action: "delete",
          before: { is_deleted: det.is_deleted },
          after: { is_deleted: true },
          memo,
        }));
        const marker = makeDeletionMarker(det);
        if (marker) newMarkers.push(marker);
      } catch (err) {
        // 일부 실패 시 멈추지 않고 진행, 나중에 toast.error 로 알려야 함 (호출자 책임).
        console.error(`[applySoftDeleteMany] failed for ${det.id}:`, err);
      }
    }

    if (entries.length > 0) pushHistory(set, entries);
    if (newMarkers.length > 0) {
      set((s) => ({ deletionMarkers: [...s.deletionMarkers, ...newMarkers] }));
    }
    await refreshDetections(set, sheet);
    set({ selectedIds: [] });
  },

  applyCreate: async (draft) => {
    const sheet = get().sheet;
    if (!sheet) return;
    const isTaskMode = sheet.task_id != null && sheet.code === sheet.task_id;
    const created = isTaskMode
      ? await createTaskDetection(sheet.task_id!, draft)
      : await createDetection(sheet.code, draft, sheet.task_id ?? null);
    // history entry 를 store 에 직접 push (client-side memory undo).
    pushHistory(set, [{
      id: `h-${Date.now()}`,
      object_id: created.id,
      sheet_code: created.sheet_code,
      task_id: sheet.task_id ?? null,
      model: created.model,
      change_type: created.change_type,
      geometry: created.geometry,
      action: "create",
      before: null,
      after: { ...created },
      reviewer: "처리자",
      reviewed_at: new Date().toISOString(),
      memo: null,
    }]);
    await refreshDetections(set, sheet);
    set({ selectedIds: [created.id] });
  },

  setSheetReviewStatus: async (status) => {
    const sheet = get().sheet;
    if (!sheet) return;
    const next = await updateSheetStatus(sheet.code, status);
    set({ sheet: next });
  },

  pruneDeletionMarkers: () => {
    const now = Date.now();
    set((s) => ({
      deletionMarkers: s.deletionMarkers.filter((m) => m.expireAt > now),
    }));
  },
}));

function normalizeTaskResourceIds(
  ids: number[] | null | undefined,
  fallback: number | null,
): number[] {
  const normalized: number[] = [];
  for (const id of [...(ids ?? []), fallback]) {
    if (id == null || normalized.includes(id)) continue;
    normalized.push(id);
  }
  return normalized;
}

async function loadDatasetsByIds(ids: number[]): Promise<Dataset[]> {
  const loaded = await Promise.all(
    ids.map((id) => getDataset(id).catch(() => null)),
  );
  return loaded.filter((dataset): dataset is Dataset => dataset !== null);
}

/**
 * write action 시 store.history 에 entry 들을 push (client-side memory undo).
 * 새 액션이 발생하면 redoStack 무효화.
 */
function makeDeletionMarker(det: DetectionObject): DeletionMarker | null {
  const ring = det.geometry.coordinates[0] ?? [];
  if (ring.length === 0) return null;
  let lng = 0;
  let lat = 0;
  for (const [x, y] of ring.slice(0, -1)) {
    lng += x;
    lat += y;
  }
  const n = Math.max(1, ring.length - 1);
  return {
    id: det.id,
    lng: lng / n,
    lat: lat / n,
    expireAt: Date.now() + 5_000,
  };
}

function pushHistory(
  set: (partial: Partial<Store> | ((s: Store) => Partial<Store>)) => void,
  entries: ReviewHistory[],
) {
  if (entries.length === 0) return;
  set((s) => ({
    history: [...s.history, ...entries],
  }));
}

function makeHistoryEntry(args: {
  det: DetectionObject;
  action: ReviewHistory["action"];
  before: Partial<DetectionObject> | null;
  after: Partial<DetectionObject> | null;
  memo: string | null;
  taskId?: string | null;
}): ReviewHistory {
  return {
    id: `h-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`,
    object_id: args.det.id,
    sheet_code: args.det.sheet_code,
    task_id: args.taskId ?? null,
    model: args.det.model,
    change_type: args.det.change_type,
    geometry: args.det.geometry,
    action: args.action,
    before: args.before as ReviewHistory["before"],
    after: args.after as ReviewHistory["after"],
    reviewer: "처리자",
    reviewed_at: new Date().toISOString(),
    memo: args.memo,
  };
}

async function refreshFromBackend(
  set: (partial: Partial<Store>) => void,
  sheetCode: string,
) {
  const [next, history] = await Promise.all([
    listDetections(sheetCode),
    listHistory(sheetCode),
  ]);
  set({ detections: next, history });
}

/**
 * Sheet 모드 / Task 모드 자동 분기로 detections 재로드.
 * task 모드 (sheet.code === sheet.task_id) 면 listTaskDetections, 아니면 listDetections.
 */
async function refreshDetections(
  set: (partial: Partial<Store>) => void,
  sheet: MapSheet,
) {
  const isTaskMode = sheet.task_id != null && sheet.code === sheet.task_id;
  if (isTaskMode) {
    const [next, history] = await Promise.all([
      listTaskDetections(sheet.task_id!),
      listTaskHistory(sheet.task_id!),
    ]);
    set({ detections: next, history });
  } else {
    await refreshFromBackend(set, sheet.code);
  }

  // detection mutation 으로 인한 count 변화를 대시보드 카드에 즉시 반영.
  // tasksStore 가 본 store 를 import 하지 않으므로 순환 없음.
  if (sheet.task_id) {
    void useTasksStore.getState().refreshTask(sheet.task_id);
  }
}

// ============================================================
// Selectors — 단일 진실 원천 derived 데이터
// ============================================================

export function applyDetectionFilter(
  detections: DetectionObject[],
  filter: DetectionFilter,
): DetectionObject[] {
  return detections.filter((d) => {
    if (d.is_deleted) return false; // 삭제 객체는 일반 표시에서 제외
    if (d.confidence < filter.confidenceMin) return false;
    if (d.confidence > filter.confidenceMax) return false;
    if (!filter.changeTypes.includes(d.change_type)) {
      return false;
    }
    if (filter.regionCode && !d.region_code.startsWith(filter.regionCode)) {
      return false;
    }
    return true;
  });
}

export function useFilteredDetections(): DetectionObject[] {
  const detections = useSheetDetailStore((s) => s.detections);
  const filter = useSheetDetailStore((s) => s.filter);
  return useMemo(
    () => applyDetectionFilter(detections, filter),
    [detections, filter],
  );
}

export interface ChangeTypeCount {
  filtered: number;
  total: number;
}
export function useChangeTypeCounts(): Record<ChangeType, ChangeTypeCount> {
  const detections = useSheetDetailStore((s) => s.detections);
  const filtered = useFilteredDetections();
  return useMemo(() => {
    const empty: Record<string, ChangeTypeCount> = {};
    const codes: ChangeType[] = ALL_CHANGE_TYPE_CODES;
    for (const c of codes) empty[c] = { filtered: 0, total: 0 };
    for (const d of detections) {
      if (d.is_deleted) continue;
      empty[d.change_type]!.total += 1;
    }
    for (const d of filtered) {
      empty[d.change_type]!.filtered += 1;
    }
    return empty as Record<ChangeType, ChangeTypeCount>;
  }, [detections, filtered]);
}

export function useDetectionById(id: string | null): DetectionObject | null {
  const detections = useSheetDetailStore((s) => s.detections);
  return useMemo(
    () => (id ? detections.find((d) => d.id === id) ?? null : null),
    [detections, id],
  );
}

/** 처리 완료 처리 가능 여부: 활성 객체가 1건 이상 존재해야 함. */
export function useCanCompleteSheet(): boolean {
  const detections = useSheetDetailStore((s) => s.detections);
  return useMemo(() => {
    return detections.some((d) => !d.is_deleted);
  }, [detections]);
}
