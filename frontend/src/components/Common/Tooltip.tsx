import * as RTooltip from "@radix-ui/react-tooltip";
import type { ReactNode } from "react";
import { cn } from "@/utils/cn";

/**
 * Tooltip — Radix Tooltip 기반 (hover/focus 자동 표시).
 * 클릭이 아니라 마우스를 잠시 올리기만 해도 미리보기로 나타남.
 * Provider 는 root 에서 1회 (App.tsx) 만 두면 충분 — children 의 Trigger 가 등록.
 */
export interface TooltipProps {
  content: ReactNode;
  side?: "top" | "right" | "bottom" | "left";
  align?: "start" | "center" | "end";
  className?: string;
  /** hover 시작 후 보일 때까지의 지연 ms (기본 100). */
  delayDuration?: number;
  children: ReactNode;
}

export function Tooltip({
  content,
  side = "top",
  align = "center",
  className,
  delayDuration = 100,
  children,
}: TooltipProps) {
  return (
    <RTooltip.Root delayDuration={delayDuration}>
      <RTooltip.Trigger asChild>{children}</RTooltip.Trigger>
      <RTooltip.Portal>
        <RTooltip.Content
          side={side}
          align={align}
          sideOffset={6}
          className={cn(
            "z-[1100] max-w-xs rounded-md bg-slate-800 px-2.5 py-1.5 text-xs text-white shadow-md",
            "data-[state=delayed-open]:animate-in data-[state=delayed-open]:fade-in",
            className,
          )}
        >
          {content}
          <RTooltip.Arrow className="fill-slate-800" />
        </RTooltip.Content>
      </RTooltip.Portal>
    </RTooltip.Root>
  );
}

/**
 * 앱 전역에 한 번만 마운트. App.tsx 의 최상단을 감싼다.
 */
export function TooltipProvider({ children }: { children: ReactNode }) {
  return <RTooltip.Provider delayDuration={100}>{children}</RTooltip.Provider>;
}
