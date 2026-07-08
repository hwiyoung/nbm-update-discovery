import { CheckCircle2, Loader2, Upload, X, XCircle } from "lucide-react";
import { Progress } from "@/components/Common";
import {
  useDatasetsStore,
  type PendingUpload,
  type PendingUploadPhase,
} from "@/stores/datasetsStore";
import { cn } from "@/utils/cn";

/**
 * 데이터셋 패널 상단의 업로드 진행 row — 사용자가 dataset 목록 안에서 즉시
 * 진행 상황을 인지할 수 있도록 카드 형태로 prominent.
 */
export function PendingUploadRow({ upload }: { upload: PendingUpload }) {
  const removePendingUpload = useDatasetsStore((s) => s.removePendingUpload);
  const isError = upload.phase === "error";
  const isDone = upload.phase === "done";
  const tone = isError ? "red" : isDone ? "emerald" : "blue";
  const sideLabel = sideText(upload.side);

  return (
    <div
      className={cn(
        "rounded-md border-2 p-3 space-y-2 transition-colors shadow-sm",
        isError && "bg-red-50 border-red-300",
        isDone && "bg-emerald-50 border-emerald-300",
        !isError && !isDone && "bg-blue-50 border-blue-300",
      )}
    >
      <div className="flex items-start gap-2">
        <span className="shrink-0 mt-0.5">
          {isDone ? (
            <CheckCircle2 size={18} className="text-emerald-600" />
          ) : isError ? (
            <XCircle size={18} className="text-red-600" />
          ) : upload.phase === "uploading" ? (
            <Upload size={18} className="text-blue-600" />
          ) : (
            <Loader2 size={18} className="animate-spin text-blue-600" />
          )}
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 min-w-0">
            <span
              className={cn(
                "text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded shrink-0",
                upload.side === "standard"
                  ? "bg-blue-600 text-white"
                  : upload.side === "compare"
                    ? "bg-emerald-600 text-white"
                    : "bg-slate-600 text-white",
              )}
            >
              {sideLabel}
            </span>
            <span className="text-sm font-bold text-slate-800 truncate">
              {upload.display_name}
            </span>
          </div>
          <div
            className={cn(
              "text-[11px] mt-1 font-bold",
              isError
                ? "text-red-700"
                : isDone
                  ? "text-emerald-700"
                  : "text-blue-700",
            )}
          >
            {phaseLabel(upload.phase)}
            {upload.message ? ` · ${upload.message}` : ""}
            {upload.error ? ` · ${upload.error}` : ""}
          </div>
        </div>
        {(isDone || isError) ? (
          <button
            type="button"
            aria-label="알림 닫기"
            onClick={() => removePendingUpload(upload.id)}
            className="p-0.5 text-slate-400 hover:text-slate-700 hover:bg-black/5 rounded shrink-0"
          >
            <X size={12} />
          </button>
        ) : null}
      </div>
      {!isDone && !isError ? (
        <Progress value={upload.percent} size="sm" tone={tone} />
      ) : null}
    </div>
  );
}

function sideText(side: PendingUpload["side"]): string {
  switch (side) {
    case "standard":
      return "과년도";
    case "compare":
      return "당해년도";
    default:
      return "신규";
  }
}

function phaseLabel(phase: PendingUploadPhase): string {
  switch (phase) {
    case "uploading":
      return "등록 중";
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
