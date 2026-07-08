import { useEffect, useRef } from "react";
import { Plus } from "lucide-react";
import { Button, ResizableDivider } from "@/components/Common";
import {
  SheetMap,
  TaskRow,
  TasksFilter,
} from "@/components/Sheets";
import { ChartsRow, DatasetsSection, StatsCards } from "@/components/Dashboard";
import { NewTaskWizard, UploadModal } from "@/components/Datasets";
import { useDatasetsStore } from "@/stores/datasetsStore";
import { useSheetsStore } from "@/stores/sheetsStore";
import { useFilteredTasks, useTasksStore } from "@/stores/tasksStore";
import { useUIStore } from "@/stores/uiStore";

/**
 * 메인 통합 대시보드 — 3 패널 구조 + 매끄러운 드래그 디바이더.
 *
 *   좌 (도엽 row 리스트, 240~600px) | 중 (지도+통계+차트, flex-1) | 우 (데이터셋 row 리스트, 280~800px)
 *
 * 디바이더는 ref 기반 직접 DOM mutation 으로 React 재렌더 회피 → 60fps 드래그.
 * 폭은 mouseup 시점에 uiStore + localStorage 1회 commit.
 */
const LEFT_MIN = 240;
const LEFT_MAX = 600;
const RIGHT_MIN = 280;
const RIGHT_MAX = 800;

export default function Landing() {
  const loadSheets = useSheetsStore((s) => s.loadSheets);
  const loadRegions = useSheetsStore((s) => s.loadRegions);
  const sheets = useSheetsStore((s) => s.sheets);
  const regionsLoading = useSheetsStore((s) => s.regionsLoading);
  const tasks = useTasksStore((s) => s.tasks);
  const tasksLoading = useTasksStore((s) => s.loading);
  const tasksError = useTasksStore((s) => s.error);
  const loadTasks = useTasksStore((s) => s.loadTasks);
  const refreshTask = useTasksStore((s) => s.refreshTask);
  const filteredTasks = useFilteredTasks(sheets);
  const openWizard = useDatasetsStore((s) => s.openWizard);
  const loadDatasets = useDatasetsStore((s) => s.loadDatasets);

  const initialLeftW = useUIStore((s) => s.dashboardLeftW);
  const initialRightW = useUIStore((s) => s.dashboardRightW);
  const setLeftW = useUIStore((s) => s.setDashboardLeftW);
  const setRightW = useUIStore((s) => s.setDashboardRightW);

  const leftRef = useRef<HTMLElement>(null);
  const rightRef = useRef<HTMLElement>(null);

  useEffect(() => {
    void loadSheets();
    void loadRegions();
    void loadDatasets();
    void loadTasks();
  }, [loadSheets, loadRegions, loadDatasets, loadTasks]);

  const runningTaskIds = tasks
    .filter((task) => task.status === "pending" || task.status === "running")
    .map((task) => task.id)
    .join(",");

  useEffect(() => {
    if (!runningTaskIds) return undefined;
    let stopped = false;
    let timer: number | null = null;
    const ids = runningTaskIds.split(",").filter(Boolean);

    const tick = async () => {
      await Promise.all(ids.map((id) => refreshTask(id)));
      if (!stopped) timer = window.setTimeout(tick, 1500);
    };
    void tick();

    return () => {
      stopped = true;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [runningTaskIds, refreshTask]);

  return (
    <div className="h-full flex">
      {/* ============ 좌: 변화탐지 작업(=프로젝트) 리스트 ============ */}
      <aside
        ref={leftRef}
        style={{ width: initialLeftW }}
        className="shrink-0 h-full bg-white border-r border-slate-200 flex flex-col"
      >
        <div className="px-3 pt-3 pb-2 space-y-2 border-b border-slate-100">
          <Button
            variant="primary"
            size="lg"
            leftIcon={<Plus size={16} />}
            onClick={openWizard}
            fullWidth
          >
            신규 변화탐지 작업
          </Button>
          <TasksFilter />
        </div>
        <div className="px-3 py-2 border-b border-slate-100 flex items-center justify-between">
          <span className="text-xs font-bold text-slate-500">
            프로젝트 {filteredTasks.length} / {tasks.length}개
          </span>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar px-2 py-2 space-y-1.5">
          {tasksError ? (
            <div className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-md p-2.5">
              {tasksError}
            </div>
          ) : null}

          {tasksLoading && tasks.length === 0 ? (
            <div className="text-center text-xs text-slate-400 py-8">
              프로젝트 불러오는 중…
            </div>
          ) : null}

          {!tasksLoading && tasks.length === 0 ? (
            <div className="text-center text-xs text-slate-400 py-8">
              등록된 프로젝트가 없습니다.
              <br />
              상단 "신규 변화탐지 작업" 으로 시작하세요.
            </div>
          ) : null}

          {!tasksLoading && tasks.length > 0 && filteredTasks.length === 0 ? (
            <div className="text-center text-xs text-slate-400 py-8">
              조건에 맞는 프로젝트가 없습니다.
            </div>
          ) : null}

          {filteredTasks.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              totalDetections={task.detection_count}
            />
          ))}
        </div>
      </aside>

      <ResizableDivider
        targetRef={leftRef}
        edge="right"
        min={LEFT_MIN}
        max={LEFT_MAX}
        onCommit={setLeftW}
        ariaLabel="도엽 패널 크기 조정"
      />

      {/* ============ 중: 지도 + 통계 + 차트 ============ */}
      <section className="flex-1 min-w-0 h-full overflow-y-auto custom-scrollbar bg-slate-50">
        <div className="p-5 space-y-5">
          <div className="bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden">
            <header className="h-12 px-4 flex items-center justify-between border-b border-slate-100">
              <div>
                <h3 className="text-sm font-bold text-slate-800">
                  대한민국 전역 처리 현황
                </h3>
                <p className="text-[11px] text-slate-500">
                  권역 + 도엽 처리 상태 오버레이
                </p>
              </div>
            </header>
            <div
              className="relative"
              style={{ height: "60vh", minHeight: 420 }}
            >
              <SheetMap />
              {regionsLoading ? (
                <div className="absolute top-3 right-3 bg-white/95 border border-slate-200 rounded-md px-3 py-1.5 text-xs text-slate-500 shadow-sm">
                  권역 데이터 로딩 중…
                </div>
              ) : null}
            </div>
          </div>

          <StatsCards />
          <ChartsRow />
        </div>
      </section>

      <ResizableDivider
        targetRef={rightRef}
        edge="left"
        min={RIGHT_MIN}
        max={RIGHT_MAX}
        onCommit={setRightW}
        ariaLabel="데이터셋 패널 크기 조정"
      />

      {/* ============ 우: 데이터셋 자원 row 리스트 ============ */}
      <aside
        ref={rightRef}
        style={{ width: initialRightW }}
        className="shrink-0 h-full bg-slate-50 overflow-hidden flex flex-col"
      >
        <div className="flex-1 min-h-0 p-3">
          <DatasetsSection />
        </div>
      </aside>

      {/* 모달 */}
      <UploadModal />
      <NewTaskWizard />
    </div>
  );
}
