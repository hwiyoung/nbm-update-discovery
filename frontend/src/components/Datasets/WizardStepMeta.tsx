import { Zap } from "lucide-react";
import { Input } from "@/components/Common";
import type { Dataset } from "@/types";
import type { WizardSelection } from "@/stores/datasetsStore";
import { OBJECT_CATEGORY_LABEL } from "@/utils/constants";
import type { ObjectCategory } from "@/types";
import { cn } from "@/utils/cn";
import { ResourceSummaryCard } from "./ResourceSummaryCard";

export interface WizardStepMetaProps {
  selection: WizardSelection;
  datasets: Dataset[];
  overlapRatio: number | null;
  overlapLoading: boolean;
  hasPendingSelection: boolean;
  onChange: (partial: Partial<WizardSelection>) => void;
}

/**
 * 위저드 2단계 — 작업 메타 입력 + 등록 직전 요약.
 *
 * 좌: 작업명·설명·객체 카테고리·자동 처리 옵션 (form)
 * 우: 자원 요약 카드 (선택 결과 실시간 반영)
 */
export function WizardStepMeta({
  selection,
  datasets,
  overlapRatio,
  overlapLoading,
  hasPendingSelection,
  onChange,
}: WizardStepMetaProps) {
  const toggleModel = (m: ObjectCategory) => {
    const next = selection.models.includes(m)
      ? selection.models.filter((x) => x !== m)
      : [...selection.models, m];
    onChange({ models: next });
  };
  const categories: ObjectCategory[] = ["building", "road"];

  const stdDataset = selection.standardId
    ? datasets.find((d) => d.id === selection.standardId) ?? null
    : null;
  const cmpDataset = selection.compareId
    ? datasets.find((d) => d.id === selection.compareId) ?? null
    : null;
  return (
    <div className="grid grid-cols-[1fr_1fr] gap-5">
      {/* ===== 좌: 작업 메타 입력 ===== */}
      <div className="space-y-4">
        <div>
          <label className="block text-xs font-bold text-slate-500 mb-1.5">
            작업명
          </label>
          <Input
            value={selection.name}
            onChange={(e) => onChange({ name: e.target.value })}
            placeholder="예: 안양 2022→2024 변화탐지"
          />
        </div>

        <div>
          <label className="block text-xs font-bold text-slate-500 mb-1.5">
            설명 (선택)
          </label>
          <textarea
            value={selection.description}
            onChange={(e) => onChange({ description: e.target.value })}
            rows={3}
            className="w-full text-sm px-3 py-2 border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div>
          <span className="block text-xs font-bold text-slate-500 mb-1.5">
            객체 카테고리
          </span>
          <div className="flex flex-wrap gap-1.5">
            {categories.map((c) => {
              const active = selection.models.includes(c);
              return (
                <button
                  key={c}
                  type="button"
                  aria-pressed={active}
                  onClick={() => toggleModel(c)}
                  className={cn(
                    "h-8 px-3 rounded-full text-xs font-bold border transition-colors",
                    active
                      ? "bg-blue-600 text-white border-blue-600"
                      : "bg-white text-slate-700 border-slate-200 hover:bg-slate-50",
                  )}
                >
                  {OBJECT_CATEGORY_LABEL[c]} 변화
                </button>
              );
            })}
          </div>
        </div>

        <label
          className={cn(
            "flex items-start gap-2 select-none rounded-md border px-3 py-2.5 transition-colors",
            "border-slate-200 bg-slate-50 hover:bg-slate-100 cursor-pointer",
          )}
        >
          <input
            type="checkbox"
            checked={selection.autoRun}
            onChange={(e) => onChange({ autoRun: e.target.checked })}
            className="mt-0.5 w-3.5 h-3.5 rounded text-blue-600 focus:ring-blue-500 shrink-0"
          />
          <div className="text-xs">
            <div className="font-bold text-slate-800">
              영상 등록 후 바로 변화탐지 처리
            </div>
            <div className="mt-0.5 text-slate-500">
              서버에서 선택한 영상은 업로드 저장소로 복사하고 dataset 등록을 마친 뒤,
              체크되어 있으면 바로 추론을 시작합니다. 체크 해제 시 작업만 등록합니다.
            </div>
          </div>
        </label>
      </div>

      {/* ===== 우: 실시간 요약 ===== */}
      <div className="space-y-3">
        <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wide pb-1 border-b border-slate-100">
          등록 요약
        </div>

        <div className="grid grid-cols-2 gap-2">
          <ResourceSummaryCard
            tone="blue"
            label="과년도"
            pendingMeta={selection.standardPending}
            existing={stdDataset}
          />
          <ResourceSummaryCard
            tone="emerald"
            label="당해년도"
            pendingMeta={selection.comparePending}
            existing={cmpDataset}
          />
        </div>

        <div className="rounded-md border border-slate-100 bg-white px-3 py-2.5 text-[11px] text-slate-600">
          <div className="flex items-center justify-between gap-2">
            <span className="font-bold text-slate-700">중첩률</span>
            <span className="font-black text-slate-900">
              {hasPendingSelection
                ? "등록 후 계산"
                : overlapLoading
                  ? "계산 중..."
                  : overlapRatio == null
                    ? "-"
                    : `${(overlapRatio * 100).toFixed(1)}%`}
            </span>
          </div>
        </div>

        <div className="rounded-md border border-slate-100 bg-white px-3 py-2.5 text-[11px] text-slate-700 flex items-center gap-2">
          {selection.autoRun ? (
            <>
              <Zap size={12} className="text-emerald-600 shrink-0" />
              <span>
                <span className="font-bold text-slate-800">등록 + 추론 시작</span>{" "}
                · 등록 직후 Celery 큐로 추론 작업이 전송됩니다.
              </span>
            </>
          ) : (
            <span>
              <span className="font-bold text-slate-800">등록만</span> · 추후
              상세 페이지에서 수동으로 추론을 시작합니다.
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
