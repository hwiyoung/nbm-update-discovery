import { MousePointer, Lasso, Pencil, Edit3, X } from "lucide-react";
import { useSheetDetailStore, type EditTool } from "@/stores/sheetDetailStore";
import { Tooltip } from "@/components/Common";
import { auth } from "@/utils/auth";
import { cn } from "@/utils/cn";

/**
 * 지도 위 도구바 — 편집 모드 (상호 배타).
 *  - select: 단일 폴리곤 선택
 *  - lasso:  드래그 박스 다중선택
 *  - draw:   폴리곤 신규 생성 (FN 미탐 추가)
 *  - edit:   기존 폴리곤 vertex 편집
 */
const TOOLS: {
  code: EditTool;
  icon: React.ReactNode;
  label: string;
  guard: () => boolean;
}[] = [
  { code: "select", icon: <MousePointer size={16} />, label: "단일 선택", guard: () => true },
  { code: "lasso", icon: <Lasso size={16} />, label: "다중 선택", guard: () => true },
  { code: "draw", icon: <Pencil size={16} />, label: "폴리곤 그리기", guard: () => auth.canCreateDetection() },
  { code: "edit", icon: <Edit3 size={16} />, label: "폴리곤 편집", guard: () => auth.canEditGeometry() },
];

export function MapToolbar() {
  const tool = useSheetDetailStore((s) => s.editTool);
  const setTool = useSheetDetailStore((s) => s.setEditTool);
  const selectedCount = useSheetDetailStore((s) => s.selectedIds.length);
  const clearSelection = useSheetDetailStore((s) => s.clearSelection);

  return (
    <>
      <div
        className="absolute top-3 left-1/2 -translate-x-1/2 z-[400] bg-white rounded-md shadow-sm border border-slate-200 flex items-center p-0.5 gap-0.5"
        role="radiogroup"
        aria-label="편집 도구"
      >
        {TOOLS.filter((t) => t.guard()).map((t) => (
          <Tooltip key={t.code} content={t.label}>
            <button
              type="button"
              role="radio"
              aria-checked={tool === t.code}
              onClick={() => {
                console.log("[MapToolbar] setTool", t.code);
                setTool(t.code);
              }}
              className={cn(
                "h-8 w-8 flex items-center justify-center rounded-md transition-colors",
                tool === t.code
                  ? "bg-blue-600 text-white"
                  : "text-slate-600 hover:bg-slate-100",
              )}
            >
              {t.icon}
            </button>
          </Tooltip>
        ))}
      </div>

      {/* 모드별 안내 + 선택 카운트 */}
      {tool === "lasso" || tool === "draw" || tool === "edit" || selectedCount > 1 ? (
        <div className="absolute top-14 left-1/2 -translate-x-1/2 z-[400] flex items-center gap-2 bg-white/95 border border-slate-200 rounded-md shadow-sm px-2.5 py-1 text-[11px] text-slate-600">
          {tool === "lasso" ? (
            <span>지도에서 박스를 그리거나 폴리곤을 클릭해 다중 선택</span>
          ) : tool === "draw" ? (
            <span>지도 클릭으로 폴리곤을 그리고 더블클릭으로 완료</span>
          ) : tool === "edit" ? (
            selectedCount === 1 ? (
              <span>꼭짓점 드래그로 형태 수정 + 우측 패널에서 객체/변화 유형 변경</span>
            ) : (
              <span>폴리곤을 클릭해 선택하면 편집이 활성화됩니다</span>
            )
          ) : null}
          {selectedCount > 1 ? (
            <span className="font-bold text-blue-600">{selectedCount}건 선택</span>
          ) : null}
          {selectedCount > 0 ? (
            <button
              type="button"
              aria-label="선택 해제"
              onClick={clearSelection}
              className="ml-1 p-0.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded"
            >
              <X size={12} />
            </button>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
