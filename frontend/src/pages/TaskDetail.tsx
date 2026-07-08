import { useCallback, useEffect, useRef } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useSheetDetailStore } from "@/stores/sheetDetailStore";
import { useTasksStore } from "@/stores/tasksStore";
import { useTaskPolling } from "@/hooks/useTaskPolling";
import { Button, ResizableDivider } from "@/components/Common";
import { ArrowLeft } from "lucide-react";
import { SheetSidebar } from "@/components/SheetDetail/SheetSidebar";
import { DetectionMap } from "@/components/SheetDetail/DetectionMap";
import { RightPanel } from "@/components/SheetDetail/RightPanel";
import { useUIStore } from "@/stores/uiStore";
import type { Task } from "@/types";

/**
 * 변화탐지 작업(=프로젝트) 상세 — 도엽 단위 분할 없이 영상 기준으로 모든 폴리곤 집계 표시.
 *
 * - sheet 슬롯에는 task 의 union bbox + sheet_codes 메타가 담긴 synthetic MapSheet 가 들어감.
 * - DetectionMap 은 합쳐진 detections 를 한 화면에 렌더.
 * - SheetSidebar / RightPanel 은 기존 도엽 처리 화면과 동일 컴포넌트 재사용.
 */
const LEFT_MIN = 280;
const LEFT_MAX = 640;

export default function TaskDetail() {
  const { taskId } = useParams();
  const navigate = useNavigate();
  const loadByTask = useSheetDetailStore((s) => s.loadByTask);
  const reset = useSheetDetailStore((s) => s.reset);
  const sheet = useSheetDetailStore((s) => s.sheet);
  const loading = useSheetDetailStore((s) => s.loading);
  const error = useSheetDetailStore((s) => s.error);
  const initialLeftW = useUIStore((s) => s.sheetDetailLeftW);
  const setLeftW = useUIStore((s) => s.setSheetDetailLeftW);
  const appendTask = useTasksStore((s) => s.appendTask);
  const leftRef = useRef<HTMLDivElement>(null);

  const onTaskUpdate = useCallback((updated: Task) => {
    useSheetDetailStore.setState({ task: updated });
    appendTask(updated);
  }, [appendTask]);

  const onTaskComplete = useCallback(() => {
    if (taskId) void loadByTask(taskId);
  }, [taskId, loadByTask]);

  useTaskPolling(taskId ?? null, onTaskComplete, onTaskUpdate);

  useEffect(() => {
    if (taskId) void loadByTask(taskId);
    return () => reset();
  }, [taskId, loadByTask, reset]);

  if (error) {
    return (
      <div className="h-full flex items-center justify-center p-8">
        <div className="bg-white rounded-xl p-6 shadow-sm border border-red-100 max-w-md">
          <h2 className="text-base font-bold text-red-600 mb-2">로드 실패</h2>
          <p className="text-sm text-slate-700 mb-4">{error}</p>
          <Button
            variant="secondary"
            leftIcon={<ArrowLeft size={16} />}
            onClick={() => navigate("/")}
          >
            대시보드로
          </Button>
        </div>
      </div>
    );
  }

  if (loading || !sheet) {
    return (
      <div className="h-full flex items-center justify-center text-sm text-slate-400">
        프로젝트 데이터를 불러오는 중…
      </div>
    );
  }

  return (
    <div className="h-full flex">
      <div ref={leftRef} style={{ width: initialLeftW }} className="shrink-0 h-full">
        <SheetSidebar />
      </div>
      <ResizableDivider
        targetRef={leftRef}
        edge="right"
        min={LEFT_MIN}
        max={LEFT_MAX}
        onCommit={setLeftW}
        ariaLabel="처리 사이드바 크기 조정"
      />
      <section className="flex-1 min-w-0 h-full bg-slate-100 relative overflow-hidden">
        <DetectionMap />
        <RightPanel />
      </section>
    </div>
  );
}
