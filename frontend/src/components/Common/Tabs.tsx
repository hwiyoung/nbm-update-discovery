import type { ReactNode } from "react";
import { cn } from "@/utils/cn";

/**
 * Tabs — 활성 탭 border-b-2 border-blue-600 (PROMPTS §2 명시).
 * DESIGN_SYSTEM §5.5 의 "파란 배경 + 흰 글씨" pill 스타일은 처리 화면 메인 탭에서는
 * 정보 밀도가 낮아 부적합. 본 컴포넌트는 underline 타입.
 */
export interface TabItem<T extends string = string> {
  value: T;
  label: ReactNode;
  disabled?: boolean;
  /** 우측에 보조 카운트 등 표시. */
  trailing?: ReactNode;
}

export interface TabsProps<T extends string = string> {
  items: TabItem<T>[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
}

export function Tabs<T extends string>({
  items,
  value,
  onChange,
  className,
}: TabsProps<T>) {
  return (
    <div
      role="tablist"
      className={cn("flex gap-1 border-b border-slate-200", className)}
    >
      {items.map((item) => {
        const active = item.value === value;
        return (
          <button
            key={item.value}
            type="button"
            role="tab"
            aria-selected={active}
            disabled={item.disabled}
            onClick={() => onChange(item.value)}
            className={cn(
              "h-9 px-3 -mb-px text-sm font-bold transition-colors border-b-2",
              "focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded-t-md",
              active
                ? "text-blue-600 border-blue-600"
                : "text-slate-500 border-transparent hover:text-slate-700",
              item.disabled && "opacity-40 cursor-not-allowed hover:text-slate-500",
            )}
          >
            <span className="inline-flex items-center gap-2">
              {item.label}
              {item.trailing}
            </span>
          </button>
        );
      })}
    </div>
  );
}
