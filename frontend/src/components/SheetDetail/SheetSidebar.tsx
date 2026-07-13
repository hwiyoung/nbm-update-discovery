import {
  ArrowLeft,
  Check,
  CheckCircle2,
  ChevronDown,
  Copy,
  FileText,
  Fingerprint,
  Loader2,
  PauseCircle,
  Play,
  PlayCircle,
  Square,
} from "lucide-react";
import { Link } from "react-router-dom";
import { useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import {
  useCanCompleteSheet,
  useSheetDetailStore,
} from "@/stores/sheetDetailStore";
import { useDatasetsStore } from "@/stores/datasetsStore";
import { useTasksStore } from "@/stores/tasksStore";
import { AccordionGroup, Badge, Button, Modal, ModalDescription, Progress } from "@/components/Common";
import { ExportMenu } from "@/components/Sheets";
import { REVIEW_STATUS_BY_CODE } from "@/utils/constants";
import { formatSheetCode } from "@/utils/formatters";
import { taskProgressMessageText } from "@/utils/taskProgress";
import { auth } from "@/utils/auth";
import type { Task } from "@/types";
import { AnalysisDataAccordion } from "./accordions/AnalysisDataAccordion";
import { ConfidenceAccordion } from "./accordions/ConfidenceAccordion";
import { ChangeTypeAccordion } from "./accordions/ChangeTypeAccordion";
import { ReviewHistoryAccordion } from "./accordions/ReviewHistoryAccordion";

const TASK_STATUS_BADGE: Record<
  Task["status"],
  { label: string; tone: "slate" | "blue" | "emerald" | "red" | "amber" }
> = {
  pending: { label: "대기", tone: "slate" },
  running: { label: "추론 중", tone: "blue" },
  succeeded: { label: "추론 완료", tone: "emerald" },
  failed: { label: "추론 실패", tone: "red" },
  canceled: { label: "중단됨", tone: "amber" },
};

async function copyText(value: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }

  // LAN HTTP 환경에서는 Clipboard API가 비활성화될 수 있어 legacy fallback 유지.
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  if (!copied) throw new Error("clipboard unavailable");
}

function ProjectIdPopover({ projectId }: { projectId: string }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const onCopy = async () => {
    try {
      await copyText(projectId);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      toast.error("프로젝트 ID를 복사하지 못했습니다");
    }
  };

  return (
    <div ref={rootRef} className="relative mt-1">
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((current) => !current)}
        className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
      >
        <Fingerprint size={12} />
        프로젝트 ID
        <ChevronDown
          size={11}
          className={open ? "rotate-180 transition-transform" : "transition-transform"}
        />
      </button>

      {open ? (
        <div
          role="dialog"
          aria-label="프로젝트 ID"
          className="absolute left-0 top-full z-[600] mt-1 w-[360px] max-w-[calc(100vw-32px)] rounded-lg border border-slate-200 bg-white p-3 shadow-lg"
        >
          <div className="mb-1.5 text-[11px] font-semibold text-slate-500">
            프로젝트 ID
          </div>
          <div className="flex items-center gap-2 rounded-md bg-slate-50 px-2.5 py-2">
            <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap font-mono text-[11px] leading-4 text-slate-700">
              {projectId}
            </code>
            <button
              type="button"
              onClick={() => void onCopy()}
              className="inline-flex shrink-0 items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-600 transition-colors hover:border-blue-300 hover:text-blue-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
              aria-label="프로젝트 ID 복사"
            >
              {copied ? <Check size={12} /> : <Copy size={12} />}
              {copied ? "복사됨" : "복사"}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/**
 * 좌 사이드바 — 380px 고정.
 *
 * 구성:
 *   1. 도엽 헤더 (도엽코드, 도엽명, 권역, 처리 상태 배지, 처리 액션 버튼들)
 *   2. Undo/Redo 바
 *   3. 6 아코디언 (분석데이터·확신도·건물·도로·오류분류·처리 히스토리)
 */
export function SheetSidebar() {
  const sheet = useSheetDetailStore((s) => s.sheet)!;
  const task = useSheetDetailStore((s) => s.task);
  const canComplete = useCanCompleteSheet();
  const setStatus = useSheetDetailStore((s) => s.setSheetReviewStatus);
  const openRightPanel = useSheetDetailStore((s) => s.openRightPanel);
  const startTask = useTasksStore((s) => s.startTask);
  const cancelTask = useTasksStore((s) => s.cancelTask);
  const setPendingTaskId = useDatasetsStore((s) => s.setPendingTaskId);
  const [completeOpen, setCompleteOpen] = useState(false);
  const [restartOpen, setRestartOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  // task 모드 — 항상 엔진 제어 버튼(시작/중단/다시 시작) 표시. 검수 워크플로우
  // (처리 완료/보류) 는 도엽 단위 개념이라 task 모드에서는 적용 안 함 (synthetic
  // sheet.code === task.id 라서 PATCH /sheets/{code}/review-status 가 404).
  const isTaskMode = task !== null;
  const taskBadge = isTaskMode ? TASK_STATUS_BADGE[task.status] : null;
  const sheetStatus = REVIEW_STATUS_BY_CODE[sheet.review_status];
  const status = taskBadge ?? sheetStatus;

  const onComplete = async () => {
    await setStatus("completed");
    setCompleteOpen(false);
  };

  /** 재시작은 기존 detection 을 모두 지우므로 succeeded/canceled/failed 상태일 때만 모달로 확인. */
  const needsRestartConfirm =
    task !== null && task.status !== "pending" && task.detection_count > 0;

  const onStartClick = () => {
    if (!task || busy) return;
    if (needsRestartConfirm) {
      setRestartOpen(true);
    } else {
      void doStartTask();
    }
  };

  const doStartTask = async () => {
    if (!task || busy) return;
    setRestartOpen(false);
    setBusy(true);
    const tid = `task-start-${task.id}`;
    toast.loading("처리 시작 중…", { id: tid });
    try {
      const updated = await startTask(task.id);
      // sheetDetailStore 의 task 도 갱신해 즉시 버튼 토글.
      useSheetDetailStore.setState({ task: updated });
      setPendingTaskId(task.id);
      toast.success("처리 시작됨 — 추론 큐 전송", { id: tid });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "시작 실패", { id: tid });
    } finally {
      setBusy(false);
    }
  };

  const onCancelTask = async () => {
    if (!task || busy) return;
    const ok = window.confirm(
      `프로젝트 "${task.name}" 의 처리를 중단하시겠습니까?\n진행 중인 추론이 즉시 종료됩니다.`,
    );
    if (!ok) return;
    setBusy(true);
    const tid = `task-cancel-${task.id}`;
    toast.loading("처리 중단 중…", { id: tid });
    try {
      const updated = await cancelTask(task.id);
      useSheetDetailStore.setState({ task: updated });
      setPendingTaskId(null);
      toast.success("처리가 중단되었습니다", { id: tid });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "중단 실패", { id: tid });
    } finally {
      setBusy(false);
    }
  };

  return (
    <aside className="w-full h-full bg-white border-r border-slate-200 flex flex-col">
      {/* ---- 헤더 ---- */}
      <div className="px-4 pt-3 pb-4 border-b border-slate-100">
        <Link
          to="/sheets"
          className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-blue-600 transition-colors mb-2"
        >
          <ArrowLeft size={12} />
          도엽 목록
        </Link>

        <div className="flex items-start justify-between gap-2 mb-1">
          <div className="min-w-0">
            {!isTaskMode ? (
              <div className="text-xs font-bold text-slate-400 mb-0.5">
                {formatSheetCode(sheet.code)}
              </div>
            ) : null}
            <h1 className="text-base font-bold text-slate-800 truncate">
              {sheet.name}
            </h1>
            {isTaskMode ? <ProjectIdPopover projectId={task.id} /> : null}
            <div className="text-xs text-slate-500 mt-0.5">
              {sheet.region} · {sheet.area_km2.toFixed(2)} km²
            </div>
          </div>
          {!isTaskMode ? <Badge tone={status.tone}>{status.label}</Badge> : null}
        </div>

        {/* 처리 액션 — task 모드: 엔진 시작/중단. sheet 모드: 검수 완료/보류. */}
        {isTaskMode ? (
          <div className="mt-3">
            <TaskProgressPanel task={task} />
            {task.status === "running" || task.status === "pending" ? (
              <Button
                variant="secondary"
                size="sm"
                leftIcon={<Square size={14} />}
                disabled={busy}
                onClick={() => void onCancelTask()}
                fullWidth
              >
                {busy ? (
                  <span className="inline-flex items-center gap-1">
                    <Loader2 size={12} className="animate-spin" /> 처리 중단 중…
                  </span>
                ) : (
                  "처리 중단"
                )}
              </Button>
            ) : (
              <Button
                variant="primary"
                size="sm"
                leftIcon={<Play size={14} />}
                disabled={busy}
                onClick={onStartClick}
                fullWidth
              >
                {busy ? (
                  <span className="inline-flex items-center gap-1">
                    <Loader2 size={12} className="animate-spin" /> 시작 중…
                  </span>
                ) : task.status === "succeeded"
                    || task.status === "canceled"
                    || task.status === "failed" ? (
                  "다시 처리 시작"
                ) : (
                  "처리 시작"
                )}
              </Button>
            )}
            <p className="mt-2 text-[11px] text-slate-400">
              {task.status === "running"
                ? "추론이 진행 중입니다. 중단하면 결과가 적용되지 않습니다."
                : task.status === "pending"
                  ? "추론이 큐에 등록되었습니다. 엔진 worker 가 순서대로 처리합니다."
                : task.status === "succeeded"
                  ? "이전 추론이 완료됐습니다. 다시 시작하면 새 추론이 기존 결과를 대체합니다."
                  : task.status === "canceled"
                    ? "이전 처리가 중단되었습니다. 다시 시작하면 새 추론이 큐로 전송됩니다."
                    : task.status === "failed"
                      ? "이전 처리가 실패했습니다. 다시 시도할 수 있습니다."
                      : "추론을 시작하면 변화탐지 엔진이 도엽별로 객체를 생성합니다."}
            </p>
            {/* 처리 시작 박스 안 — 내보내기 (SHP/DXF/PDF/3D DXF). */}
            <div className="mt-3 pt-3 border-t border-slate-100 flex items-center justify-end gap-1.5">
              <Button
                variant="secondary"
                size="sm"
                leftIcon={<FileText size={14} />}
                onClick={() => openRightPanel("report")}
              >
                리포트 보기
              </Button>
              <ExportMenu task={task} />
            </div>
          </div>
        ) : auth.canCompleteSheetReview() ? (
          <>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <Button
                variant="primary"
                size="sm"
                leftIcon={<CheckCircle2 size={14} />}
                disabled={!canComplete || sheet.review_status === "completed"}
                onClick={() => setCompleteOpen(true)}
                fullWidth
              >
                처리 완료
              </Button>
              {sheet.review_status === "on_hold" ? (
                <Button
                  variant="secondary"
                  size="sm"
                  leftIcon={<PlayCircle size={14} />}
                  onClick={() => void setStatus("in_progress")}
                  fullWidth
                >
                  처리 재개
                </Button>
              ) : (
                <Button
                  variant="secondary"
                  size="sm"
                  leftIcon={<PauseCircle size={14} />}
                  disabled={sheet.review_status === "completed"}
                  onClick={() => void setStatus("on_hold")}
                  fullWidth
                >
                  처리 보류
                </Button>
              )}
            </div>
            {!canComplete && sheet.review_status !== "completed" ? (
              <p className="mt-2 text-[11px] text-slate-400">
                모든 객체에 오류분류를 부여하면 처리 완료가 활성화됩니다.
              </p>
            ) : null}
            <div className="mt-3 pt-3 border-t border-slate-100">
              <Button
                variant="secondary"
                size="sm"
                leftIcon={<FileText size={14} />}
                onClick={() => openRightPanel("report")}
                fullWidth
              >
                리포트 보기
              </Button>
            </div>
          </>
        ) : (
          <div className="mt-3 pt-3 border-t border-slate-100">
            <Button
              variant="secondary"
              size="sm"
              leftIcon={<FileText size={14} />}
              onClick={() => openRightPanel("report")}
              fullWidth
            >
              리포트 보기
            </Button>
          </div>
        )}
      </div>

      {/* ---- 아코디언 ---- */}
      <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar px-2 py-1">
        <AccordionGroup defaultOpen={["analysis", "confidence", "building", "road"]}>
          <AnalysisDataAccordion />
          <ConfidenceAccordion />
          <ChangeTypeAccordion category="building" />
          <ChangeTypeAccordion category="road" />
          <ReviewHistoryAccordion />
        </AccordionGroup>
      </div>

      {/* ---- 재시작 confirm 모달 ---- */}
      {task ? (
        <Modal
          open={restartOpen}
          onOpenChange={setRestartOpen}
          title="처리 다시 시작"
          icon={<PlayCircle size={20} className="text-amber-600" />}
          footer={
            <>
              <Button variant="ghost" onClick={() => setRestartOpen(false)} disabled={busy}>
                취소
              </Button>
              <Button variant="danger" onClick={() => void doStartTask()} disabled={busy}>
                기존 결과 삭제하고 다시 시작
              </Button>
            </>
          }
        >
          <ModalDescription>처리 다시 시작 확인 모달</ModalDescription>
          <p className="text-sm text-slate-700 mb-2">
            <span className="font-bold">{task.name}</span> 프로젝트를 다시 시작합니다.
          </p>
          <div className="text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-md p-2.5 mb-2">
            <span className="font-bold">
              기존 변화탐지 결과 {task.detection_count.toLocaleString("ko-KR")}건이 삭제됩니다.
            </span>
            <br />
            검수자가 직접 추가한 객체(FN)는 보존되며, 그 외 엔진 출력·import
            결과는 모두 제거된 뒤 새 추론이 큐로 전송됩니다.
          </div>
          <p className="text-[11px] text-slate-500">
            검수 의견·오류분류 등 본 detection 에 부여된 부가 정보도 함께 사라집니다. 복구 불가.
          </p>
        </Modal>
      ) : null}

      {/* ---- 완료 confirm 모달 ---- */}
      <Modal
        open={completeOpen}
        onOpenChange={setCompleteOpen}
        title="도엽 처리 완료 처리"
        icon={<CheckCircle2 size={20} />}
        footer={
          <>
            <Button variant="ghost" onClick={() => setCompleteOpen(false)}>
              취소
            </Button>
            <Button variant="primary" onClick={onComplete}>
              완료 처리
            </Button>
          </>
        }
      >
        <ModalDescription>도엽 처리 완료 처리 확인 모달</ModalDescription>
        <p className="text-sm text-slate-700 mb-2">
          <span className="font-bold">{sheet.name}</span> 도엽의 처리를 완료 처리합니다.
        </p>
        <p className="text-xs text-slate-500">
          완료 후에도 객체 정보·오류분류는 수정 가능하지만, 도엽 단위 메트릭이 산출되어 외부에 공개됩니다.
        </p>
      </Modal>
    </aside>
  );
}

function TaskProgressPanel({ task }: { task: Task }) {
  const status = TASK_STATUS_BADGE[task.status];
  const isRunning = task.status === "pending" || task.status === "running";
  const modelText = task.models
    .map((m) => (m === "building" ? "건물" : m === "road" ? "도로" : m))
    .join(" · ");
  const message =
    task.status === "pending" || task.status === "running"
      ? taskProgressMessageText(task)
      : status.label;
  const panelClass =
    task.status === "succeeded"
      ? "bg-emerald-50 border-emerald-100"
      : task.status === "failed"
        ? "bg-red-50 border-red-100"
        : task.status === "canceled"
          ? "bg-amber-50 border-amber-100"
          : "bg-blue-50 border-blue-100";

  return (
    <div className={`mb-3 rounded-md border p-2.5 ${panelClass}`}>
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[11px] font-bold text-slate-500 truncate">
            {modelText || "변화탐지"}
          </div>
          <div className="mt-0.5 flex items-center gap-1.5 text-xs font-bold text-slate-800 min-w-0">
            {isRunning ? (
              <Loader2 size={12} className="animate-spin text-blue-600 shrink-0" />
            ) : null}
            <span className="truncate">{message}</span>
          </div>
        </div>
        <Badge tone={status.tone}>{status.label}</Badge>
      </div>
      {isRunning ? (
        <div className="mt-2 space-y-1">
          <div className="flex items-center justify-between text-[11px] text-blue-700 font-bold">
            <span>진행률</span>
            <span className="tabular-nums">{task.progress}%</span>
          </div>
          <Progress value={task.progress} size="sm" tone="blue" />
        </div>
      ) : null}
    </div>
  );
}
