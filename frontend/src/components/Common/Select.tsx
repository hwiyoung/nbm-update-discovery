import { forwardRef, type SelectHTMLAttributes } from "react";
import { cn } from "@/utils/cn";

/**
 * Select — Input 동일 시각, native select.
 * 다중선택은 Radix dropdown 또는 별도 multi-select 컴포넌트로 처리(이정표 3 이후).
 */
export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  invalid?: boolean;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { invalid, className, children, ...rest },
  ref,
) {
  return (
    <select
      ref={ref}
      className={cn(
        "w-full px-3 py-2 h-9 bg-white border rounded-md text-sm text-slate-800",
        "focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500",
        "disabled:bg-slate-50 disabled:text-slate-400 disabled:cursor-not-allowed",
        invalid
          ? "border-red-500 focus:ring-red-500 focus:border-red-500"
          : "border-slate-200",
        className,
      )}
      {...rest}
    >
      {children}
    </select>
  );
});
