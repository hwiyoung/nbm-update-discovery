import { useCallback, useEffect, useRef, useState } from "react";
import { Bell, CheckCircle2, Loader2, XCircle } from "lucide-react";
import toast from "react-hot-toast";
import { Progress } from "@/components/Common";
import { useDatasetsStore, type PendingUpload } from "@/stores/datasetsStore";
import { useSheetsStore } from "@/stores/sheetsStore";
import { useTasksStore } from "@/stores/tasksStore";
import { useTaskPolling } from "@/hooks/useTaskPolling";
import type { Task } from "@/types";
import { cn } from "@/utils/cn";
import {
  taskProgressMessageText,
  taskProgressPercent,
} from "@/utils/taskProgress";

/**
 * 헤더 우측의 알림 종 — 백그라운드 업로드·작업 진행 표시.
 *
 * 클릭 시 드롭다운으로 항목 펼침. 활성 항목 수가 0 보다 크면 빨간 배지.
 *   - pendingUploads (업로드/좌표 분석)
 *   - pendingTaskId 가 있으면 폴링한 task (추론 진행)
 */
export function NotificationsBell() {
  const pendingUploads = useDatasetsStore((s) => s.pendingUploads);
  const pendingTaskId = useDatasetsStore((s) => s.pendingTaskId);
  const setPendingTaskId = useDatasetsStore((s) => s.setPendingTaskId);
  const loadSheets = useSheetsStore((s) => s.loadSheets);
  const appendTask = useTasksStore((s) => s.appendTask);

  const onTaskComplete = useCallback((completed: Task) => {
    appendTask(completed);
    toast.success("변화탐지 추론 완료 — 도엽 목록 갱신됨");
    void loadSheets();
  }, [appendTask, loadSheets]);

  const onTaskUpdate = useCallback((updated: Task) => {
    appendTask(updated);
  }, [appendTask]);

  const { task } = useTaskPolling(pendingTaskId, onTaskComplete, onTaskUpdate);

  const [taskOpen, setTaskOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  // 외부 클릭 시 닫기
  useEffect(() => {
    if (!taskOpen && !notificationsOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) {
        setTaskOpen(false);
        setNotificationsOpen(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [taskOpen, notificationsOpen]);

  const activeUploads = pendingUploads.filter(
    (u) => u.phase !== "done" && u.phase !== "error",
  );
  const taskActive =
    task != null && (task.status === "pending" || task.status === "running");
  const taskProgress = task ? taskProgressPercent(task) : 0;
  const uploadActiveCount = activeUploads.length;
  const uploadCount = pendingUploads.length;

  const notificationsEmpty = uploadCount === 0;

  // 새 작업이 시작되면 한 번 펄스 안내 — 사용자 시선 끌기.
  const prevTaskActive = useRef(false);
  const prevUploadActiveCount = useRef(0);
  useEffect(() => {
    if (taskActive && !prevTaskActive.current) {
      setTaskOpen(true);
      setNotificationsOpen(false);
      const t = window.setTimeout(() => setTaskOpen(false), 4000);
      prevTaskActive.current = Boolean(taskActive);
      return () => window.clearTimeout(t);
    }
    if (!taskActive) setTaskOpen(false);
    prevTaskActive.current = Boolean(taskActive);
    return undefined;
  }, [taskActive]);

  useEffect(() => {
    if (
      task?.status !== "succeeded" &&
      task?.status !== "failed" &&
      task?.status !== "canceled"
    ) {
      return undefined;
    }
    const t = window.setTimeout(() => setPendingTaskId(null), 5000);
    return () => window.clearTimeout(t);
  }, [task?.status, setPendingTaskId]);

  useEffect(() => {
    if (uploadActiveCount > prevUploadActiveCount.current && uploadActiveCount > 0) {
      setNotificationsOpen(true);
      setTaskOpen(false);
      const t = window.setTimeout(() => setNotificationsOpen(false), 4000);
      prevUploadActiveCount.current = uploadActiveCount;
      return () => window.clearTimeout(t);
    }
    prevUploadActiveCount.current = uploadActiveCount;
    return undefined;
  }, [uploadActiveCount]);

  return (
    <div ref={wrapRef} className="relative flex items-center gap-2">
      {/* 활성 추론 인라인 요약 — 알림 종과 역할을 분리. */}
      {taskActive && task ? (
        <button
          type="button"
          onClick={() => {
            setTaskOpen((o) => !o);
            setNotificationsOpen(false);
          }}
          className="inline-flex items-center gap-1.5 h-7 px-2 rounded-full bg-blue-50 hover:bg-blue-100 border border-blue-200 text-blue-700 text-[11px] font-bold transition-colors"
        >
          <Loader2 size={11} className="animate-spin" />
          추론 중 {taskProgress}%
        </button>
      ) : null}
      <button
        type="button"
        aria-label="알림"
        onClick={() => {
          if (notificationsEmpty) return;
          setNotificationsOpen((o) => !o);
          setTaskOpen(false);
        }}
        className={cn(
          "relative p-1.5 rounded-md transition-colors",
          notificationsEmpty
            ? "text-slate-300 cursor-not-allowed"
            : "text-slate-600 hover:text-blue-600 hover:bg-slate-100",
          uploadActiveCount > 0 && "text-blue-600",
        )}
        title={notificationsEmpty ? "업로드 알림 없음" : `업로드 진행 중 ${uploadActiveCount}개`}
      >
        <Bell
          size={18}
          className={cn(uploadActiveCount > 0 && "animate-pulse")}
        />
        {uploadActiveCount > 0 ? (
          <>
            <span className="absolute -top-0.5 -right-0.5 min-w-4 h-4 px-1 rounded-full bg-red-600 text-white text-[10px] font-bold flex items-center justify-center tabular-nums">
              {uploadActiveCount}
            </span>
            {/* 펄스 링 */}
            <span className="absolute -top-0.5 -right-0.5 min-w-4 h-4 rounded-full bg-red-600 opacity-60 animate-ping" />
          </>
        ) : null}
      </button>

      {taskOpen && task ? (
        <div className="absolute right-0 top-full mt-1 w-96 max-h-[60vh] overflow-y-auto custom-scrollbar bg-white rounded-md shadow-xl border border-slate-200 z-[3100]">
          <div className="px-3 py-2 border-b border-slate-100 flex items-center justify-between">
            <span className="text-xs font-bold text-slate-700">추론 진행</span>
            <span className="text-[11px] text-slate-400 tabular-nums">
              {taskProgress}%
            </span>
          </div>
          <div className="p-2">
            <TaskItem task={task} onDismiss={() => setPendingTaskId(null)} detailed />
          </div>
        </div>
      ) : null}

      {notificationsOpen ? (
        <div className="absolute right-0 top-full mt-1 w-80 max-h-[60vh] overflow-y-auto custom-scrollbar bg-white rounded-md shadow-xl border border-slate-200 z-[3100]">
          <div className="px-3 py-2 border-b border-slate-100 flex items-center justify-between">
            <span className="text-xs font-bold text-slate-700">알림</span>
            <span className="text-[11px] text-slate-400">
              업로드 진행 중 {uploadActiveCount}개
            </span>
          </div>
          <div className="p-2 space-y-1.5">
            {pendingUploads.map((u) => (
              <UploadItem key={u.id} upload={u} />
            ))}
            {notificationsEmpty ? (
              <div className="text-center text-xs text-slate-400 py-6">
                업로드 알림이 없습니다.
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function UploadItem({ upload }: { upload: PendingUpload }) {
  const isDone = upload.phase === "done";
  const isError = upload.phase === "error";
  const tone = isError ? "red" : isDone ? "emerald" : "blue";
  return (
    <div
      className={cn(
        "rounded-md border p-2 space-y-1",
        isError && "bg-red-50 border-red-100",
        isDone && "bg-emerald-50 border-emerald-100",
        !isError && !isDone && "bg-blue-50 border-blue-100",
      )}
    >
      <div className="flex items-start gap-2">
        <span className="shrink-0 mt-0.5">
          {isDone ? (
            <CheckCircle2 size={13} className="text-emerald-600" />
          ) : isError ? (
            <XCircle size={13} className="text-red-600" />
          ) : (
            <Loader2 size={13} className="animate-spin text-blue-600" />
          )}
        </span>
        <div className="flex-1 min-w-0">
          <div className="text-xs font-bold text-slate-800 truncate">
            {upload.display_name}
          </div>
          <div className="text-[11px] text-slate-500 truncate">
            {labelFor(upload.phase)}
            {upload.message ? ` · ${upload.message}` : ""}
            {upload.error ? ` · ${upload.error}` : ""}
          </div>
        </div>
      </div>
      {!isDone && !isError ? (
        <Progress value={upload.percent} size="sm" tone={tone} />
      ) : null}
    </div>
  );
}

function TaskItem({
  task,
  onDismiss,
  detailed = false,
}: {
  task: Task;
  onDismiss: () => void;
  detailed?: boolean;
}) {
  const isRunning = task.status === "pending" || task.status === "running";
  const isDone = task.status === "succeeded";
  const isFailed = task.status === "failed" || task.status === "canceled";
  const progressMessage = taskProgressMessageText(task);
  const progressPercent = taskProgressPercent(task);
  return (
    <div
      className={cn(
        "rounded-md border p-2 space-y-1",
        isFailed && "bg-red-50 border-red-100",
        isDone && "bg-emerald-50 border-emerald-100",
        isRunning && "bg-blue-50 border-blue-100",
      )}
    >
      <div className="flex items-start gap-2">
        <span className="shrink-0 mt-0.5">
          {isDone ? (
            <CheckCircle2 size={13} className="text-emerald-600" />
          ) : isFailed ? (
            <XCircle size={13} className="text-red-600" />
          ) : (
            <Loader2 size={13} className="animate-spin text-blue-600" />
          )}
        </span>
        <div className="flex-1 min-w-0">
          <div className="text-xs font-bold text-slate-800 truncate">
            {task.name}
          </div>
          <div className="text-[11px] text-slate-500 truncate">
            변화탐지 · {progressMessage}
          </div>
        </div>
        {!isRunning ? (
          <button
            type="button"
            onClick={onDismiss}
            className="text-[10px] text-slate-500 hover:text-slate-700 px-1.5 py-0.5 rounded hover:bg-black/5 shrink-0"
          >
            닫기
          </button>
        ) : null}
      </div>
      {isRunning ? <Progress value={progressPercent} size="sm" tone="blue" /> : null}
      {detailed ? (
        <div className="grid grid-cols-2 gap-1.5 pt-1 text-[11px]">
          <InfoCell label="상태" value={progressMessage} />
          <InfoCell label="진행률" value={`${progressPercent}%`} />
          <InfoCell label="모델" value={modelText(task)} />
        </div>
      ) : null}
    </div>
  );
}

function InfoCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded bg-white/70 border border-white px-2 py-1 min-w-0">
      <div className="text-[10px] font-bold text-slate-400">{label}</div>
      <div className="truncate font-bold text-slate-700">{value}</div>
    </div>
  );
}

function modelText(task: Task): string {
  return task.models
    .map((m) => (m === "building" ? "건물" : m === "road" ? "도로" : m))
    .join(" · ") || "변화탐지";
}

function labelFor(phase: PendingUpload["phase"]): string {
  switch (phase) {
    case "uploading":
      return "업로드 중";
    case "analyzing":
      return "좌표 분석 중";
    case "registering":
      return "작업 등록 중";
    case "done":
      return "완료";
    case "error":
      return "실패";
  }
}