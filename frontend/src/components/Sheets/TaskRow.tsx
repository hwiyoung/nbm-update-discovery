import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  CalendarDays,
  ChevronDown,
  Download,
  Eye,
  FileText,
  Layers,
  Loader2,
  Map as MapIcon,
  Mountain,
  Pencil,
  Play,
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

/**
 * 변화탐지 작업(=프로젝트) row.
 *
 * - row 본체 / 작업명 클릭 → 지도를 해당 프로젝트의 union bbox 로 fly (네비게이션 X)
 * - row hover → 해당 sheet_codes 강조
 * - ✏️ 수정 버튼 → EditTaskModal
 * - ▶ 처리 / 👁 상세보기 버튼만 /tasks/:id 로 네비게이션
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

      {/* 행 4: 처리 시작/중단 + 상세보기 + 내보내기 */}
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
        ) : (
          <button
            type="button"
            onClick={onOpenDetail}
            className="inline-flex items-center gap-1 h-6 px-2 rounded text-[11px] font-bold text-blue-600 hover:bg-blue-50 transition-colors"
          >
            <Play size={11} />
            처리 시작
          </button>
        )}
        <button
          type="button"
          onClick={onOpenDetail}
          className="inline-flex items-center gap-1 h-6 px-2 rounded text-[11px] font-bold text-slate-500 hover:text-slate-700 hover:bg-slate-100 transition-colors"
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
// 내보내기 드롭다운 — 폴리곤 SHP / DXF, 리포트 PDF
// ============================================================
export function ExportMenu({ task }: { task: Task }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const disabled = task.sheet_codes.length === 0;

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const exportAs = async (kind: "shp" | "dxf" | "pdf") => {
    setBusy(true);
    setOpen(false);
    const tid = `export-${task.id}-${kind}`;
    toast.loading(`${kind.toUpperCase()} 생성 중…`, { id: tid });
    try {
      const mod = await import("@/services/exporters");
      if (kind === "shp") await mod.exportTaskAsShp(task.id);
      else if (kind === "dxf") await mod.exportTaskAsDxf(task.id);
      else await mod.exportTaskAsPdf(task.id);
      toast.success(`${kind.toUpperCase()} 다운로드 시작`, { id: tid });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "내보내기 실패", { id: tid });
    } finally {
      setBusy(false);
    }
  };

  const exportAs3dDxf = async () => {
    setBusy(true);
    setOpen(false);
    const tid = `export-${task.id}-dxf3d`;
    toast.loading("3D DXF 생성 중 — vertex 별 DEM 높이 적용", { id: tid });
    try {
      const mod = await import("@/services/exporters");
      const stats = await mod.exportTaskAs3dDxf(task.id);
      const nodataNote =
        stats.objects_with_nodata.length > 0
          ? ` — ${stats.objects_with_nodata.length}개 객체에 NoData vertex 포함`
          : "";
      const missingNote =
        stats.missing_sheets.length > 0
          ? ` (DEM 누락 도엽 ${stats.missing_sheets.length}건)`
          : "";
      toast.success(
        `3D DXF 다운로드 — ${stats.total_objects}객체 / ${stats.sheets_used.length}도엽${missingNote}${nodataNote}`,
        { id: tid, duration: 6000 },
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "3D DXF 실패", { id: tid });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        disabled={disabled || busy}
        onClick={() => setOpen((o) => !o)}
        title={disabled ? "내보낼 객체가 없습니다" : "내보내기"}
        className="inline-flex items-center gap-1 h-6 px-2 rounded text-[11px] font-bold text-slate-500 hover:text-slate-700 hover:bg-slate-100 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
      >
        <Download size={11} />
        내보내기
        <ChevronDown size={11} />
      </button>
      {open ? (
        <div className="absolute right-0 mt-1 w-56 bg-white border border-slate-200 rounded-md shadow-lg z-30 py-1">
          <ExportItem
            icon={<MapIcon size={12} />}
            label="폴리곤 SHP (.zip)"
            sub="EPSG:5186 + .prj 동봉"
            onClick={() => void exportAs("shp")}
          />
          <ExportItem
            icon={<MapIcon size={12} />}
            label="폴리곤 DXF (2D)"
            sub="변화 유형별 layer"
            onClick={() => void exportAs("dxf")}
          />
          <ExportItem
            icon={<Mountain size={12} />}
            label="폴리곤 3D DXF"
            sub="vertex 별 DEM 높이 자동 적용"
            onClick={() => void exportAs3dDxf()}
          />
          <div className="my-1 border-t border-slate-100" />
          <ExportItem
            icon={<FileText size={12} />}
            label="리포트 PDF"
            sub="요약 + 그래프"
            onClick={() => void exportAs("pdf")}
          />
        </div>
      ) : null}
    </div>
  );
}

function ExportItem({
  icon,
  label,
  sub,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  sub: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full text-left px-3 py-1.5 hover:bg-slate-50 transition-colors flex items-start gap-2"
    >
      <span className="mt-0.5 text-slate-400 shrink-0">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-xs font-bold text-slate-700">{label}</span>
        <span className="block text-[10px] text-slate-400">{sub}</span>
      </span>
    </button>
  );
}
