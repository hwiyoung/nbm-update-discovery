import { forwardRef, type InputHTMLAttributes, type ReactNode } from "react";
import { cn } from "@/utils/cn";

/**
 * Input — DESIGN_SYSTEM §5.3.
 * rounded-md, focus:ring-2 focus:ring-blue-500.
 */
export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
  invalid?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { leftIcon, rightIcon, invalid, className, ...rest },
  ref,
) {
  if (leftIcon || rightIcon) {
    return (
      <div className="relative w-full">
        {leftIcon ? (
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
            {leftIcon}
          </span>
        ) : null}
        <input
          ref={ref}
          className={cn(
            "w-full bg-white border rounded-md text-sm text-slate-800 placeholder:text-slate-400",
            "focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500",
            "disabled:bg-slate-50 disabled:text-slate-400 disabled:cursor-not-allowed",
            invalid
              ? "border-red-500 focus:ring-red-500 focus:border-red-500"
              : "border-slate-200",
            leftIcon ? "pl-9" : "pl-3",
            rightIcon ? "pr-9" : "pr-3",
            "py-2 h-9",
            className,
          )}
          {...rest}
        />
        {rightIcon ? (
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400">
            {rightIcon}
          </span>
        ) : null}
      </div>
    );
  }
  return (
    <input
      ref={ref}
      className={cn(
        "w-full px-3 py-2 h-9 bg-white border rounded-md text-sm text-slate-800 placeholder:text-slate-400",
        "focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500",
        "disabled:bg-slate-50 disabled:text-slate-400 disabled:cursor-not-allowed",
        invalid
          ? "border-red-500 focus:ring-red-500 focus:border-red-500"
          : "border-slate-200",
        className,
      )}
      {...rest}
    />
  );
});
