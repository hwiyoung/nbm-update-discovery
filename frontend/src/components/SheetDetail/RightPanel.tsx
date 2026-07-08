import { ChevronLeft, ChevronRight, FileText, Info, X } from "lucide-react";
import { useSheetDetailStore } from "@/stores/sheetDetailStore";
import { cn } from "@/utils/cn";
import { DetectionInfoPanel } from "./DetectionInfoPanel";
import { ReportPanel } from "./ReportPanel";

/**
 * 우 슬라이드인 패널 컨테이너 — 객체 정보 / 리포트 탭.
 *
 * 모드:
 *   - "closed": 좌측 가장자리에 핸들만 노출
 *   - "info":   객체 정보 (단건 선택 시 표시)
 *   - "report": 필터 연동 리포트
 */
const INFO_PANEL_WIDTH = 440;
const REPORT_PANEL_WIDTH = 600;

export function RightPanel() {
  const mode = useSheetDetailStore((s) => s.rightPanel);
  const open = useSheetDetailStore((s) => s.openRightPanel);
  const close = useSheetDetailStore((s) => s.closeRightPanel);

  const isOpen = mode !== "closed";
  const panelWidth = mode === "report" ? REPORT_PANEL_WIDTH : INFO_PANEL_WIDTH;

  return (
    <>
      {/* Slide-in panel */}
      <aside
        aria-hidden={!isOpen}
        className={cn(
          "absolute top-0 right-0 h-full bg-white border-l border-slate-200 shadow-md flex flex-col transition-transform duration-200 ease-out z-[400]",
          isOpen ? "translate-x-0" : "translate-x-full",
        )}
        style={{ width: panelWidth }}
      >
        <div className="h-14 shrink-0 border-b border-slate-200 bg-slate-50 px-4 flex items-center justify-between">
          {isOpen ? (
            <div className="inline-flex items-center gap-1 rounded-md bg-slate-100 p-1">
              <PanelTab
                active={mode === "info"}
                onClick={() => open("info")}
                icon={<Info size={13} />}
              >
                객체 정보
              </PanelTab>
              <PanelTab
                active={mode === "report"}
                onClick={() => open("report")}
                icon={<FileText size={13} />}
              >
                리포트
              </PanelTab>
            </div>
          ) : null}
          <button
            type="button"
            aria-label="패널 닫기"
            onClick={close}
            className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar">
          {mode === "info" ? <DetectionInfoPanel /> : null}
          {mode === "report" ? <ReportPanel /> : null}
        </div>
      </aside>

      {/* Toggle handle — 열고 닫기 단일 버튼. */}
      <div
        className="absolute top-1/2 -translate-y-1/2 z-[401] transition-[right] duration-200 ease-out"
        style={{ right: isOpen ? panelWidth : 0 }}
      >
        <PanelHandle
          aria-label={isOpen ? "패널 접기" : "패널 펼치기"}
          onClick={() => (isOpen ? close() : open("info"))}
          icon={isOpen ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
        />
      </div>
    </>
  );
}

function PanelTab({
  active,
  onClick,
  icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "h-8 px-2.5 rounded text-xs font-bold inline-flex items-center gap-1.5 transition-colors",
        active
          ? "bg-white text-blue-600 shadow-sm"
          : "text-slate-500 hover:text-slate-700 hover:bg-white/60",
      )}
    >
      {icon}
      {children}
    </button>
  );
}

function PanelHandle({
  onClick,
  icon,
  ...rest
}: {
  onClick: () => void;
  icon: React.ReactNode;
  "aria-label": string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="h-12 w-7 rounded-l-md shadow-sm border border-r-0 border-slate-200 bg-white text-slate-500 hover:bg-slate-50 hover:text-slate-700 flex items-center justify-center transition-colors"
      {...rest}
    >
      {icon}
    </button>
  );
}
