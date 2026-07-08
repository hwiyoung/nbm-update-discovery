import { Search, Square, Trash2 } from "lucide-react";
import { Button } from "@/components/Common";
import type { BBox, OrthoGroup, OrthoSummary } from "@/types/mapProject";
import { overlapPercent, overlapTone } from "@/utils/mapProject";
import { cn } from "@/utils/cn";

export interface StepDrawProps {
  drawnBBox: BBox | null;
  summary: OrthoSummary;
  readyDatasetCount: number;
  groups: OrthoGroup[];
  drawing: boolean;
  onStartDrawing: () => void;
  onClear: () => void;
}

export function StepDraw({
  drawnBBox,
  summary,
  readyDatasetCount,
  groups,
  drawing,
  onStartDrawing,
  onClear,
}: StepDrawProps) {
  const hasResult = summary.matchedCount > 0;
  const hasEmptyResult = drawnBBox && !hasResult;

  return (
    <div className="p-5 space-y-5">
      <section className="space-y-2">
        <div className="text-[11px] font-black uppercase tracking-wide text-blue-600">
          Step 1
        </div>
        <h3 className="text-xl font-black text-slate-900">대상 영역 지정</h3>
        <p className="text-sm leading-6 text-slate-600">
          지도에서 변화탐지를 수행할 범위를 사각형으로 지정하면, 범위와 겹치는
          과년도·당해년도 정사영상을 자동으로 찾습니다.
        </p>
      </section>

      <div className="grid grid-cols-2 gap-2">
        <Button
          variant="primary"
          size="lg"
          leftIcon={<Square size={16} />}
          onClick={onStartDrawing}
          fullWidth
        >
          {drawnBBox ? "다시 그리기" : drawing ? "그리는 중" : "영역 그리기"}
        </Button>
        <Button
          variant="secondary"
          size="lg"
          leftIcon={<Trash2 size={16} />}
          onClick={onClear}
          disabled={!drawnBBox && !drawing}
          fullWidth
        >
          영역 지우기
        </Button>
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
            과년도 1장과 당해년도 여러 장의 매칭을 다음 단계에서 확인합니다.
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
              {groups.map((group) => (
                <div
                  key={group.past.id}
                  className="rounded-md border border-slate-100 bg-white px-2.5 py-2"
                >
                  <ImageLine
                    tone="past"
                    label="과년도"
                    id={group.past.id}
                    name={group.past.displayName}
                  />
                  {group.currents.map((current) => (
                    <ImageLine
                      key={current.id}
                      tone="current"
                      label="당해년도"
                      id={current.id}
                      name={current.displayName}
                    />
                  ))}
                </div>
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
  tone,
  label,
  id,
  name,
}: {
  tone: "past" | "current";
  label: string;
  id: string;
  name: string;
}) {
  return (
    <div className="flex items-center gap-2 py-0.5 text-[11px]">
      <span
        className={cn(
          "shrink-0 rounded-full px-1.5 py-0.5 font-black",
          tone === "past"
            ? "bg-blue-50 text-blue-700"
            : "bg-emerald-50 text-emerald-700",
        )}
      >
        {label}
      </span>
      <span className="shrink-0 font-mono font-black text-slate-700">{id}</span>
      <span className="min-w-0 truncate font-bold text-slate-600">{name}</span>
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
