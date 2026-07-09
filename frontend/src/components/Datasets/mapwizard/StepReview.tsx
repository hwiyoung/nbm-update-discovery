import { AlertTriangle, Layers2 } from "lucide-react";
import type {
  OrthoCompositeSelection,
  OrthoCurrent,
  OrthoGroup,
  OrthoImage,
  OrthoPast,
  OrthoSummary,
} from "@/types/mapProject";
import {
  allOrthoFeatures,
  allOrthoCurrentCandidates,
  overlapPercent,
  overlapTone,
} from "@/utils/mapProject";
import { cn } from "@/utils/cn";

export interface StepReviewProps {
  groups: OrthoGroup[];
  summary: OrthoSummary;
  composite: OrthoCompositeSelection;
  hoveredId: string | null;
  onHover: (id: string | null) => void;
  onTogglePast: (pastId: string) => void;
  onToggleCurrent: (currentId: string) => void;
}

export function StepReview({
  groups,
  summary,
  composite,
  hoveredId,
  onHover,
  onTogglePast,
  onToggleCurrent,
}: StepReviewProps) {
  const images = allOrthoFeatures(groups);
  const pasts = images.filter((image): image is OrthoPast => image.era === "past");
  const currents = allOrthoCurrentCandidates(groups);
  const hasSelection = composite.pasts.length > 0 && composite.currents.length > 0;
  const hasCommonSheets = composite.commonSheets.length > 0;

  return (
    <div className="p-5 space-y-4">
      <section className="space-y-2">
        <div className="text-[11px] font-black uppercase tracking-wide text-blue-600">
          Step 2
        </div>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-xl font-black text-slate-900">입력 영상 선택</h3>
            <p className="mt-1 text-sm leading-6 text-slate-600">
              조회된 정사영상 중 과년도 입력과 당해년도 입력에 사용할 영상을
              체크합니다. 여러 장을 선택하면 한쪽 입력으로 묶어 처리합니다.
            </p>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1">
            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-black text-slate-700">
              조회 {summary.matchedCount}장
            </span>
            <OverlapBadge overlap={summary.overlap} />
          </div>
        </div>
      </section>

      <div className="grid grid-cols-3 gap-2">
        <MiniMetric label="과년도 선택" value={`${composite.pasts.length}장`} />
        <MiniMetric label="당해년도 선택" value={`${composite.currents.length}장`} />
        <MiniMetric label="공통 도엽" value={`${composite.commonSheets.length}매`} />
      </div>

      {!hasSelection ? (
        <Warning>과년도와 당해년도 영상을 각각 1장 이상 선택해야 합니다.</Warning>
      ) : null}
      {hasSelection && !hasCommonSheets ? (
        <Warning>선택한 과년도·당해년도 영상 사이에 공통 도엽이 없습니다.</Warning>
      ) : null}

      <div className="rounded-xl border border-slate-200 bg-white">
        <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-3 py-2.5">
          <div className="flex items-center gap-2">
            <Layers2 size={15} className="text-blue-600" />
            <span className="text-xs font-black text-slate-700">
              과년도 · 당해년도 선택
            </span>
          </div>
          <span className="text-[11px] font-bold text-slate-400">
            선택 {composite.pasts.length + composite.currents.length}장
          </span>
        </div>
        <div className="grid grid-cols-2 gap-3 p-3">
          <ImageColumn
            title="과년도"
            tone="past"
            images={pasts}
            hoveredId={hoveredId}
            onHover={onHover}
            onToggle={onTogglePast}
          />
          <ImageColumn
            title="당해년도"
            tone="current"
            images={currents}
            hoveredId={hoveredId}
            onHover={onHover}
            onToggle={onToggleCurrent}
          />
        </div>
      </div>
    </div>
  );
}

function ImageColumn({
  title,
  tone,
  images,
  hoveredId,
  onHover,
  onToggle,
}: {
  title: string;
  tone: "past" | "current";
  images: Array<OrthoPast | OrthoCurrent>;
  hoveredId: string | null;
  onHover: (id: string | null) => void;
  onToggle: (id: string) => void;
}) {
  return (
    <div className="min-w-0">
      <div
        className={cn(
          "mb-2 rounded-md border px-3 py-2 text-xs font-black",
          tone === "past"
            ? "border-blue-100 bg-blue-50 text-blue-700"
            : "border-emerald-100 bg-emerald-50 text-emerald-700",
        )}
      >
        {title}
      </div>
      <div className="max-h-[396px] space-y-1.5 overflow-y-auto pr-1 custom-scrollbar">
        {images.map((image) => (
          <ImageCheckRow
            key={image.id}
            image={image}
            tone={tone}
            active={hoveredId === image.id}
            onHover={onHover}
            onToggle={onToggle}
          />
        ))}
        {images.length === 0 ? (
          <div className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-8 text-center text-xs font-bold text-slate-400">
            조회된 영상 없음
          </div>
        ) : null}
      </div>
    </div>
  );
}

function ImageCheckRow({
  image,
  tone,
  active,
  onHover,
  onToggle,
}: {
  image: OrthoPast | OrthoCurrent;
  tone: "past" | "current";
  active: boolean;
  onHover: (id: string | null) => void;
  onToggle: (id: string) => void;
}) {
  const included = image.included;
  const overlap = "overlap" in image ? image.overlap : null;

  return (
    <label
      onMouseEnter={() => onHover(image.id)}
      onMouseLeave={() => onHover(null)}
      className={cn(
        "flex min-h-[72px] cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2 transition-colors",
        included
          ? "border-slate-200 bg-white hover:bg-slate-50"
          : "border-slate-200 bg-slate-50 opacity-60 hover:opacity-90",
        active && (tone === "past" ? "ring-2 ring-blue-200" : "ring-2 ring-emerald-200"),
      )}
    >
      <input
        type="checkbox"
        checked={included}
        onChange={() => onToggle(image.id)}
        className={cn(
          "mt-1 h-4 w-4 shrink-0",
          tone === "past" ? "accent-blue-600" : "accent-emerald-600",
        )}
      />
      <ImageText image={image} overlap={overlap} tone={tone} />
    </label>
  );
}

function ImageText({
  image,
  overlap,
  tone,
}: {
  image: OrthoImage;
  overlap: number | null;
  tone: "past" | "current";
}) {
  return (
    <div className="min-w-0 flex-1">
      <div className="flex min-w-0 items-center gap-1.5">
        <span
          className={cn(
            "shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-black",
            tone === "past"
              ? "bg-blue-50 text-blue-700"
              : "bg-emerald-50 text-emerald-700",
          )}
        >
          {image.year ?? "-"}
        </span>
        <span className="min-w-0 truncate font-mono text-[12px] font-black text-slate-900">
          {image.id}
        </span>
      </div>
      <div className="mt-1 truncate text-[11px] font-black text-slate-700">
        {image.displayName}
      </div>
      <div className="mt-0.5 truncate text-[11px] font-bold text-slate-500">
        {image.regions[0] ?? "권역 미확인"} · 도엽 {image.sheets.length.toLocaleString("ko-KR")}매
      </div>
      {overlap != null ? (
        <div className={cn("mt-1 text-[11px] font-black", overlapTextClass(overlap))}>
          중첩 {overlapPercent(overlap)}
        </div>
      ) : null}
    </div>
  );
}

function Warning({ children }: { children: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-bold text-red-700">
      <AlertTriangle size={15} />
      {children}
    </div>
  );
}

function MiniMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
      <div className="text-[10px] font-black text-slate-400">{label}</div>
      <div className="mt-0.5 truncate text-sm font-black text-slate-800">{value}</div>
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

function overlapTextClass(overlap: number): string {
  const tone = overlapTone(overlap);
  if (tone === "good") return "text-emerald-700";
  if (tone === "warn") return "text-amber-700";
  return "text-red-700";
}
