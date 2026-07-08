import { Link } from "react-router-dom";
import { NotificationsBell } from "./NotificationsBell";

/**
 * 전역 헤더 — 높이 h-14.
 * 좌: 로고
 * 우: 알림 벨 (백그라운드 업로드·추론 진행 표시)
 *
 * 메인 화면 통합 후 전역 사이드바·nav 항목 모두 제거. 단일 진입점.
 */
export function Header() {
  return (
    <header className="h-14 bg-white border-b border-slate-200 flex items-center justify-between px-4 z-[3000] shadow-sm shrink-0">
      <div className="flex items-center gap-2">
        <Link
          to="/"
          className="flex items-center gap-2 subpixel-antialiased hover:opacity-80 transition-opacity"
          style={{
            fontFamily:
              "-apple-system, BlinkMacSystemFont, system-ui, Roboto, sans-serif",
          }}
          aria-label="메인으로 이동"
        >
          <img
            src="/siqms_mark.png"
            alt=""
            className="w-[64px] h-[64px] object-contain"
          />
          <h1 className="font-bold text-lg text-slate-800 tracking-tight">
            공간정보품질관리원 <span className="font-normal text-slate-500">| AI 기반 품질검증 지원 시스템 - 국가기본도 수시갱신 대상지역 추출</span>
          </h1>
        </Link>
      </div>

      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2 pl-4 border-l border-slate-200">
          <NotificationsBell />
        </div>
      </div>
    </header>
  );
}
