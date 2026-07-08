import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/utils/cn";
import type { BadgeTone } from "@/utils/constants";

/**
 * Badge — DESIGN_SYSTEM §5.6 시그니처.
 * text-[10px] px-1.5 py-0.5 rounded-full font-medium border + 의미별 3색.
 */
export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
  /** 펄스 강조 (slate-default 외에 어텐션 유도). */
  pulse?: boolean;
  children?: ReactNode;
}

const TONE: Record<BadgeTone, string> = {
  slate: "bg-slate-50 text-slate-500 border-slate-100",
  blue: "bg-blue-50 text-blue-600 border-blue-100",
  emerald: "bg-emerald-50 text-emerald-600 border-emerald-100",
  amber: "bg-amber-50 text-amber-600 border-amber-100",
  red: "bg-red-50 text-red-600 border-red-100",
};

export function Badge({
  tone = "slate",
  pulse = false,
  className,
  children,
  ...rest
}: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full font-medium border",
        TONE[tone],
        pulse && "animate-pulse",
        className,
      )}
      {...rest}
    >
      {children}
    </span>
  );
}
