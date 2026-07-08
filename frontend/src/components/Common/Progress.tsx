import { cn } from "@/utils/cn";

/**
 * Progress — DESIGN_SYSTEM §5.8.
 * h-1.5 (얇음) | h-2 (모달 진행). 기본 h-1.5.
 */
export interface ProgressProps {
  /** 0~100 */
  value: number;
  /** 트랙 굵기. */
  size?: "sm" | "md";
  /** 채움 색. 기본 blue-500. */
  tone?: "blue" | "emerald" | "amber" | "red";
  className?: string;
  ariaLabel?: string;
}

const FILL: Record<NonNullable<ProgressProps["tone"]>, string> = {
  blue: "bg-blue-500",
  emerald: "bg-emerald-500",
  amber: "bg-amber-500",
  red: "bg-red-500",
};

export function Progress({
  value,
  size = "sm",
  tone = "blue",
  className,
  ariaLabel,
}: ProgressProps) {
  const clamped = Math.max(0, Math.min(100, value));
  return (
    <div
      role="progressbar"
      aria-label={ariaLabel ?? "진행률"}
      aria-valuenow={Math.round(clamped)}
      aria-valuemin={0}
      aria-valuemax={100}
      className={cn(
        "w-full bg-slate-100 rounded-full overflow-hidden",
        size === "sm" ? "h-1.5" : "h-2",
        className,
      )}
    >
      <div
        className={cn(
          "h-full rounded-full transition-all duration-500 ease-out",
          FILL[tone],
        )}
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}
