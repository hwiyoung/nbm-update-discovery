import { useCallback, useEffect } from "react";
import { CheckCircle2, Loader2, X, XCircle } from "lucide-react";
import toast from "react-hot-toast";
import { useDatasetsStore } from "@/stores/datasetsStore";
import { useSheetsStore } from "@/stores/sheetsStore";
import { useTasksStore } from "@/stores/tasksStore";
import { useTaskPolling } from "@/hooks/useTaskPolling";
import { Progress } from "@/components/Common";
import { cn } from "@/utils/cn";
import { taskProgressMessageText } from "@/utils/taskProgress";
import type { Task } from "@/types";

/**
 * /sheets 상단 진행 배너 — 위저드 등록 직후 폴링.
 *
 * pendingTaskId 가 있으면 표시. status 가 succeeded/failed/canceled 가 되면
 * toast + sheets 다시 로드 + 5초 후 자동 닫힘.
 */
export function TaskProgressBanner() {
  const pendingTaskId = useDatasetsStore((s) => s.pendingTaskId);
  const setPendingTaskId = useDatasetsStore((s) => s.setPendingTaskId);
  const loadSheets = useSheetsStore((s) => s.loadSheets);
  const appendTask = useTasksStore((s) => s.appendTask);

  const onComplete = useCallback(() => {
    toast.success("변화탐지 추론 완료 — 도엽 목록 갱신됨");
    void loadSheets();
  }, [loadSheets]);

  const onUpdate = useCallback((updated: Task) => {
    appendTask(updated);
  }, [appendTask]);

  const { task, error } = useTaskPolling(pendingTaskId, onComplete, onUpdate);

  // 완료/실패 후 5초 자동 닫힘
  useEffect(() => {
    if (!task) return;
    if (
      task.status === "succeeded" ||
      task.status === "failed" ||
      task.status === "canceled"
    ) {
      const t = window.setTimeout(() => setPendingTaskId(null), 5000);
      return () => window.clearTimeout(t);
    }
    return undefined;
  }, [task?.status, setPendingTaskId]);

  if (!pendingTaskId || !task) return null;

  const isRunning = task.status === "pending" || task.status === "running";
  const isDone = task.status === "succeeded";
  const isFailed = task.status === "failed" || task.status === "canceled";
  const progressMessage = taskProgressMessageText(task);

  return (
    <div
      className={cn(
        "mx-5 mt-3 rounded-md border px-3 py-2 flex items-center gap-3",
        isDone && "bg-emerald-50 border-emerald-100 text-emerald-700",
        isFailed && "bg-red-50 border-red-100 text-red-700",
        isRunning && "bg-blue-50 border-blue-100 text-blue-700",
      )}
    >
      <span className="shrink-0">
        {isDone ? (
          <CheckCircle2 size={18} />
        ) : isFailed ? (
          <XCircle size={18} />
        ) : (
          <Loader2 size={18} className="animate-spin" />
        )}
      </span>
      <div className="flex-1 min-w-0">
        <div className="text-xs font-bold truncate">
          {task.name}{" "}
          <span className="text-[11px] font-normal opacity-70">— {task.progress}%</span>
        </div>
        {isRunning ? (
          <div className="text-[11px] font-medium opacity-80 truncate">
            {progressMessage}
          </div>
        ) : null}
        {isRunning ? (
          <div className="mt-1">
            <Progress value={task.progress} size="sm" tone="blue" />
          </div>
        ) : null}
        {error && isRunning ? (
          <div className="text-[11px] text-red-600 mt-0.5">폴링 오류: {error}</div>
        ) : null}
      </div>
      <button
        type="button"
        aria-label="닫기"
        onClick={() => setPendingTaskId(null)}
        className="p-1 hover:bg-black/5 rounded"
      >
        <X size={14} />
      </button>
    </div>
  );
}
