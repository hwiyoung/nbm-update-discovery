import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { cn } from "@/utils/cn";

/**
 * Button — DESIGN_SYSTEM §5.1 기준.
 * variant: primary (blue-600), secondary (slate), ghost (no bg), danger (red).
 * size:    sm / md / lg.
 */
export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
  fullWidth?: boolean;
}

const VARIANT: Record<ButtonVariant, string> = {
  primary:
    "bg-blue-600 hover:bg-blue-700 text-white shadow-sm active:scale-95 disabled:bg-slate-300 disabled:active:scale-100",
  secondary:
    "bg-slate-100 hover:bg-slate-200 text-slate-700 disabled:opacity-40",
  ghost:
    "bg-transparent hover:bg-slate-100 text-slate-700 disabled:opacity-40",
  danger:
    "bg-red-600 hover:bg-red-700 text-white shadow-sm disabled:bg-slate-300",
};

const SIZE: Record<ButtonSize, string> = {
  sm: "h-7 px-2.5 text-xs gap-1",
  md: "h-9 px-4 text-sm gap-2",
  lg: "h-11 px-5 text-sm gap-2",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    {
      variant = "secondary",
      size = "md",
      leftIcon,
      rightIcon,
      fullWidth,
      className,
      children,
      type = "button",
      disabled,
      ...rest
    },
    ref,
  ) {
    return (
      <button
        ref={ref}
        type={type}
        disabled={disabled}
        className={cn(
          "inline-flex items-center justify-center rounded-lg font-bold transition-colors disabled:cursor-not-allowed",
          VARIANT[variant],
          SIZE[size],
          fullWidth && "w-full",
          className,
        )}
        {...rest}
      >
        {leftIcon ? <span className="shrink-0">{leftIcon}</span> : null}
        {children}
        {rightIcon ? <span className="shrink-0">{rightIcon}</span> : null}
      </button>
    );
  },
);
