import type { ReactNode } from "react";
import { Toaster } from "react-hot-toast";
import { Header } from "./Header";
import { AuthModeToggle } from "./AuthModeToggle";

/**
 * AppShell — 모든 라우트의 공통 래퍼.
 * Header + main.
 *
 * 메인 화면 통합 후 전역 사이드바 제거 — 각 페이지가 자체 좌 사이드바를 갖는다
 * (대시보드: 도엽 카드 리스트 / 처리 상세: 6 아코디언). 이중 사이드바 회피.
 */
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col h-screen w-full bg-slate-50 overflow-hidden">
      <Header />
      <main className="flex-1 min-w-0 min-h-0 overflow-hidden">
        {children}
      </main>
      <AuthModeToggle />
      <Toaster
        position="bottom-right"
        toastOptions={{
          style: { fontSize: 13, fontWeight: 600 },
          duration: 3000,
        }}
      />
    </div>
  );
}
