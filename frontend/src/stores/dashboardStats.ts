/**
 * 메인 대시보드 통계 derived selectors.
 *
 * 입력: tasks (tasksStore) + sheets (sheetsStore) + datasets (datasetsStore).
 * 모두 useMemo 로 메모화. 실제 데이터 양 (수십~수백 도엽) 에서 매 렌더 계산 부담 없음.
 */

import { useMemo } from "react";
import { useSheetsStore } from "@/stores/sheetsStore";
import { useDatasetsStore } from "@/stores/datasetsStore";
import { useTasksStore } from "@/stores/tasksStore";
import type { TaskStatus } from "@/types";
import { REGIONS } from "@/utils/constants";

// 국토교통부 2024년말 지적통계 기준 전국 국토면적.
const KOREA_NATIONAL_LAND_AREA_KM2 = 100_459.9;

export interface OverviewStats {
  /** 성공한 작업이 포함하는 고유 도엽들의 area_km2 합. */
  completedAreaKm2: number;
  /** 전체 작업이 포함하는 고유 도엽들의 area_km2 합. */
  totalAreaKm2: number;
  /** 전국 국토면적 기준 분모. */
  nationalAreaKm2: number;
  /** 작업 상태별 카운트. */
  byStatus: Record<TaskStatus, number>;
  /** 처리 대상 고유 도엽 수. */
  totalSheets: number;
  completedSheets: number;
  /** 변경 객체 합 (모든 작업의 detection_count). */
  totalDetections: number;
  /** 데이터셋 용량 합 (GB). */
  totalDatasetGB: number;
  /** 데이터셋 수. */
  totalDatasets: number;
  /** 완료 / 전체 작업 수. */
  totalTasks: number;
  completedTasks: number;
}

export function useOverviewStats(): OverviewStats {
  const tasks = useTasksStore((s) => s.tasks);
  const sheets = useSheetsStore((s) => s.sheets);
  const datasets = useDatasetsStore((s) => s.datasets);
  return useMemo(() => {
    const byStatus: Record<TaskStatus, number> = {
      pending: 0,
      running: 0,
      succeeded: 0,
      failed: 0,
      canceled: 0,
    };
    const sheetByCode = new Map(sheets.map((s) => [s.code, s]));
    const allSheetCodes = new Set<string>();
    const completedSheetCodes = new Set<string>();

    for (const task of tasks) {
      byStatus[task.status] += 1;
      for (const code of task.sheet_codes) {
        allSheetCodes.add(code);
        if (task.status === "succeeded") completedSheetCodes.add(code);
      }
    }

    const areaFor = (codes: Set<string>) =>
      Array.from(codes).reduce((sum, code) => {
        return sum + (sheetByCode.get(code)?.area_km2 ?? 0);
      }, 0);

    const totalDatasetBytes = datasets.reduce(
      (sum, d) => sum + (d.size_bytes ?? 0),
      0,
    );
    const totalDatasetGB = totalDatasetBytes / 1024 / 1024 / 1024;
    const totalDetections = tasks.reduce(
      (sum, task) => sum + task.detection_count,
      0,
    );

    return {
      completedAreaKm2: areaFor(completedSheetCodes),
      totalAreaKm2: areaFor(allSheetCodes),
      nationalAreaKm2: KOREA_NATIONAL_LAND_AREA_KM2,
      byStatus,
      totalSheets: allSheetCodes.size,
      completedSheets: completedSheetCodes.size,
      totalDetections,
      totalDatasetGB,
      totalDatasets: datasets.length,
      totalTasks: tasks.length,
      completedTasks: byStatus.succeeded,
    };
  }, [tasks, sheets, datasets]);
}

// ============================================================
// 차트 데이터
// ============================================================

export interface MonthlyPoint {
  /** "YYYY.MM" */
  label: string;
  count: number;
}

/** 월별 완료 작업 수 — task.finished_at 기준. */
export function useMonthlyCompletedTasks(year?: number): MonthlyPoint[] {
  const tasks = useTasksStore((s) => s.tasks);
  return useMemo(() => {
    const targetYear = year ?? new Date().getFullYear();
    const buckets = new Map<string, number>();
    // 1~12월 기본값 0
    for (let m = 1; m <= 12; m += 1) {
      const label = `${targetYear}.${String(m).padStart(2, "0")}`;
      buckets.set(label, 0);
    }
    for (const task of tasks) {
      if (task.status !== "succeeded" || !task.finished_at) continue;
      const d = new Date(task.finished_at);
      if (d.getFullYear() !== targetYear) continue;
      const label = `${targetYear}.${String(d.getMonth() + 1).padStart(2, "0")}`;
      buckets.set(label, (buckets.get(label) ?? 0) + 1);
    }
    return Array.from(buckets, ([label, count]) => ({ label, count }));
  }, [tasks, year]);
}

export interface MonthlyAreaPoint {
  /** "YYYY.MM" */
  label: string;
  areaKm2: number;
}

/** 월별 신규 처리 완료 면적 — 같은 도엽은 가장 먼저 완료된 월에만 합산. */
export function useMonthlyCompletedArea(year?: number): MonthlyAreaPoint[] {
  const tasks = useTasksStore((s) => s.tasks);
  const sheets = useSheetsStore((s) => s.sheets);
  return useMemo(() => {
    const targetYear = year ?? new Date().getFullYear();
    const buckets = new Map<string, number>();
    for (let m = 1; m <= 12; m += 1) {
      const label = `${targetYear}.${String(m).padStart(2, "0")}`;
      buckets.set(label, 0);
    }

    const sheetByCode = new Map(sheets.map((s) => [s.code, s]));
    const countedSheetCodes = new Set<string>();
    const completedTasks = tasks
      .filter((task) => task.status === "succeeded" && task.finished_at)
      .sort(
        (a, b) =>
          new Date(a.finished_at ?? 0).getTime() -
          new Date(b.finished_at ?? 0).getTime(),
      );

    for (const task of completedTasks) {
      const finishedAt = new Date(task.finished_at ?? 0);
      const monthLabel = `${finishedAt.getFullYear()}.${String(
        finishedAt.getMonth() + 1,
      ).padStart(2, "0")}`;
      for (const code of task.sheet_codes) {
        if (countedSheetCodes.has(code)) continue;
        countedSheetCodes.add(code);
        if (finishedAt.getFullYear() !== targetYear) continue;
        buckets.set(
          monthLabel,
          (buckets.get(monthLabel) ?? 0) +
            (sheetByCode.get(code)?.area_km2 ?? 0),
        );
      }
    }

    return Array.from(buckets, ([label, areaKm2]) => ({ label, areaKm2 }));
  }, [tasks, sheets, year]);
}

export interface RegionDistributionPoint {
  region: string;
  count: number;
  percent: number;
}

/** 권역별 처리 대상 도엽 분포. */
export function useRegionDistribution(): RegionDistributionPoint[] {
  const tasks = useTasksStore((s) => s.tasks);
  const sheets = useSheetsStore((s) => s.sheets);
  return useMemo(() => {
    const buckets = new Map<string, number>();
    for (const r of REGIONS) buckets.set(r, 0);
    const sheetByCode = new Map(sheets.map((s) => [s.code, s]));
    const codes = new Set(tasks.flatMap((task) => task.sheet_codes));
    for (const code of codes) {
      const sheet = sheetByCode.get(code);
      if (!sheet) continue;
      buckets.set(sheet.region, (buckets.get(sheet.region) ?? 0) + 1);
    }
    const total = codes.size;
    return Array.from(buckets, ([region, count]) => ({
      region,
      count,
      percent: total === 0 ? 0 : (count / total) * 100,
    })).filter((p) => p.count > 0);
  }, [tasks, sheets]);
}

export interface StatusDistributionPoint {
  status: TaskStatus;
  count: number;
  percent: number;
}

/** 작업 상태 분포. */
export function useStatusDistribution(): StatusDistributionPoint[] {
  const tasks = useTasksStore((s) => s.tasks);
  return useMemo(() => {
    const buckets: Record<TaskStatus, number> = {
      pending: 0,
      running: 0,
      succeeded: 0,
      failed: 0,
      canceled: 0,
    };
    for (const task of tasks) buckets[task.status] += 1;
    const total = tasks.length;
    return (Object.entries(buckets) as [TaskStatus, number][])
      .filter(([, c]) => c > 0)
      .map(([status, count]) => ({
        status,
        count,
        percent: total === 0 ? 0 : (count / total) * 100,
      }));
  }, [tasks]);
}

export const TASK_STATUS_LABEL: Readonly<Record<TaskStatus, string>> = {
  pending: "대기",
  running: "진행",
  succeeded: "완료",
  failed: "실패",
  canceled: "중단",
};
