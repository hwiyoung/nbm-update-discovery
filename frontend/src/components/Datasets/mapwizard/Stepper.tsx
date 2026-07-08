import { Check } from "lucide-react";
import type { WizardStep } from "@/stores/datasetsStore";
import { cn } from "@/utils/cn";

const STEPS: Array<{
  key: WizardStep;
  title: string;
  subtitle: string;
}> = [
  { key: "draw", title: "경계 그리기", subtitle: "지도에서 영역 지정" },
  { key: "review", title: "정사영상 확인", subtitle: "조회 결과 검토" },
  { key: "meta", title: "작업 정보", subtitle: "메타 · 등록" },
];

export function MapProjectStepper({ step }: { step: WizardStep }) {
  const currentIndex = STEPS.findIndex((item) => item.key === step);

  return (
    <div className="h-[66px] shrink-0 bg-white border-b border-slate-100 px-8 flex items-center">
      <div className="grid grid-cols-[1fr_48px_1fr_48px_1fr] items-center w-full">
        {STEPS.map((item, index) => {
          const active = index === currentIndex;
          const done = index < currentIndex;
          return (
            <div key={item.key} className="contents">
              <div className="flex items-center gap-2.5 min-w-0">
                <div
                  className={cn(
                    "h-7 w-7 rounded-full flex items-center justify-center text-xs font-black shrink-0",
                    active || done
                      ? "bg-blue-600 text-white"
                      : "bg-slate-200 text-slate-500",
                  )}
                >
                  {done ? <Check size={15} strokeWidth={3} /> : index + 1}
                </div>
                <div className="min-w-0">
                  <div
                    className={cn(
                      "text-[13px] font-black truncate",
                      active || done ? "text-slate-800" : "text-slate-500",
                    )}
                  >
                    {item.title}
                  </div>
                  <div className="text-[11px] font-bold text-slate-400 truncate">
                    {item.subtitle}
                  </div>
                </div>
              </div>
              {index < STEPS.length - 1 ? (
                <div
                  className={cn(
                    "h-0.5 mx-4",
                    index < currentIndex ? "bg-blue-300" : "bg-slate-200",
                  )}
                />
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
