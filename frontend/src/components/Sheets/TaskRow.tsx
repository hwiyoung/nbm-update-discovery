import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  CalendarDays,
  Download,
  Eye,
  Layers,
  Loader2,
  Pencil,
  Square,
  Trash2,
} from "lucide-react";
import toast from "react-hot-toast";
import { Badge, Progress } from "@/components/Common";
import type { Task } from "@/types";
import { formatDate, formatDateTime, formatNumber } from "@/utils/formatters";
import { useSheetsStore } from "@/stores/sheetsStore";
import { useTasksStore } from "@/stores/tasksStore";
import { cn } from "@/utils/cn";
import { taskProgressMessageText } from "@/utils/taskProgress";
import { EditTaskModal } from "./EditTaskModal";
import { TaskExportDialog } from "./TaskExportDialog";

/**
 * 변화탐지 작업(=프로젝트) row.
 *
 * - row 본체 / 작업명 클릭 → 지도를 해당 프로젝트의 union bbox 로 fly (네비게이션 X)
 * - row hover → 해당 sheet_codes 강조
 * - ✏️ 수정 버튼 → EditTaskModal
 * - 처리 중단 / 상세보기 / 내보내기 버튼만 /tasks/:id 또는 해당 작업으로 연결
 */
export interface TaskRowProps {
  task: Task;
  totalDetections: number;
}

const STATUS_LABEL: Record<Task["status"], { label: string; tone: "blue" | "emerald" | "red" | "slate" | "amber" }> = {
  pending: { label: "대기", tone: "slate" },
  running: { label: "추론 중", tone: "blue" },
  succeeded: { label: "완료", tone: "emerald" },
  failed: { label: "실패", tone: "red" },
  canceled: { label: "취소", tone: "amber" },
};

export function TaskRow({ task, totalDetections }: TaskRowProps) {
  const navigate = useNavigate();
  const status = STATUS_LABEL[task.status];
  const [editOpen, setEditOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [canceling, setCanceling] = useState(false);
  const setHighlightedTask = useSheetsStore((s) => s.setHighlightedTask);
  const selectedTaskId = useSheetsStore((s) => s.selectedTaskId);
  const setSelectedTask = useSheetsStore((s) => s.setSelectedTask);
  const deleteTask = useTasksStore((s) => s.deleteTask);
  const cancelTask = useTasksStore((s) => s.cancelTask);
  const progressMessage = taskProgressMessageText(task);

  const onOpenDetail = () => navigate(`/tasks/${task.id}`);
  const onFly = () => {
    setSelectedTask(task.id);
  };
  const onMouseEnter = () => setHighlightedTask(task.id);
  const onMouseLeave = () => setHighlightedTask(null);

  const onDelete = async () => {
    if (deleting) return;
    const ok = window.confirm(
      `프로젝트 "${task.name}" 을(를) 삭제하시겠습니까?\n관련 변화탐지 객체와 도엽 메타가 모두 함께 제거됩니다.`,
    );
    if (!ok) return;
    setDeleting(true);
    const tid = `task-delete-${task.id}`;
    toast.loading("프로젝트 삭제 중…", { id: tid });
    try {
      await deleteTask(task.id);
      if (selectedTaskId === task.id) setSelectedTask(null);
      toast.success("프로젝트가 삭제되었습니다", { id: tid });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "삭제 실패", { id: tid });
      setDeleting(false);
    }
  };

  const isRunning = task.status === "pending" || task.status === "running";

  const onCancel = async () => {
    if (canceling) return;
    const ok = window.confirm(
      `프로젝트 "${task.name}" 의 처리를 중단하시겠습니까?\n진행 중인 추론이 즉시 종료됩니다.`,
    );
    if (!ok) return;
    setCanceling(true);
    const tid = `task-cancel-${task.id}`;
    toast.loading("처리 중단 중…", { id: tid });
    try {
      await cancelTask(task.id);
      toast.success("처리가 중단되었습니다", { id: tid });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "중단 실패", { id: tid });
    } finally {
      setCanceling(false);
    }
  };

  return (
    <div
      onClick={onFly}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      className={cn(
        "group bg-white border rounded-md px-3 py-2 transition-shadow cursor-pointer",
        selectedTaskId === task.id
          ? "border-blue-300 bg-blue-50/40 shadow-sm"
          : "border-slate-100 hover:border-blue-200 hover:shadow-sm",
      )}
      aria-current={selectedTaskId === task.id ? "true" : undefined}
    >
      {/* 행 1: 작업명 + 수정 / 삭제 버튼 + 상태 */}
      <div className="flex items-center gap-1.5">
        <span className="flex-1 text-xs font-bold text-slate-800 truncate">
          {task.name}
        </span>
        <button
          type="button"
          aria-label="프로젝트 수정"
          title="프로젝트 수정"
          onClick={(e) => {
            e.stopPropagation();
            setEditOpen(true);
          }}
          className="p-1 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors shrink-0"
        >
          <Pencil size={11} />
        </button>
        <button
          type="button"
          aria-label="프로젝트 삭제"
          title="프로젝트 삭제"
          disabled={deleting}
          onClick={(e) => {
            e.stopPropagation();
            void onDelete();
          }}
          className="p-1 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Trash2 size={11} />
        </button>
        <Badge tone={status.tone}>
          {isRunning ? (
            <span className="inline-flex items-center gap-1">
              <Loader2 size={10} className="animate-spin" />
              {status.label} {task.progress}%
            </span>
          ) : (
            status.label
          )}
        </Badge>
      </div>

      {/* 행 2: 객체 수 + 모델 + 등록일 */}
      <div className="flex items-center gap-1.5 flex-wrap mt-1.5 text-[11px] text-slate-500">
        <Layers size={11} className="text-slate-400" />
        <span className="tabular-nums">
          {formatNumber(totalDetections)}건
        </span>
        {task.models.length > 0 ? (
          <>
            <span className="text-slate-300">|</span>
            <span>
              {task.models
                .map((m) => (m === "building" ? "건물" : m === "road" ? "도로" : m))
                .join(" · ")}
            </span>
          </>
        ) : null}
        <span className="text-slate-300">|</span>
        <CalendarDays size={11} className="text-slate-400" />
        <span className="tabular-nums">{formatDate(task.created_at)}</span>
      </div>

      <div className="mt-1 grid grid-cols-2 gap-1.5 text-[10px] text-slate-500">
        <div className="min-w-0 rounded bg-slate-50 px-2 py-1">
          <span className="font-bold text-slate-400">처리 시작</span>{" "}
          <span className="tabular-nums">{formatDateTime(task.started_at ?? task.progress_updated_at)}</span>
        </div>
        <div className="min-w-0 rounded bg-slate-50 px-2 py-1">
          <span className="font-bold text-slate-400">처리 종료</span>{" "}
          <span className="tabular-nums">{formatDateTime(task.finished_at)}</span>
        </div>
      </div>

      {task.description ? (
        <div className="mt-1 text-[11px] text-slate-400 line-clamp-1">
          {task.description}
        </div>
      ) : null}

      {/* 행 3 (조건부): 추론 진행률 — pending/running 시 명시 progress bar */}
      {isRunning ? (
        <div className="mt-2 space-y-1">
          <div className="flex items-center justify-between text-[10px] text-blue-700 font-bold">
            <span className="inline-flex items-center gap-1 min-w-0">
              <Loader2 size={10} className="animate-spin" />
              <span className="truncate">{progressMessage}</span>
            </span>
            <span className="tabular-nums">{task.progress}%</span>
          </div>
          <Progress value={task.progress} size="sm" tone="blue" />
        </div>
      ) : null}

      {/* 행 4: 처리 중단 + 상세보기 + 내보내기 */}
      <div
        className="flex items-center gap-1 mt-2 -mx-1"
        onClick={(e) => e.stopPropagation()}
      >
        {isRunning ? (
          <button
            type="button"
            onClick={() => void onCancel()}
            disabled={canceling}
            className="inline-flex items-center gap-1 h-6 px-2 rounded text-[11px] font-bold text-red-600 hover:bg-red-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Square size={11} />
            처리 중단
          </button>
        ) : null}
        <button
          type="button"
          onClick={onOpenDetail}
          className={cn(
            "inline-flex items-center gap-1 h-6 px-2 rounded text-[11px] font-bold transition-colors",
            isRunning
              ? "text-slate-500 hover:text-slate-700 hover:bg-slate-100"
              : "text-blue-600 hover:bg-blue-50",
          )}
        >
          <Eye size={11} />
          상세보기
        </button>
        <ExportMenu task={task} />
      </div>

      <EditTaskModal
        task={editOpen ? task : null}
        open={editOpen}
        onClose={() => setEditOpen(false)}
      />
    </div>
  );
}

// ============================================================
// 내보내기 — 클릭하면 지도 기반 관심지역 선택 팝업을 연다.
// ============================================================
export function ExportMenu({
  task,
  buttonLabel = "내보내기",
  buttonClassName,
}: {
  task: Task;
  buttonLabel?: string;
  buttonClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const disabled = task.sheet_codes.length === 0 || task.detection_count === 0;

  return (
    <>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(true)}
        title={disabled ? "내보낼 객체가 없습니다" : "내보내기"}
        className={cn(
          "inline-flex items-center gap-1 h-6 px-2 rounded text-[11px] font-bold text-slate-500 hover:text-slate-700 hover:bg-slate-100 transition-colors disabled:opacity-40 disabled:cursor-not-allowed",
          buttonClassName,
        )}
      >
        <Download size={11} />
        {buttonLabel}
      </button>
      <TaskExportDialog
        task={task}
        open={open}
        onClose={() => setOpen(false)}
      />
    </>
  );
}
