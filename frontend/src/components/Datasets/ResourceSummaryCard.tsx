import { FolderOpen, HardDrive } from "lucide-react";
import type { Dataset } from "@/types";
import type { WizardSelection } from "@/stores/datasetsStore";
import { formatYearMonth } from "@/utils/formatters";
import { cn } from "@/utils/cn";

export interface ResourceSummaryCardProps {
  tone: "blue" | "emerald";
  label: string;
  pendingMeta: WizardSelection["standardPending"];
  existing: Dataset | null;
}

/**
 * 위저드 메타 단계의 자원 요약 카드 — 신규(서버 경로) 또는 기존 자원을 표시.
 */
export function ResourceSummaryCard({
  tone,
  label,
  pendingMeta,
  existing,
}: ResourceSummaryCardProps) {
  const toneClasses =
    tone === "blue"
      ? {
          dot: "bg-blue-500",
          ring: "border-blue-100",
          chip: "bg-blue-50 text-blue-700 border-blue-100",
        }
      : {
          dot: "bg-emerald-500",
          ring: "border-emerald-100",
          chip: "bg-emerald-50 text-emerald-700 border-emerald-100",
        };

  const empty = !pendingMeta && !existing;

  return (
    <div className={cn("rounded-md border bg-white", toneClasses.ring)}>
      <div className="flex items-center gap-2 px-2.5 py-1.5 border-b border-slate-100">
        <span className={cn("w-1.5 h-1.5 rounded-full", toneClasses.dot)} />
        <span className="text-[10px] font-bold text-slate-500">{label}</span>
        {pendingMeta ? (
          <span
            className={cn(
              "ml-auto text-[9px] font-bold px-1.5 py-0.5 rounded border",
              toneClasses.chip,
            )}
          >
            신규
          </span>
        ) : existing ? (
          <span className="ml-auto text-[9px] font-bold text-slate-500 px-1.5 py-0.5 rounded border border-slate-200 bg-slate-50">
            기존
          </span>
        ) : null}
      </div>

      {empty ? (
        <div className="px-2.5 py-3 text-[11px] text-red-500 text-center">
          선택되지 않음
        </div>
      ) : pendingMeta ? (
        <div className="px-2.5 py-2 space-y-1">
          <div className="flex items-start gap-1.5">
            <FolderOpen size={11} className="text-slate-400 shrink-0 mt-0.5" />
            <div className="min-w-0 flex-1">
              <div className="text-[11px] font-bold text-slate-800 truncate">
                {pendingMeta.display_name}
              </div>
              <div className="text-[10px] text-slate-400 font-mono truncate">
                {pendingMeta.server_path}
              </div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-1 text-[10px] pt-1 border-t border-slate-100">
            <MiniField label="플랫폼" value={pendingMeta.platform} />
            <MiniField label="촬영 연도" value={pendingMeta.taken_year} />
          </div>
        </div>
      ) : existing ? (
        <div className="px-2.5 py-2 space-y-1">
          <div className="flex items-start gap-1.5">
            <HardDrive size={11} className="text-slate-400 shrink-0 mt-0.5" />
            <div className="min-w-0 flex-1">
              <div className="text-[11px] font-bold text-slate-800 truncate">
                {existing.display_name}
              </div>
              <div className="text-[10px] text-slate-400">
                #{existing.id} · 도엽 {existing.sheet_codes.length}매
              </div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-1 text-[10px] pt-1 border-t border-slate-100">
            <MiniField label="플랫폼" value={existing.platform} />
            <MiniField
              label="촬영"
              value={formatYearMonth(existing.taken_start_at)}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}

function MiniField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[9px] text-slate-400">{label}</div>
      <div className="text-[11px] font-bold text-slate-700">{value}</div>
    </div>
  );
}
