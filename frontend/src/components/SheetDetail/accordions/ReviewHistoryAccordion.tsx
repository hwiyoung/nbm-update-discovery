import { Accordion, Badge } from "@/components/Common";
import { useSheetDetailStore } from "@/stores/sheetDetailStore";
import { HISTORY_ACTION_LABEL } from "@/utils/constants";
import { formatDateTime } from "@/utils/formatters";

/**
 * 6번 아코디언 — 처리 히스토리.
 * 시간 역순. 행 클릭 시 지도 이동·강조 (history.object_id 로 selectObject).
 */
export function ReviewHistoryAccordion() {
  const history = useSheetDetailStore((s) => s.history);
  const detections = useSheetDetailStore((s) => s.detections);
  const selectAndFly = useSheetDetailStore((s) => s.selectAndFly);
  const flyToGeometry = useSheetDetailStore((s) => s.flyToGeometry);

  const sorted = [...history].sort((a, b) =>
    a.reviewed_at < b.reviewed_at ? 1 : -1,
  );

  const handleClick = (h: (typeof sorted)[number]) => {
    // detection 이 살아 있으면 선택+fly. hard-delete 됐으면 history.geometry 로
    // 위치만 이동 (선택 없음 — 우 패널 자동 열림 방지).
    const stillExists = detections.some((d) => d.id === h.object_id);
    if (stillExists) {
      selectAndFly(h.object_id);
    } else if (h.geometry) {
      flyToGeometry(h.geometry);
    }
  };

  return (
    <Accordion
      id="history"
      title="처리 히스토리"
      trailing={<Badge tone="slate">{history.length.toLocaleString("ko-KR")}</Badge>}
    >
      {sorted.length === 0 ? (
        <p className="text-[11px] text-slate-400 text-center py-3">
          처리 이력이 없습니다.
        </p>
      ) : (
        <div className="space-y-1 max-h-72 overflow-y-auto custom-scrollbar -mr-1 pr-1">
          {sorted.map((h) => (
            <button
              key={h.id}
              type="button"
              onClick={() => handleClick(h)}
              className="w-full text-left px-2 py-2 rounded-md hover:bg-slate-50 transition-colors"
            >
              <div className="flex items-center justify-between gap-2 mb-0.5">
                <span className="text-[11px] font-bold text-slate-700">
                  {HISTORY_ACTION_LABEL[h.action]}
                </span>
                <span className="text-[10px] text-slate-400">
                  {formatDateTime(h.reviewed_at)}
                </span>
              </div>
              <div className="text-[10px] text-slate-500 truncate">
                {h.object_id} · {h.reviewer}
              </div>
              {h.memo ? (
                <div className="text-[10px] text-slate-500 mt-0.5 italic truncate">
                  "{h.memo}"
                </div>
              ) : null}
            </button>
          ))}
        </div>
      )}
    </Accordion>
  );
}
