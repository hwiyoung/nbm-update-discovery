import { create } from "zustand";
import { STORAGE_KEY } from "@/utils/constants";

/**
 * 전역 UI 환경설정 — 패널 폭, 사이드바 토글 등.
 * 본 스토어만 localStorage 영속 (CLAUDE.md §6.2). 도메인 데이터 저장 금지.
 */
interface PanelWidthsState {
  /** 메인 대시보드 좌 사이드바 (도엽 카드 리스트). */
  dashboardLeftW: number;
  /** 메인 대시보드 우 사이드바 (데이터셋 자원 섹션). */
  dashboardRightW: number;
  /** 도엽 처리 상세 좌 사이드바 (헤더 + 6 아코디언). */
  sheetDetailLeftW: number;
  setDashboardLeftW: (w: number) => void;
  setDashboardRightW: (w: number) => void;
  setSheetDetailLeftW: (w: number) => void;
}

interface UIState extends PanelWidthsState {
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
}

const PANEL_KEYS = {
  dashboardLeftW: "nbm.ui.panel.dashboardLeftW",
  dashboardRightW: "nbm.ui.panel.dashboardRightW",
  sheetDetailLeftW: "nbm.ui.panel.sheetDetailLeftW",
} as const;

const PANEL_DEFAULTS = {
  dashboardLeftW: 320,
  dashboardRightW: 400,
  sheetDetailLeftW: 380,
} as const;

function readNumber(key: string, fallback: number): number {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    const n = Number(raw);
    return Number.isFinite(n) ? n : fallback;
  } catch {
    return fallback;
  }
}

function writeNumber(key: string, value: number): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, String(value));
  } catch {
    /* noop */
  }
}

function readInitialCollapsed(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY.sidebarCollapsed);
    return raw === "true";
  } catch {
    return false;
  }
}

function persistCollapsed(value: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY.sidebarCollapsed, String(value));
  } catch {
    /* noop */
  }
}

export const useUIStore = create<UIState>((set, get) => ({
  sidebarCollapsed: readInitialCollapsed(),
  toggleSidebar: () => {
    const next = !get().sidebarCollapsed;
    persistCollapsed(next);
    set({ sidebarCollapsed: next });
  },
  setSidebarCollapsed: (collapsed) => {
    persistCollapsed(collapsed);
    set({ sidebarCollapsed: collapsed });
  },

  dashboardLeftW: readNumber(PANEL_KEYS.dashboardLeftW, PANEL_DEFAULTS.dashboardLeftW),
  dashboardRightW: readNumber(PANEL_KEYS.dashboardRightW, PANEL_DEFAULTS.dashboardRightW),
  sheetDetailLeftW: readNumber(
    PANEL_KEYS.sheetDetailLeftW,
    PANEL_DEFAULTS.sheetDetailLeftW,
  ),
  setDashboardLeftW: (w) => {
    writeNumber(PANEL_KEYS.dashboardLeftW, w);
    set({ dashboardLeftW: w });
  },
  setDashboardRightW: (w) => {
    writeNumber(PANEL_KEYS.dashboardRightW, w);
    set({ dashboardRightW: w });
  },
  setSheetDetailLeftW: (w) => {
    writeNumber(PANEL_KEYS.sheetDetailLeftW, w);
    set({ sheetDetailLeftW: w });
  },
}));
