import { Building2, Layers2, Route, Zap } from "lucide-react";
import { Input } from "@/components/Common";
import type { WizardSelection } from "@/stores/datasetsStore";
import type { ObjectCategory } from "@/types";
import type { OrthoCompositeSelection, OrthoSummary } from "@/types/mapProject";
import { OBJECT_CATEGORY_LABEL } from "@/utils/constants";
import { overlapPercent, overlapTone } from "@/utils/mapProject";
import { cn } from "@/utils/cn";

export interface StepMetaProps {
  selection: WizardSelection;
  summary: OrthoSummary;
  composite: OrthoCompositeSelection;
  onChange: (partial: Partial<WizardSelection>) => void;
}

export function StepMeta({
  selection,
  summary,
  composite,
  onChange,
}: StepMetaProps) {
  const categories: ObjectCategory[] = ["building", "road"];
  const toggleModel = (model: ObjectCategory) => {
    const next = selection.models.includes(model)
      ? selection.models.filter((item) => item !== model)
      : [...selection.models, model];
    onChange({ models: next });
  };

  return (
    <div className="p-5 space-y-5">
      <section className="space-y-2">
        <div className="text-[11px] font-black uppercase tracking-wide text-blue-600">
          Step 3
        </div>
        <h3 className="text-xl font-black text-slate-900">작업 메타</h3>
      </section>

      <div className="space-y-4">
        <div>
          <label className="mb-1.5 block text-xs font-bold text-slate-500">
            작업명
          </label>
          <Input
            value={selection.name}
            onChange={(event) => onChange({ name: event.target.value })}
            placeholder="예: 안양 2025→2026 변화탐지"
          />
        </div>

        <div>
          <label className="mb-1.5 block text-xs font-bold text-slate-500">
            설명 (선택)
          </label>
          <textarea
            value={selection.description}
            onChange={(event) => onChange({ description: event.target.value })}
            rows={3}
            className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-800 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div>
          <span className="mb-1.5 block text-xs font-bold text-slate-500">
            객체 카테고리
          </span>
          <div className="flex flex-wrap gap-2">
            {categories.map((category) => {
              const active = selection.models.includes(category);
              const Icon = category === "building" ? Building2 : Route;
              return (
                <button
                  key={category}
                  type="button"
                  aria-pressed={active}
                  onClick={() => toggleModel(category)}
                  className={cn(
                    "inline-flex h-9 items-center gap-1.5 rounded-full border px-3 text-xs font-black transition-colors",
                    active
                      ? "border-blue-600 bg-blue-600 text-white"
                      : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50",
                  )}
                >
                  <Icon size={14} />
                  {OBJECT_CATEGORY_LABEL[category]} 변화
                </button>
              );
            })}
          </div>
        </div>

        <label className="flex cursor-pointer select-none items-start gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-3 transition-colors hover:bg-slate-100">
          <input
            type="checkbox"
            checked={selection.autoRun}
            onChange={(event) => onChange({ autoRun: event.target.checked })}
            className="mt-0.5 h-4 w-4 shrink-0 accent-blue-600"
          />
          <div className="min-w-0 text-xs">
            <div className="flex items-center gap-1.5 font-black text-slate-800">
              <Zap size={14} className="text-emerald-600" />
              영상 등록 후 바로 변화탐지 처리
            </div>
            <div className="mt-1 leading-5 text-slate-500">
              체크 해제 시 작업만 등록하고 상세 화면에서 수동으로 시작합니다.
            </div>
          </div>
        </label>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white">
        <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-3 py-2.5">
          <div className="flex items-center gap-2">
            <Layers2 size={15} className="text-blue-600" />
            <span className="text-xs font-black text-slate-700">등록 요약</span>
          </div>
          <OverlapBadge overlap={summary.overlap} />
        </div>

        <div className="space-y-3 p-3">
          <div className="grid grid-cols-2 gap-2 text-xs">
            <SummaryMetric label="권역" value={summary.region} />
            <SummaryMetric label="도엽" value={`${summary.sheetCount}매`} />
            <SummaryMetric label="대상 면적" value={`${summary.areaKm2.toFixed(2)}㎢`} />
            <SummaryMetric
              label="등록 단위"
              value="1개 프로젝트"
            />
          </div>

          <div className="space-y-1.5">
            <div className="text-[11px] font-black text-slate-400">
              선택 영상
            </div>
            <div className="grid grid-cols-2 gap-2">
              <SelectedColumn title="과년도" ids={composite.pasts.map((image) => image.id)} />
              <SelectedColumn
                title="당해년도"
                ids={composite.currents.map((image) => image.id)}
              />
            </div>
            <div className="rounded-md border border-slate-100 bg-slate-50 px-2.5 py-2 text-[10px] font-bold text-slate-500">
              공통 도엽 {composite.commonSheets.length.toLocaleString("ko-KR")}매 기준으로
              각 입력 묶음을 머지한 뒤 중복 범위에 맞춰 처리합니다.
            </div>
            <div className="max-h-[84px] overflow-y-auto custom-scrollbar pr-1">
              {composite.pasts.length === 0 || composite.currents.length === 0 ? (
                <div className="rounded-md border border-red-100 bg-red-50 px-2.5 py-2 text-xs font-bold text-red-700">
                  등록할 영상 선택이 부족합니다.
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function SelectedColumn({ title, ids }: { title: string; ids: string[] }) {
  return (
    <div className="rounded-md border border-slate-100 bg-slate-50 px-2.5 py-2">
      <div className="text-[10px] font-black text-slate-400">{title}</div>
      <div className="mt-1 max-h-[92px] space-y-1 overflow-y-auto custom-scrollbar pr-1">
        {ids.map((id) => (
          <div
            key={id}
            className="truncate font-mono text-[11px] font-black text-slate-800"
          >
            {id}
          </div>
        ))}
        {ids.length === 0 ? (
          <div className="text-[11px] font-bold text-slate-400">선택 없음</div>
        ) : null}
      </div>
    </div>
  );
}

function SummaryMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-slate-100 bg-slate-50 px-3 py-2">
      <div className="text-[10px] font-black text-slate-400">{label}</div>
      <div className="mt-0.5 truncate text-xs font-black text-slate-800">{value}</div>
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
