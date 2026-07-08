import { forwardRef, type HTMLAttributes } from "react";
import { cn } from "@/utils/cn";

/**
 * Card — DESIGN_SYSTEM §5.2 단일 공식.
 * bg-white rounded-xl p-5 shadow-sm border border-slate-100 hover:shadow-md transition-shadow
 *
 * 본 컴포넌트는 도메인 무지. 도엽·데이터셋 카드 등은 본 Card 를 감싸 사용.
 */
export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** padding p-5 → p-4 (compact) → p-6 (large). 기본 5. */
  padding?: 4 | 5 | 6;
  /** clickable 처리 (cursor + outline-none for keyboard nav). */
  clickable?: boolean;
}

const PADDING_MAP: Record<NonNullable<CardProps["padding"]>, string> = {
  4: "p-4",
  5: "p-5",
  6: "p-6",
};

export const Card = forwardRef<HTMLDivElement, CardProps>(function Card(
  { padding = 5, clickable, className, children, ...rest },
  ref,
) {
  return (
    <div
      ref={ref}
      className={cn(
        "bg-white rounded-xl shadow-sm border border-slate-100 transition-shadow",
        PADDING_MAP[padding],
        clickable
          ? "cursor-pointer hover:shadow-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          : "hover:shadow-md",
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
});
