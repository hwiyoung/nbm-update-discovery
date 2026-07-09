import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  CalendarDays,
  Download,
  Eye,
  FileText,
  FolderOpen,
  Layers,
  Loader2,
  Map as MapIcon,
  Mountain,
  Pencil,
  Save,
  Square,
  Trash2,
} from "lucide-react";
import toast from "react-hot-toast";
import { Badge, Button, Input, Modal, ModalDescription, Progress } from "@/components/Common";
import {
  canUseNativeSavePicker,
  createExportSaveTarget,
  type ExportKind,
  getDefaultTaskExportFilename,
  isExportSaveCanceled,
} from "@/services/exporters/saveTarget";
import type { Task } from "@/types";
import { formatDate, formatDateTime, formatNumber } from "@/utils/formatters";
import { useSheetsStore } from "@/stores/sheetsStore";
import { useTasksStore } from "@/stores/tasksStore";
import { cn } from "@/utils/cn";
import { taskProgressMessageText } from "@/utils/taskProgress";
import { EditTaskModal } from "./EditTaskModal";

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

const EXPORT_META: Record<ExportKind, {
  label: string;
  sub: string;
  ext: string;
  icon: React.ReactNode;
}> = {
  shp: {
    label: "폴리곤 SHP",
    sub: "EPSG:5186 + .prj 동봉",
    ext: ".zip",
    icon: <MapIcon size={14} />,
  },
  dxf: {
    label: "폴리곤 DXF (2D)",
    sub: "변화 유형별 layer",
    ext: ".dxf",
    icon: <MapIcon size={14} />,
  },
  dxf3d: {
    label: "폴리곤 3D DXF",
    sub: "vertex 별 DEM 높이 자동 적용",
    ext: ".dxf",
    icon: <Mountain size={14} />,
  },
  pdf: {
    label: "리포트 PDF",
    sub: "요약 + 그래프",
    ext: ".pdf",
    icon: <FileText size={14} />,
  },
};

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
  const flyToSheets = useSheetsStore((s) => s.flyToSheets);
  const setHighlightedCodes = useSheetsStore((s) => s.setHighlightedCodes);
  const deleteTask = useTasksStore((s) => s.deleteTask);
  const cancelTask = useTasksStore((s) => s.cancelTask);
  const progressMessage = taskProgressMessageText(task);

  const onOpenDetail = () => navigate(`/tasks/${task.id}`);
  const onFly = () => {
    if (task.sheet_codes.length === 0) return;
    flyToSheets(task.sheet_codes);
  };
  const onMouseEnter = () => setHighlightedCodes(task.sheet_codes);
  const onMouseLeave = () => setHighlightedCodes([]);

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
        "border-slate-100 hover:border-blue-200 hover:shadow-sm",
      )}
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
// 내보내기 모달 — 폴리곤 SHP / DXF, 리포트 PDF
// ============================================================
export function ExportMenu({ task }: { task: Task }) {
  const [open, setOpen] = useState(false);
  const disabled = task.sheet_codes.length === 0;

  return (
    <>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(true)}
        title={disabled ? "내보낼 객체가 없습니다" : "내보내기"}
        className="inline-flex items-center gap-1 h-6 px-2 rounded text-[11px] font-bold text-slate-500 hover:text-slate-700 hover:bg-slate-100 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
      >
        <Download size={11} />
        내보내기
      </button>
      <ExportDialog task={task} open={open} onClose={() => setOpen(false)} />
    </>
  );
}

function ExportDialog({
  task,
  open,
  onClose,
}: {
  task: Task;
  open: boolean;
  onClose: () => void;
}) {
  const [kind, setKind] = useState<ExportKind>("shp");
  const [filename, setFilename] = useState(getDefaultTaskExportFilename(task, "shp"));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nativeSave = canUseNativeSavePicker();

  useEffect(() => {
    if (!open) return;
    setKind("shp");
    setFilename(getDefaultTaskExportFilename(task, "shp"));
    setBusy(false);
    setError(null);
  }, [open, task.id, task.name]);

  const selectKind = (next: ExportKind) => {
    setKind(next);
    setFilename(getDefaultTaskExportFilename(task, next));
    setError(null);
  };

  const submit = async () => {
    if (busy) return;
    const normalized = normalizeExportFilename(filename, kind);
    if (!normalized) {
      setError("파일명을 입력하세요");
      return;
    }
    setBusy(true);
    setError(null);
    const tid = `export-${task.id}-${kind}`;
    toast.loading(`${EXPORT_META[kind].label} 생성 중…`, { id: tid });
    try {
      const saveTarget = await createExportSaveTarget(normalized, kind);
      const mod = await import("@/services/exporters");
      if (kind === "shp") {
        await mod.exportTaskAsShp(task.id, saveTarget);
      } else if (kind === "dxf") {
        await mod.exportTaskAsDxf(task.id, saveTarget);
      } else if (kind === "pdf") {
        await mod.exportTaskAsPdf(task.id, undefined, saveTarget);
      } else {
        const stats = await mod.exportTaskAs3dDxf(task.id, "CHANGE_DETECTION", saveTarget);
        const nodataNote =
          stats.objects_with_nodata.length > 0
            ? ` — ${stats.objects_with_nodata.length}개 객체에 NoData vertex 포함`
            : "";
        const missingNote =
          stats.missing_sheets.length > 0
            ? ` (DEM 누락 도엽 ${stats.missing_sheets.length}건)`
            : "";
        toast.success(
          `3D DXF 저장 요청 완료 — ${stats.total_objects}객체 / ${stats.sheets_used.length}도엽${missingNote}${nodataNote}`,
          { id: tid, duration: 6000 },
        );
        onClose();
        return;
      }
      toast.success(`${EXPORT_META[kind].label} 저장 요청 완료`, { id: tid });
      onClose();
    } catch (err) {
      if (isExportSaveCanceled(err)) toast.dismiss(tid);
      else toast.error(err instanceof Error ? err.message : "내보내기 실패", { id: tid });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !busy) onClose();
      }}
      title="내보내기"
      icon={<Download size={20} />}
      width={620}
      blockDismiss={busy}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            취소
          </Button>
          <Button
            variant="primary"
            onClick={() => void submit()}
            disabled={busy}
            leftIcon={busy ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
          >
            저장
          </Button>
        </>
      }
    >
      <ModalDescription>프로젝트 결과 내보내기 저장 옵션</ModalDescription>

      <div className="space-y-5">
        <div>
          <div className="text-xs font-bold text-slate-500 mb-2">형식</div>
          <div className="grid grid-cols-2 gap-2">
            {(Object.keys(EXPORT_META) as ExportKind[]).map((item) => {
              const meta = EXPORT_META[item];
              const selected = item === kind;
              return (
                <button
                  key={item}
                  type="button"
                  onClick={() => selectKind(item)}
                  disabled={busy}
                  className={cn(
                    "min-h-[64px] rounded-md border px-3 py-2 text-left transition-colors",
                    "flex items-start gap-2 disabled:opacity-60 disabled:cursor-not-allowed",
                    selected
                      ? "border-blue-500 bg-blue-50 text-blue-700"
                      : "border-slate-200 hover:border-blue-200 hover:bg-slate-50 text-slate-700",
                  )}
                >
                  <span className={cn("mt-0.5 shrink-0", selected ? "text-blue-600" : "text-slate-400")}>
                    {meta.icon}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-xs font-bold">{meta.label}</span>
                    <span className="block text-[11px] text-slate-500">{meta.sub}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="grid grid-cols-[140px_minmax(0,1fr)] items-center gap-3">
          <label className="text-xs font-bold text-slate-500" htmlFor={`export-filename-${task.id}`}>
            파일명
          </label>
          <Input
            id={`export-filename-${task.id}`}
            value={filename}
            onChange={(e) => {
              setFilename(e.target.value);
              setError(null);
            }}
            disabled={busy}
            invalid={Boolean(error)}
            className="font-mono"
          />

          <div className="text-xs font-bold text-slate-500">저장 위치</div>
          <div className="flex items-center gap-2 min-w-0">
            <div className="h-9 flex-1 min-w-0 rounded-md border border-slate-200 bg-slate-50 px-3 text-sm text-slate-600 flex items-center">
              <span className="truncate">
                {nativeSave ? "저장 시 선택" : "브라우저 다운로드 폴더"}
              </span>
            </div>
            <FolderOpen size={16} className="text-slate-400 shrink-0" />
          </div>
        </div>

        {error ? (
          <div className="rounded-md border border-red-100 bg-red-50 px-3 py-2 text-xs text-red-700">
            {error}
          </div>
        ) : null}
      </div>
    </Modal>
  );
}

function normalizeExportFilename(value: string, kind: ExportKind): string | null {
  const clean = value.trim().replace(/[\\/:*?"<>|]/g, "_");
  if (!clean) return null;
  const ext = EXPORT_META[kind].ext;
  if (clean.toLowerCase().endsWith(ext)) return clean;
  return `${clean.replace(/\.[^.]*$/, "")}${ext}`;
}
