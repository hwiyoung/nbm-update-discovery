import { useMemo } from "react";
import { create } from "zustand";
import type { MapSheet, Task } from "@/types";
import {
  cancelTask as apiCancelTask,
  deleteTask as apiDeleteTask,
  getTaskStatus,
  listTasks,
  startTask as apiStartTask,
  updateTask,
  type TaskUpdatePayload,
} from "@/api/client";

/**
 * 변화탐지 작업(=프로젝트) 리스트 스토어.
 *
 * 대시보드 좌측 리스트가 본 store 를 구독.
 * 1 task = 1 row. 매칭 도엽 코드는 task.sheet_codes 로 description 표시.
 */
export interface TasksFilter {
  search: string;
  region: string | null;
}

const initialFilter: TasksFilter = {
  search: "",
  region: null,
};

interface TasksState {
  tasks: Task[];
  filter: TasksFilter;
  loading: boolean;
  error: string | null;
  loadTasks: () => Promise<void>;
  /** 단일 task refetch — detection mutation 후 detection_count 등 실시간 반영용. */
  refreshTask: (taskId: string) => Promise<void>;
  patchTask: (taskId: string, payload: TaskUpdatePayload) => Promise<Task>;
  /** 위저드 등록 직후 새 task 를 리스트 맨 위에 추가 (refetch 없이 즉시 반영). */
  appendTask: (task: Task) => void;
  /** 처리 시작 — Celery 작업 enqueue + status='pending'. */
  startTask: (taskId: string) => Promise<Task>;
  /** 처리 중단 — Celery 작업 revoke + status='canceled'. */
  cancelTask: (taskId: string) => Promise<Task>;
  /** 프로젝트 하드 삭제 — backend 삭제 후 store 에서 제거. */
  deleteTask: (taskId: string) => Promise<void>;
  setFilter: (partial: Partial<TasksFilter>) => void;
  resetFilter: () => void;
}

export const useTasksStore = create<TasksState>((set) => ({
  tasks: [],
  filter: { ...initialFilter },
  loading: false,
  error: null,
  loadTasks: async () => {
    set({ loading: true, error: null });
    try {
      const tasks = await listTasks();
      set({ tasks, loading: false });
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : String(err),
        loading: false,
      });
    }
  },
  refreshTask: async (taskId) => {
    try {
      const updated = await getTaskStatus(taskId);
      set((s) => ({
        tasks: s.tasks.map((t) => (t.id === taskId ? updated : t)),
      }));
    } catch {
      // 단순 갱신 실패는 사용자 흐름을 막지 않음 — 다음 mount 시 loadTasks 가 회수.
    }
  },
  patchTask: async (taskId, payload) => {
    const updated = await updateTask(taskId, payload);
    set((s) => ({
      tasks: s.tasks.map((t) => (t.id === taskId ? updated : t)),
    }));
    return updated;
  },
  appendTask: (task) =>
    set((s) => {
      const existing = s.tasks.findIndex((t) => t.id === task.id);
      if (existing >= 0) {
        const next = s.tasks.slice();
        next[existing] = task;
        return { tasks: next };
      }
      return { tasks: [task, ...s.tasks] };
    }),
  startTask: async (taskId) => {
    const updated = await apiStartTask(taskId);
    set((s) => ({
      tasks: s.tasks.map((t) => (t.id === taskId ? updated : t)),
    }));
    return updated;
  },
  cancelTask: async (taskId) => {
    const updated = await apiCancelTask(taskId);
    set((s) => ({
      tasks: s.tasks.map((t) => (t.id === taskId ? updated : t)),
    }));
    return updated;
  },
  deleteTask: async (taskId) => {
    await apiDeleteTask(taskId);
    set((s) => ({ tasks: s.tasks.filter((t) => t.id !== taskId) }));
  },
  setFilter: (partial) =>
    set((s) => ({ filter: { ...s.filter, ...partial } })),
  resetFilter: () => set({ filter: { ...initialFilter } }),
}));

/**
 * 필터 적용 — task 의 sheet_codes 중 region 매칭이 있으면 통과.
 * sheets 배열은 sheetsStore 에서 받아옴 (region lookup 용).
 */
export function useFilteredTasks(sheets: MapSheet[]): Task[] {
  const tasks = useTasksStore((s) => s.tasks);
  const filter = useTasksStore((s) => s.filter);

  return useMemo(() => {
    const sheetByCode = new Map(sheets.map((s) => [s.code, s]));
    const search = filter.search.trim().toLowerCase();
    return tasks.filter((t) => {
      if (search) {
        const haystack = `${t.name} ${t.description ?? ""} ${t.sheet_codes.join(" ")}`.toLowerCase();
        if (!haystack.includes(search)) return false;
      }
      if (filter.region) {
        const hit = t.sheet_codes.some(
          (c) => sheetByCode.get(c)?.region === filter.region,
        );
        if (!hit) return false;
      }
      return true;
    });
  }, [tasks, filter, sheets]);
}
