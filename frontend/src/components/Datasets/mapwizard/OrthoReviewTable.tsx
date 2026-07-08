import { AlertTriangle } from "lucide-react";
import type { OrthoCurrent, OrthoGroup } from "@/types/mapProject";
import { overlapPercent, overlapTone } from "@/utils/mapProject";
import { cn } from "@/utils/cn";

export interface OrthoReviewTableProps {
  groups: OrthoGroup[];
  hoveredId: string | null;
  onHover: (id: string | null) => void;
  onToggleCurrent: (pastId: string, currentId: string) => void;
}

export function OrthoReviewTable({
  groups,
  hoveredId,
  onHover,
  onToggleCurrent,
}: OrthoReviewTableProps) {
  return (
    <div className="space-y-2.5">
      {groups.map((group) => {
        const includedCount = group.currents.filter((current) => current.included).length;
        const active = includedCount > 0;
        if (group.currents.length === 1) {
          return (
            <OneToOneRow
              key={group.past.id}
              group={group}
              current={group.currents[0]!}
              hoveredId={hoveredId}
              onHover={onHover}
              onToggleCurrent={onToggleCurrent}
            />
          );
        }
        return (
          <div
            key={group.past.id}
            className="grid grid-cols-[136px_minmax(0,1fr)] gap-2.5"
          >
            <div
              onMouseEnter={() => onHover(group.past.id)}
              onMouseLeave={() => onHover(null)}
              className={cn(
                "rounded-lg border p-3 min-h-[96px] flex flex-col justify-center transition-colors",
                hoveredId === group.past.id
                  ? "border-blue-300 bg-blue-50"
                  : "border-blue-100 bg-blue-50/70",
                !active && "opacity-55 grayscale",
              )}
            >
              <div className="font-mono text-[12px] font-black text-slate-900 truncate">
                {group.past.id}
              </div>
              <div className="mt-0.5 truncate text-[11px] font-black text-slate-700">
                {group.past.displayName}
              </div>
              <div className="mt-1 text-[11px] font-bold text-blue-700">
                {group.past.year ?? "-"} · {group.past.gsd}
              </div>
              <div className={cn("mt-2 text-xs font-black", overlapTextClass(group.overlap))}>
                중첩 {overlapPercent(group.overlap)}
              </div>
              {group.currents.length > 1 ? (
                <div className="mt-1 inline-flex w-fit rounded-full bg-white px-2 py-0.5 text-[10px] font-black text-blue-700 ring-1 ring-blue-100">
                  당해 {includedCount}장 → 과년 1장
                </div>
              ) : null}
              {group.overlap < 0.95 ? (
                <div className="mt-2 flex items-center gap-1 text-[10px] font-black text-amber-700">
                  <AlertTriangle size={12} />
                  중첩 확인 필요
                </div>
              ) : null}
            </div>

            <div className="space-y-1.5 min-w-0">
              {group.currents.map((current) => (
                <label
                  key={current.id}
                  onMouseEnter={() => onHover(current.id)}
                  onMouseLeave={() => onHover(null)}
                  className={cn(
                    "flex min-h-[44px] cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-2 transition-colors",
                    current.included
                      ? "border-emerald-200 bg-white hover:bg-emerald-50"
                      : "border-slate-200 bg-slate-50 opacity-60 hover:opacity-90",
                    hoveredId === current.id && "ring-2 ring-emerald-200",
                  )}
                >
                  <input
                    type="checkbox"
                    checked={current.included}
                    onChange={() => onToggleCurrent(group.past.id, current.id)}
                    className="h-4 w-4 shrink-0 accent-emerald-600"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="font-mono text-[12px] font-black text-slate-900 truncate">
                      {current.id}
                    </div>
                    <div className="mt-0.5 truncate text-[11px] font-black text-slate-700">
                      {current.displayName}
                    </div>
                    <div className="mt-0.5 text-[11px] font-bold text-slate-500 truncate">
                      {current.gsd} · {current.captured} · 도엽{" "}
                      {current.sheets[0] ?? "-"}
                    </div>
                  </div>
                  <span className="shrink-0 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-black text-emerald-700">
                    {overlapPercent(current.overlap)}
                  </span>
                </label>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function OneToOneRow({
  group,
  current,
  hoveredId,
  onHover,
  onToggleCurrent,
}: {
  group: OrthoGroup;
  current: OrthoCurrent;
  hoveredId: string | null;
  onHover: (id: string | null) => void;
  onToggleCurrent: (pastId: string, currentId: string) => void;
}) {
  const active = current.included;
  return (
    <div
      role="button"
      tabIndex={0}
      className={cn(
        "grid min-h-[82px] cursor-pointer grid-cols-[minmax(0,1fr)_28px_minmax(0,1fr)_58px] items-center gap-2 rounded-lg border px-3 py-2 transition-colors",
        active
          ? "border-slate-200 bg-white hover:bg-slate-50"
          : "border-slate-200 bg-slate-50 opacity-60 hover:opacity-90",
        (hoveredId === group.past.id || hoveredId === current.id) && "ring-2 ring-blue-200",
      )}
      onClick={() => onToggleCurrent(group.past.id, current.id)}
      onMouseEnter={() => onHover(current.id)}
      onMouseLeave={() => onHover(null)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onToggleCurrent(group.past.id, current.id);
        }
      }}
    >
      <PairSide
        tone="past"
        id={group.past.id}
        name={group.past.displayName}
        meta={`${group.past.year ?? "-"} · ${group.past.gsd}`}
      />
      <div className="text-center text-lg font-black text-slate-300">→</div>
      <PairSide
        tone="current"
        id={current.id}
        name={current.displayName}
        meta={`${current.gsd} · ${current.captured}`}
      />
      <div className="flex flex-col items-end gap-1">
        <input
          type="checkbox"
          checked={active}
          onChange={() => onToggleCurrent(group.past.id, current.id)}
          className="h-4 w-4 accent-emerald-600"
          onClick={(event) => event.stopPropagation()}
        />
        <span className={cn("text-[11px] font-black", overlapTextClass(group.overlap))}>
          {overlapPercent(group.overlap)}
        </span>
      </div>
    </div>
  );
}

function PairSide({
  tone,
  id,
  name,
  meta,
}: {
  tone: "past" | "current";
  id: string;
  name: string;
  meta: string;
}) {
  return (
    <div
      className={cn(
        "min-w-0 rounded-md border px-2.5 py-2",
        tone === "past"
          ? "border-blue-100 bg-blue-50/70"
          : "border-emerald-100 bg-emerald-50/70",
      )}
    >
      <div className="font-mono text-[12px] font-black text-slate-900 truncate">
        {id}
      </div>
      <div className="mt-0.5 truncate text-[11px] font-black text-slate-700">
        {name}
      </div>
      <div
        className={cn(
          "mt-0.5 truncate text-[11px] font-bold",
          tone === "past" ? "text-blue-700" : "text-emerald-700",
        )}
      >
        {meta}
      </div>
    </div>
  );
}

function overlapTextClass(overlap: number): string {
  const tone = overlapTone(overlap);
  if (tone === "good") return "text-emerald-700";
  if (tone === "warn") return "text-amber-700";
  return "text-red-700";
}
