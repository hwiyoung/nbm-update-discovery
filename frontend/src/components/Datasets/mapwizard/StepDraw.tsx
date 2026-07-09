import { MousePointer2, Search } from "lucide-react";
import type { BBox, OrthoGroup, OrthoImage, OrthoSummary } from "@/types/mapProject";
import { allOrthoFeatures, overlapPercent, overlapTone } from "@/utils/mapProject";
import { cn } from "@/utils/cn";

export interface StepDrawProps {
  drawnBBox: BBox | null;
  summary: OrthoSummary;
  readyDatasetCount: number;
  groups: OrthoGroup[];
  hoveredId: string | null;
  onHover: (id: string | null) => void;
}

export function StepDraw({
  drawnBBox,
  summary,
  readyDatasetCount,
  groups,
  hoveredId,
  onHover,
}: StepDrawProps) {
  const hasResult = summary.matchedCount > 0;
  const hasEmptyResult = drawnBBox && !hasResult;
  const images = allOrthoFeatures(groups);

  return (
    <div className="p-5 space-y-5">
      <section className="space-y-2">
        <div className="text-[11px] font-black uppercase tracking-wide text-blue-600">
          Step 1
        </div>
        <h3 className="text-xl font-black text-slate-900">분석 영역 지정</h3>
        <p className="text-sm leading-6 text-slate-600">
          지도 위에서 바로 사각형을 그리면 범위와 겹치는 정사영상을 조회합니다.
          새 영역을 그리면 기존 영역은 자동으로 교체됩니다.
        </p>
      </section>

      <div className="rounded-lg border border-blue-100 bg-blue-50 px-3 py-2.5 text-xs font-bold leading-5 text-blue-800">
        <div className="flex items-start gap-2">
          <MousePointer2 size={15} className="mt-0.5 shrink-0" />
          <span>
            좌클릭 드래그로 영역을 지정합니다. 지도 이동은 휠 버튼을 누른 채
            드래그하고, 그린 영역 밖을 클릭하면 선택 영역이 지워집니다.
          </span>
        </div>
      </div>

      <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs text-slate-600">
        <div className="flex items-center justify-between gap-3">
          <span className="font-bold text-slate-700">검색 가능한 정사영상</span>
          <span className="font-black text-slate-900">
            {readyDatasetCount.toLocaleString("ko-KR")}장
          </span>
        </div>
      </div>

      {!drawnBBox ? (
        <div className="min-h-[180px] rounded-lg border-2 border-dashed border-slate-200 bg-white flex flex-col items-center justify-center px-5 text-center">
          <Search size={28} className="text-slate-300" />
          <div className="mt-3 text-sm font-black text-slate-600">
            영역을 그리면 조회 결과가 표시됩니다
          </div>
          <div className="mt-1 text-xs text-slate-400">
            조회된 영상은 다음 단계에서 과년도와 당해년도 입력으로 선택합니다.
          </div>
        </div>
      ) : null}

      {hasResult ? (
        <div className="rounded-xl border border-blue-100 bg-blue-50 p-4 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-xs font-black text-blue-700">조회 결과</div>
              <div className="mt-1 text-3xl font-black text-slate-900">
                {summary.matchedCount.toLocaleString("ko-KR")}
                <span className="ml-1 text-sm font-black text-slate-500">장</span>
              </div>
            </div>
            <OverlapBadge overlap={summary.overlap} />
          </div>

          <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
            <Metric label="과년도" value={`${summary.pastCount}장`} />
            <Metric label="당해년도" value={`${summary.currentCount}장`} />
            <Metric label="권역" value={summary.region} />
            <Metric label="도엽" value={`${summary.sheetCount}매`} />
            <Metric
              label="대상 면적"
              value={`${summary.areaKm2.toFixed(2)}㎢`}
              wide
            />
          </div>

          <div className="mt-4 rounded-lg border border-blue-100 bg-white/80">
            <div className="border-b border-blue-50 px-3 py-2 text-[11px] font-black text-slate-500">
              조회 영상
            </div>
            <div className="max-h-[170px] overflow-y-auto custom-scrollbar p-2 space-y-1.5">
              {images.map((image) => (
                <ImageLine
                  key={image.id}
                  image={image}
                  active={hoveredId === image.id}
                  onHover={onHover}
                />
              ))}
            </div>
          </div>
        </div>
      ) : null}

      {hasEmptyResult ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4">
          <div className="text-sm font-black text-red-700">
            조회된 정사영상이 없습니다
          </div>
          <div className="mt-1 text-xs leading-5 text-red-600">
            검색 가능한 정사영상 범위와 겹치도록 영역을 다시 지정하세요.
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ImageLine({
  image,
  active,
  onHover,
}: {
  image: OrthoImage;
  active: boolean;
  onHover: (id: string | null) => void;
}) {
  return (
    <div
      onMouseEnter={() => onHover(image.id)}
      onMouseLeave={() => onHover(null)}
      className={cn(
        "rounded-md border px-2.5 py-2 text-[11px] transition-colors",
        active ? "border-blue-200 bg-blue-50" : "border-slate-100 bg-white",
      )}
    >
      <div className="flex items-center gap-2">
      <span
        className="shrink-0 rounded-full bg-slate-100 px-1.5 py-0.5 font-black text-slate-600"
      >
        {image.year ?? "-"}
      </span>
      <span className="shrink-0 font-mono font-black text-slate-700">{image.id}</span>
      <span className="min-w-0 truncate font-bold text-slate-600">
        {image.displayName}
      </span>
      </div>
      <div className="mt-1 truncate pl-[54px] text-[10px] font-bold text-slate-400">
        {image.regions[0] ?? "권역 미확인"} · 도엽 {image.sheets.length.toLocaleString("ko-KR")}매
      </div>
    </div>
  );
}

function Metric({
  label,
  value,
  wide,
}: {
  label: string;
  value: string;
  wide?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-md border border-white/70 bg-white/90 px-3 py-2",
        wide && "col-span-2",
      )}
    >
      <div className="font-bold text-slate-400">{label}</div>
      <div className="mt-0.5 font-black text-slate-800 truncate">{value}</div>
    </div>
  );
}

function OverlapBadge({ overlap }: { overlap: number }) {
  const tone = overlapTone(overlap);
  return (
    <div
      className={cn(
        "rounded-full border px-2.5 py-1 text-xs font-black",
        tone === "good" && "border-emerald-200 bg-emerald-50 text-emerald-700",
        tone === "warn" && "border-amber-200 bg-amber-50 text-amber-700",
        tone === "bad" && "border-red-200 bg-red-50 text-red-700",
      )}
    >
      중첩 {overlapPercent(overlap)}
    </div>
  );
}
