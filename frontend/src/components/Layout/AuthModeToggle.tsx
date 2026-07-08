import { auth } from "@/utils/auth";

/**
 * AuthModeToggle — 1차 출시는 단일 사용자라 비노출.
 * `auth.ts` 호출만 보존해 인터페이스 일관성을 유지 (CLAUDE.md §9.3).
 */
export function AuthModeToggle() {
  void auth.isReviewer();
  return null;
}
