import { AlertTriangle, Layers2 } from "lucide-react";
import type { OrthoGroup, OrthoSummary } from "@/types/mapProject";
import { overlapPercent, overlapTone } from "@/utils/mapProject";
import { cn } from "@/utils/cn";
import { OrthoReviewTable } from "./OrthoReviewTable";

export interface StepReviewProps {
  groups: OrthoGroup[];
  summary: OrthoSummary;
  hoveredId: string | null;
  onHover: (id: string | null) => void;
  onToggleCurrent: (pastId: string, currentId: string) => void;
}

export function StepReview({
  groups,
  summary,
  hoveredId,
  onHover,
  onToggleCurrent,
}: StepReviewProps) {
  const hasIncluded = summary.currentCount > 0;

  return (
    <div className="p-5 space-y-4">
      <section className="space-y-2">
        <div className="text-[11px] font-black uppercase tracking-wide text-blue-600">
          Step 2
        </div>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-xl font-black text-slate-900">조회된 정사영상</h3>
            <p className="mt-1 text-sm leading-6 text-slate-600">
              포함할 당해년도 영상을 선택하고 과년도 범위 대비 중첩률을 확인합니다.
            </p>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1">
            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-black text-slate-700">
              {summary.matchedCount}장
            </span>
            <OverlapBadge overlap={summary.overlap} />
          </div>
        </div>
      </section>

      <div className="grid grid-cols-3 gap-2">
        <MiniMetric label="과년도" value={`${summary.pastCount}장`} />
        <MiniMetric label="당해년도" value={`${summary.currentCount}장`} />
        <MiniMetric label="도엽" value={`${summary.sheetCount}매`} />
      </div>

      {!hasIncluded ? (
        <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-bold text-red-700">
          <AlertTriangle size={15} />
          포함된 당해년도 영상이 없어 다음 단계로 이동할 수 없습니다.
        </div>
      ) : null}

      <div className="rounded-xl border border-slate-200 bg-white">
        <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-3 py-2.5">
          <div className="flex items-center gap-2">
            <Layers2 size={15} className="text-blue-600" />
            <span className="text-xs font-black text-slate-700">
              과년도 · 당해년도 매핑
            </span>
          </div>
          <span className="text-[11px] font-bold text-slate-400">
            포함 {summary.currentCount.toLocaleString("ko-KR")}장
          </span>
        </div>
        <div className="max-h-[450px] overflow-y-auto custom-scrollbar p-3">
          <OrthoReviewTable
            groups={groups}
            hoveredId={hoveredId}
            onHover={onHover}
            onToggleCurrent={onToggleCurrent}
          />
        </div>
      </div>
    </div>
  );
}

function MiniMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
      <div className="text-[10px] font-black text-slate-400">{label}</div>
      <div className="mt-0.5 text-sm font-black text-slate-800 truncate">{value}</div>
    </div>
  );
}

function OverlapBadge({ overlap }: { overlap: number }) {
  const tone = overlapTone(overlap);
  return (
    <span
      className={cn(
        "rounded-full border px-2.5 py-1 text-xs font-black",
        tone === "good" && "border-emerald-200 bg-emerald-50 text-emerald-700",
        tone === "warn" && "border-amber-200 bg-amber-50 text-amber-700",
        tone === "bad" && "border-red-200 bg-red-50 text-red-700",
      )}
    >
      중첩 {overlapPercent(overlap)}
    </span>
  );
}
