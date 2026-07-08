import { Accordion, Tooltip } from "@/components/Common";
import { useSheetDetailStore } from "@/stores/sheetDetailStore";
import { HelpCircle } from "lucide-react";
import { cn } from "@/utils/cn";
import { useId } from "react";

/**
 * 2번 아코디언 — 확신도.
 * 듀얼 핸들 슬라이더 (자체 구현). 0~100.
 */
export function ConfidenceAccordion() {
  const min = useSheetDetailStore((s) => s.filter.confidenceMin);
  const max = useSheetDetailStore((s) => s.filter.confidenceMax);
  const setFilter = useSheetDetailStore((s) => s.setFilter);
  const id = useId();

  const setMin = (v: number) => {
    const clamped = Math.min(v, max - 1);
    setFilter({ confidenceMin: Math.max(0, clamped) });
  };
  const setMax = (v: number) => {
    const clamped = Math.max(v, min + 1);
    setFilter({ confidenceMax: Math.min(100, clamped) });
  };

  const range = ((max - min) / 100) * 100;
  const left = (min / 100) * 100;

  return (
    <Accordion
      id="confidence"
      title={
        <span className="flex items-center gap-1.5">
          확신도
          <Tooltip content="AI 모델이 변화로 판단한 확신 정도. 80% 이상이면 일반적으로 신뢰 가능합니다.">
            <span className="text-slate-400 cursor-help">
              <HelpCircle size={12} />
            </span>
          </Tooltip>
        </span>
      }
      trailing={<span className="text-[11px] font-bold text-slate-500">{min}–{max}</span>}
    >
      <div className="space-y-3 px-1">
        <div className="relative h-8">
          {/* 트랙 */}
          <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-1.5 rounded-full bg-slate-200" />
          {/* 활성 구간 */}
          <div
            className="absolute top-1/2 -translate-y-1/2 h-1.5 rounded-full bg-blue-500"
            style={{ left: `${left}%`, width: `${range}%` }}
          />
          {/* 두 input range 겹침 */}
          <input
            id={`${id}-min`}
            type="range"
            min={0}
            max={100}
            value={min}
            onChange={(e) => setMin(Number(e.target.value))}
            className={cn(
              "absolute inset-0 w-full appearance-none bg-transparent",
              "pointer-events-none [&::-webkit-slider-thumb]:pointer-events-auto",
              "[&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-blue-600 [&::-webkit-slider-thumb]:shadow",
              "[&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-white [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-blue-600",
            )}
            aria-label="확신도 최솟값"
          />
          <input
            id={`${id}-max`}
            type="range"
            min={0}
            max={100}
            value={max}
            onChange={(e) => setMax(Number(e.target.value))}
            className={cn(
              "absolute inset-0 w-full appearance-none bg-transparent",
              "pointer-events-none [&::-webkit-slider-thumb]:pointer-events-auto",
              "[&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-blue-600 [&::-webkit-slider-thumb]:shadow",
              "[&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-white [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-blue-600",
            )}
            aria-label="확신도 최댓값"
          />
        </div>
      </div>
    </Accordion>
  );
}
