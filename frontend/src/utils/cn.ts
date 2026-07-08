import clsx, { type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** 조건부 className 결합 + Tailwind 충돌 해결. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
