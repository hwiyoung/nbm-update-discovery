import { Layout, MoveHorizontal, MoveVertical } from "lucide-react";
import { useSheetDetailStore, type ViewerMode } from "@/stores/sheetDetailStore";
import { Tooltip } from "@/components/Common";
import { cn } from "@/utils/cn";

/**
 * 좌상단 뷰어 모드 버튼 — 과년도/당해년도 비교용 3 모드.
 *  - split:  좌우 분할
 *  - swipe-x: 가로 스와이프
 *  - swipe-y: 세로 스와이프
 */
const MODES: { code: ViewerMode; icon: React.ReactNode; label: string }[] = [
  { code: "split", icon: <Layout size={16} />, label: "2분할" },
  { code: "swipe-x", icon: <MoveHorizontal size={16} />, label: "X 스와이프" },
  { code: "swipe-y", icon: <MoveVertical size={16} />, label: "Y 스와이프" },
];

export function ViewerModeToolbar() {
  const mode = useSheetDetailStore((s) => s.viewerMode);
  const setMode = useSheetDetailStore((s) => s.setViewerMode);

  return (
    <div
      className="absolute top-3 left-3 z-[400] bg-white rounded-md shadow-sm border border-slate-200 flex items-center p-0.5 gap-0.5"
      role="radiogroup"
      aria-label="지도 뷰어 모드"
    >
      {MODES.map((m) => (
        <Tooltip key={m.code} content={m.label}>
          <button
            type="button"
            role="radio"
            aria-checked={mode === m.code}
            onClick={() => setMode(m.code)}
            className={cn(
              "h-8 w-8 flex items-center justify-center rounded-md transition-colors",
              mode === m.code
                ? "bg-blue-600 text-white"
                : "text-slate-600 hover:bg-slate-100",
            )}
          >
            {m.icon}
          </button>
        </Tooltip>
      ))}
    </div>
  );
}
