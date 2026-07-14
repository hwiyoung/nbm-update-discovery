import { useMemo } from "react";
import { create } from "zustand";
import type { MapSheet, SheetFilter } from "@/types";
import { listSheets, listRegions } from "@/api/client";

/**
 * /sheets 화면의 단일 진실 원천 필터 + 데이터 (CLAUDE.md §9.5).
 * 좌 사이드바 카드 + 지도(권역 + 도엽 메타) 가 모두 동시 구독.
 *
 * filteredSheets 는 selector 로 store 외부에서 계산 (useFilteredSheets).
 */
interface SheetsState {
  filter: SheetFilter;
  sheets: MapSheet[];
  /** 8개 권역 디졸브 GeoJSON (지도 기본 overlay). */
  regions: GeoJSON.FeatureCollection | null;
  hoveredSheetCode: string | null;
  /** 프로젝트 row/처리영역 hover 미리보기. */
  highlightedTaskId: string | null;
  /** 클릭해 선택한 프로젝트. 지도에서 해당 프로젝트 도엽을 파란색으로 유지. */
  selectedTaskId: string | null;
  /** 같은 프로젝트를 다시 클릭해도 실제 처리영역으로 fly 하기 위한 ticker. */
  selectedTaskTick: number;
  /** 사용자가 row 클릭 등으로 "포커스" 한 도엽. 지도가 fly 하고 강조 표시. */
  selectedSheetCode: string | null;
  /** 선택 후 1회만 fly 하도록 ticker 증가 (같은 코드 재클릭 시도 다시 fly). */
  flyTick: number;
  /** N매 도엽 union bbox 로 fly. setFlyBounds 호출 시 ticker 증가. */
  flyBounds: [number, number, number, number] | null;
  flyBoundsTick: number;
  loading: boolean;
  regionsLoading: boolean;
  error: string | null;

  setFilter: (partial: Partial<SheetFilter>) => void;
  resetFilter: () => void;
  setHoveredSheet: (code: string | null) => void;
  setHighlightedTask: (taskId: string | null) => void;
  setSelectedTask: (taskId: string | null) => void;
  setSelectedSheet: (code: string | null) => void;
  clearMapSelection: () => void;
  /** sheet_codes 의 union bbox 로 지도 fly. 코드가 store 에 있는 sheet 들로 한정. */
  flyToSheets: (codes: string[]) => void;
  loadSheets: () => Promise<void>;
  loadRegions: () => Promise<void>;
}

const initialFilter: SheetFilter = {
  search: "",
  reviewStatuses: [],
  region: null,
  categories: [],
};

export const useSheetsStore = create<SheetsState>((set, get) => ({
  filter: { ...initialFilter },
  sheets: [],
  regions: null,
  hoveredSheetCode: null,
  highlightedTaskId: null,
  selectedTaskId: null,
  selectedTaskTick: 0,
  selectedSheetCode: null,
  flyTick: 0,
  flyBounds: null,
  flyBoundsTick: 0,
  loading: false,
  regionsLoading: false,
  error: null,

  setFilter: (partial) =>
    set((state) => ({ filter: { ...state.filter, ...partial } })),
  resetFilter: () => set({ filter: { ...initialFilter } }),
  setHoveredSheet: (code) => set({ hoveredSheetCode: code }),
  setHighlightedTask: (taskId) => set({ highlightedTaskId: taskId }),
  setSelectedTask: (taskId) =>
    set((state) => ({
      selectedTaskId: taskId,
      selectedTaskTick: taskId
        ? state.selectedTaskTick + 1
        : state.selectedTaskTick,
      selectedSheetCode: null,
    })),
  setSelectedSheet: (code) =>
    set((state) => ({
      selectedSheetCode: code,
      // 같은 코드를 다시 눌러도 fly 가 다시 발동되도록 tick 증가
      flyTick: code ? state.flyTick + 1 : state.flyTick,
    })),
  clearMapSelection: () =>
    set({ selectedTaskId: null, selectedSheetCode: null }),
  flyToSheets: (codes) => {
    if (codes.length === 0) return;
    const sheetByCode = new Map(get().sheets.map((s) => [s.code, s]));
    let minLng = Infinity, minLat = Infinity;
    let maxLng = -Infinity, maxLat = -Infinity;
    let found = 0;
    for (const code of codes) {
      const s = sheetByCode.get(code);
      if (!s) continue;
      minLng = Math.min(minLng, s.bbox[0]);
      minLat = Math.min(minLat, s.bbox[1]);
      maxLng = Math.max(maxLng, s.bbox[2]);
      maxLat = Math.max(maxLat, s.bbox[3]);
      found += 1;
    }
    if (found === 0) return;
    set((state) => ({
      flyBounds: [minLng, minLat, maxLng, maxLat],
      flyBoundsTick: state.flyBoundsTick + 1,
    }));
  },

  loadSheets: async () => {
    set({ loading: true, error: null });
    try {
      const sheets = await listSheets();
      set({ sheets, loading: false });
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : String(err),
        loading: false,
      });
    }
  },

  loadRegions: async () => {
    set({ regionsLoading: true });
    try {
      const regions = await listRegions();
      set({ regions, regionsLoading: false });
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : String(err),
        regionsLoading: false,
      });
    }
  },
}));

/**
 * filter 적용된 도엽 목록 — 카드 + 지도 색 동시 구독.
 * selector 로 분리해 SheetCard 와 SheetMap 모두 동일 결과를 사용.
 */
export function applyFilter(sheets: MapSheet[], filter: SheetFilter): MapSheet[] {
  const search = filter.search.trim().toLowerCase();
  return sheets.filter((s) => {
    if (search) {
      const haystack = `${s.code} ${s.name}`.toLowerCase();
      if (!haystack.includes(search)) return false;
    }
    if (filter.reviewStatuses.length > 0) {
      if (!filter.reviewStatuses.includes(s.review_status)) return false;
    }
    if (filter.region && s.region !== filter.region) {
      return false;
    }
    if (filter.categories.length > 0) {
      const hit = filter.categories.some((c) => s.models.includes(c));
      if (!hit) return false;
    }
    return true;
  });
}

/** 컴포넌트에서 직접 호출 — re-render 안전한 selector. */
export function useFilteredSheets(): MapSheet[] {
  const sheets = useSheetsStore((s) => s.sheets);
  const filter = useSheetsStore((s) => s.filter);
  return useMemo(() => applyFilter(sheets, filter), [sheets, filter]);
}
