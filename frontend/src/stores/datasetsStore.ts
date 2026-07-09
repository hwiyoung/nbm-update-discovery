import { useMemo } from "react";
import { create } from "zustand";
import type { Dataset, DatasetFilter, ObjectCategory } from "@/types";
import type { BBox, OrthoGroup } from "@/types/mapProject";
import { deleteDataset as apiDeleteDataset, listDatasets } from "@/api/client";
import { toggleCurrentInGroups, togglePastInGroups } from "@/utils/mapProject";

/**
 * /datasets 화면 + 위저드 상태.
 * - filter selector → 카드 그리드 동시 반응
 * - 위저드 3단계 (자원 1/2 + 메타 3)
 */
export type WizardStep = "draw" | "review" | "meta";

/**
 * 위저드 단계에서 사용자가 ServerFileBrowser 로 선택한 서버 측 파일.
 * (Docker 컨테이너에 마운트된 폴더 — /data/storage, /media, /mnt 등)
 * 위저드 최종 제출 시점에 path 만 backend 로 보내 dataset 등록.
 */
export interface PendingDataset {
  /** 서버 측 절대 경로 (백엔드가 ALLOWED_ROOTS 안에서만 허용). */
  server_path: string;
  /** 파일명 (표시용). */
  source_name: string;
  /** 파일 크기 (표시용, byte). */
  size_bytes: number;
  display_name: string;
  platform: string;
  /** 촬영 연도 (4자리, 예: "2024"). 등록 시 YYYY-01-01 ~ YYYY-12-31 로 변환. */
  taken_year: string;
}

/**
 * 백그라운드 등록 진행 항목 — 데이터셋 패널 상단·헤더 종 알림이 구독.
 * phase 별 단계 진행 + percent 0~100. 완료 후 5초 자동 제거.
 */
export type PendingUploadPhase =
  | "uploading"      // multipart 전송
  | "analyzing"      // 백엔드 좌표 분석 / sheet_codes 매칭
  | "registering"    // createTask 호출 중
  | "done"
  | "error";

export interface PendingUpload {
  id: string;
  display_name: string;
  side: "standard" | "compare" | "standalone";
  phase: PendingUploadPhase;
  percent: number;
  message?: string;
  error?: string;
  created_at: number;
}

export interface WizardSelection {
  /** 지도에서 지정한 변화탐지 대상 bbox (EPSG:4326). */
  drawnBBox: BBox | null;
  /** drawnBBox 와 교차하는 과년도/당해년도 정사영상 후보 그룹. */
  groups: OrthoGroup[];
  /** 지도 footprint / 테이블 hover 동기화용. */
  hoveredOrthoId: string | null;
  /** 기존 자원 선택. pending 과 상호 배타 (자원 1개당 둘 중 하나). */
  standardId: number | null;
  compareId: number | null;
  /** 서버 파일 브라우저에서 새로 추가한 파일 (제출 시 등록 예정). */
  standardPending: PendingDataset | null;
  comparePending: PendingDataset | null;
  name: string;
  description: string;
  models: ObjectCategory[];
  /** true (기본): 등록 직후 Celery enqueue (즉시 추론). false: 작업만 등록, 추후 수동 시작. */
  autoRun: boolean;
}

interface DatasetsState {
  datasets: Dataset[];
  filter: DatasetFilter;
  loading: boolean;
  error: string | null;

  // Wizard
  wizardOpen: boolean;
  wizardStep: WizardStep;
  wizardSelection: WizardSelection;

  // Upload
  uploadOpen: boolean;

  /** 위저드 등록 직후 폴링할 task ID. /sheets 의 진행 배너가 구독. */
  pendingTaskId: string | null;
  setPendingTaskId: (id: string | null) => void;

  /** 백그라운드 등록 작업. 데이터셋 패널 상단 + 헤더 종 알림이 구독. */
  pendingUploads: PendingUpload[];
  addPendingUpload: (entry: Omit<PendingUpload, "created_at">) => void;
  updatePendingUpload: (id: string, patch: Partial<PendingUpload>) => void;
  removePendingUpload: (id: string) => void;

  loadDatasets: () => Promise<void>;
  setFilter: (partial: Partial<DatasetFilter>) => void;
  resetFilter: () => void;

  openWizard: () => void;
  closeWizard: () => void;
  setWizardStep: (step: WizardStep) => void;
  setWizardSelection: (partial: Partial<WizardSelection>) => void;
  setWizardDrawnBBox: (bbox: BBox | null) => void;
  setWizardGroups: (groups: OrthoGroup[]) => void;
  setWizardHoveredOrtho: (id: string | null) => void;
  toggleWizardPast: (pastId: string) => void;
  toggleWizardCurrent: (currentId: string) => void;
  resetWizard: () => void;

  openUpload: () => void;
  closeUpload: () => void;
  appendDataset: (dataset: Dataset) => void;
  /** 데이터셋 하드 삭제 — 사용 중이면 throw. 성공 시 store 에서 제거. */
  deleteDataset: (id: number) => Promise<void>;

  /** 최근 등록된(=appendDataset 으로 push 된) 자원 id 들. 12초 자동 만료.
   *  DatasetRow 가 "방금 등록됨" highlight 노출용으로 구독. */
  recentlyAddedDatasetIds: number[];
  markDatasetRecent: (id: number) => void;
  unmarkDatasetRecent: (id: number) => void;

  /** 대시보드 베이스맵에 bbox 표시 대상 — DatasetRow 클릭 시 토글.
   *  flyTick 은 같은 row 재클릭 시에도 fly 재발동을 위한 카운터. */
  selectedDatasetId: number | null;
  selectedDatasetFlyTick: number;
  selectDataset: (id: number | null) => void;
}

const initialFilter: DatasetFilter = {
  search: "",
  sources: [],
  statuses: [],
  platform: null,
  takenFrom: null,
  takenTo: null,
};

const initialWizard: WizardSelection = {
  drawnBBox: null,
  groups: [],
  hoveredOrthoId: null,
  standardId: null,
  compareId: null,
  standardPending: null,
  comparePending: null,
  name: "",
  description: "",
  // 객체 카테고리 기본값 — 건물·도로 모두 선택. 사용자가 위저드 진입 시 즉시 등록 가능.
  models: ["building", "road"],
  autoRun: true,
};

export const useDatasetsStore = create<DatasetsState>((set) => ({
  datasets: [],
  filter: { ...initialFilter },
  loading: false,
  error: null,

  wizardOpen: false,
  wizardStep: "draw",
  wizardSelection: { ...initialWizard },

  uploadOpen: false,

  pendingTaskId: null,
  setPendingTaskId: (pendingTaskId) => set({ pendingTaskId }),

  pendingUploads: [],
  addPendingUpload: (entry) =>
    set((s) => ({
      pendingUploads: [
        ...s.pendingUploads,
        { ...entry, created_at: Date.now() },
      ],
    })),
  updatePendingUpload: (id, patch) =>
    set((s) => ({
      pendingUploads: s.pendingUploads.map((u) =>
        u.id === id ? { ...u, ...patch } : u,
      ),
    })),
  removePendingUpload: (id) =>
    set((s) => ({
      pendingUploads: s.pendingUploads.filter((u) => u.id !== id),
    })),

  loadDatasets: async () => {
    set({ loading: true, error: null });
    try {
      const datasets = await listDatasets();
      set({ datasets, loading: false });
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : String(err),
        loading: false,
      });
    }
  },

  setFilter: (partial) =>
    set((state) => ({ filter: { ...state.filter, ...partial } })),
  resetFilter: () => set({ filter: { ...initialFilter } }),

  openWizard: () =>
    set({
      wizardOpen: true,
      wizardStep: "draw",
      wizardSelection: { ...initialWizard },
    }),
  closeWizard: () => set({ wizardOpen: false }),
  setWizardStep: (wizardStep) => set({ wizardStep }),
  setWizardSelection: (partial) =>
    set((state) => ({
      wizardSelection: { ...state.wizardSelection, ...partial },
    })),
  setWizardDrawnBBox: (drawnBBox) =>
    set((state) => ({
      wizardSelection: {
        ...state.wizardSelection,
        drawnBBox,
        groups: [],
        hoveredOrthoId: null,
      },
    })),
  setWizardGroups: (groups) =>
    set((state) => ({
      wizardSelection: { ...state.wizardSelection, groups },
    })),
  setWizardHoveredOrtho: (hoveredOrthoId) =>
    set((state) => ({
      wizardSelection: { ...state.wizardSelection, hoveredOrthoId },
    })),
  toggleWizardPast: (pastId) =>
    set((state) => ({
      wizardSelection: {
        ...state.wizardSelection,
        groups: togglePastInGroups(state.wizardSelection.groups, pastId),
      },
    })),
  toggleWizardCurrent: (currentId) =>
    set((state) => ({
      wizardSelection: {
        ...state.wizardSelection,
        groups: toggleCurrentInGroups(state.wizardSelection.groups, currentId),
      },
    })),
  resetWizard: () =>
    set({ wizardSelection: { ...initialWizard }, wizardStep: "draw" }),

  openUpload: () => set({ uploadOpen: true }),
  closeUpload: () => set({ uploadOpen: false }),
  appendDataset: (dataset) => {
    set((s) => ({
      datasets: [dataset, ...s.datasets.filter((d) => d.id !== dataset.id)],
      recentlyAddedDatasetIds: [
        dataset.id,
        ...s.recentlyAddedDatasetIds.filter((id) => id !== dataset.id),
      ],
    }));
    // 12초 후 highlight 자동 해제.
    window.setTimeout(() => {
      useDatasetsStore.getState().unmarkDatasetRecent(dataset.id);
    }, 12_000);
  },
  deleteDataset: async (id) => {
    await apiDeleteDataset(id);
    set((s) => ({
      datasets: s.datasets.filter((d) => d.id !== id),
      recentlyAddedDatasetIds: s.recentlyAddedDatasetIds.filter((x) => x !== id),
    }));
  },

  recentlyAddedDatasetIds: [],
  markDatasetRecent: (id) =>
    set((s) => ({
      recentlyAddedDatasetIds: [
        id,
        ...s.recentlyAddedDatasetIds.filter((x) => x !== id),
      ],
    })),
  unmarkDatasetRecent: (id) =>
    set((s) => ({
      recentlyAddedDatasetIds: s.recentlyAddedDatasetIds.filter((x) => x !== id),
    })),

  selectedDatasetId: null,
  selectedDatasetFlyTick: 0,
  selectDataset: (id) =>
    set((s) => ({
      // 같은 id 재클릭 = 토글 해제. 다른 id = 교체 + fly 재발동.
      selectedDatasetId: s.selectedDatasetId === id ? null : id,
      selectedDatasetFlyTick:
        s.selectedDatasetId === id ? s.selectedDatasetFlyTick : s.selectedDatasetFlyTick + 1,
    })),
}));

/** filter 적용된 데이터셋 목록 (memoized). */
export function applyDatasetFilter(
  datasets: Dataset[],
  filter: DatasetFilter,
): Dataset[] {
  const search = filter.search.trim().toLowerCase();
  return datasets.filter((d) => {
    if (search) {
      const haystack = [
        d.display_name,
        d.primary_region,
        ...d.regions,
        d.host_path,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      if (!haystack.includes(search)) return false;
    }
    if (filter.sources.length > 0 && !filter.sources.includes(d.source)) return false;
    if (filter.statuses.length > 0 && !filter.statuses.includes(d.status)) return false;
    if (filter.takenFrom) {
      if (new Date(d.taken_end_at) < new Date(filter.takenFrom)) return false;
    }
    if (filter.takenTo) {
      if (new Date(d.taken_start_at) > new Date(filter.takenTo)) return false;
    }
    return true;
  });
}

export function useFilteredDatasets(): Dataset[] {
  const datasets = useDatasetsStore((s) => s.datasets);
  const filter = useDatasetsStore((s) => s.filter);
  return useMemo(() => applyDatasetFilter(datasets, filter), [datasets, filter]);
}
