/**
 * 권한 처리 단일 진실 원천 (CLAUDE.md §9.3).
 *
 * 1차 출시는 단일 사용자 운영이라 인증·권한 분기 미적용.
 * 본 파일은 인터페이스만 유지하며 항상 'reviewer' 모드를 반환한다.
 * 권한 분기 코드는 작성하되 모든 분기가 항상 통과하도록.
 *
 * 추후 백엔드 인증 도입 시 본 함수만 수정하고 호출부는 그대로 유지.
 */

export type UserRole = "reviewer" | "viewer";

export interface AuthState {
  role: UserRole;
  userName: string;
  userId: string;
}

/**
 * 현재 사용자 정보. 1차 출시: 항상 처리자.
 */
export function getCurrentAuth(): AuthState {
  return {
    role: "reviewer",
    userName: "처리자",
    userId: "reviewer-default",
  };
}

/**
 * 의미 단위 권한 함수. 모든 호출은 본 함수 경유.
 */
export const auth = {
  isReviewer(): boolean {
    return getCurrentAuth().role === "reviewer";
  },
  canClassify(): boolean {
    return true;
  },
  canEditGeometry(): boolean {
    return true;
  },
  canCreateDetection(): boolean {
    return true;
  },
  canDeleteDetection(): boolean {
    return true;
  },
  canCompleteSheetReview(): boolean {
    return true;
  },
  canCreateTask(): boolean {
    return true;
  },
  canUploadDataset(): boolean {
    return true;
  },
};
