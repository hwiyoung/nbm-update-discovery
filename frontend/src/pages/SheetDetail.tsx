import { useEffect, useRef } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useSheetDetailStore } from "@/stores/sheetDetailStore";
import { Button, ResizableDivider } from "@/components/Common";
import { ArrowLeft } from "lucide-react";
import { SheetSidebar } from "@/components/SheetDetail/SheetSidebar";
import { DetectionMap } from "@/components/SheetDetail/DetectionMap";
import { RightPanel } from "@/components/SheetDetail/RightPanel";
import { useUIStore } from "@/stores/uiStore";

/**
 * 도엽 처리 상세 — 시스템 핵심 화면.
 *
 * 레이아웃: 좌 사이드바 (resizable, 280~640px) + 중앙 지도 + 우 슬라이드인 패널.
 * 좌 사이드바 폭은 uiStore.sheetDetailLeftW 에 영속.
 */
const LEFT_MIN = 280;
const LEFT_MAX = 640;

export default function SheetDetail() {
  const { sheetCode } = useParams();
  const navigate = useNavigate();
  const load = useSheetDetailStore((s) => s.load);
  const reset = useSheetDetailStore((s) => s.reset);
  const sheet = useSheetDetailStore((s) => s.sheet);
  const task = useSheetDetailStore((s) => s.task);
  const loading = useSheetDetailStore((s) => s.loading);
  const error = useSheetDetailStore((s) => s.error);
  const initialLeftW = useUIStore((s) => s.sheetDetailLeftW);
  const setLeftW = useUIStore((s) => s.setSheetDetailLeftW);
  const leftRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (sheetCode) void load(sheetCode);
    return () => reset();
  }, [sheetCode, load, reset]);

  if (error) {
    return (
      <div className="h-full flex items-center justify-center p-8">
        <div className="bg-white rounded-xl p-6 shadow-sm border border-red-100 max-w-md">
          <h2 className="text-base font-bold text-red-600 mb-2">로드 실패</h2>
          <p className="text-sm text-slate-700 mb-4">{error}</p>
          <Button
            variant="secondary"
            leftIcon={<ArrowLeft size={16} />}
            onClick={() => navigate("/")}
          >
            대시보드로
          </Button>
        </div>
      </div>
    );
  }

  if (loading || !sheet) {
    return (
      <div className="h-full flex items-center justify-center text-sm text-slate-400">
        도엽 데이터를 불러오는 중…
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* 헤더 — 좌 뒤로가기 + 도엽·프로젝트 정보 / 우 내보내기.
          DESIGN_SYSTEM §1.2 의 h-14 고정 골격. */}
      <header className="h-14 shrink-0 bg-white border-b border-slate-200 px-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <button
            type="button"
            onClick={() => navigate("/")}
            className="inline-flex items-center justify-center w-8 h-8 rounded-md text-slate-500 hover:text-slate-700 hover:bg-slate-100 transition-colors"
            aria-label="대시보드로"
            title="대시보드로"
          >
            <ArrowLeft size={16} />
          </button>
          <div className="min-w-0">
            <div className="text-sm font-bold text-slate-800 truncate">
              {task ? task.name : sheet.name}
            </div>
            <div className="text-[11px] text-slate-500 truncate">
              {sheet.code} · {sheet.name}
              {task ? ` · ${task.sheet_codes.length}매` : ""}
            </div>
          </div>
        </div>
      </header>

      <div className="flex-1 min-h-0 flex">
        <div ref={leftRef} style={{ width: initialLeftW }} className="shrink-0 h-full">
          <SheetSidebar />
        </div>
        <ResizableDivider
          targetRef={leftRef}
          edge="right"
          min={LEFT_MIN}
          max={LEFT_MAX}
          onCommit={setLeftW}
          ariaLabel="처리 사이드바 크기 조정"
        />
        <section className="flex-1 min-w-0 h-full bg-slate-100 relative overflow-hidden">
          <DetectionMap />
          <RightPanel />
        </section>
      </div>
    </div>
  );
}
