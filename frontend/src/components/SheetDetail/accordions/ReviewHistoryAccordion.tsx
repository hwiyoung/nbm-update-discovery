import { Accordion, Badge } from "@/components/Common";
import { useSheetDetailStore } from "@/stores/sheetDetailStore";
import {
  CHANGE_TYPE_BY_CODE,
  OBJECT_CATEGORY_LABEL,
} from "@/utils/constants";
import type { HistoryAction } from "@/types";
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
          {sorted.map((h) => {
            const opinion = historyOpinion(h);
            return (
              <button
                key={h.id}
                type="button"
                onClick={() => handleClick(h)}
                className="grid w-full grid-cols-[34px_38px_42px_82px_minmax(44px,1fr)_auto] items-center rounded-md px-2 py-2.5 text-left text-[11px] transition-colors hover:bg-slate-50"
                title={`${simpleActionLabel(h.action)} | ${OBJECT_CATEGORY_LABEL[h.model]} | ${CHANGE_TYPE_BY_CODE[h.change_type].label} | ${h.object_id} | ${opinion} | ${formatDateTime(h.reviewed_at)}`}
              >
                <span className="font-bold text-slate-700">
                  {simpleActionLabel(h.action)}
                </span>
                <span className="border-l border-slate-200 pl-1.5 text-slate-600">
                  {OBJECT_CATEGORY_LABEL[h.model]}
                </span>
                <span className="truncate border-l border-slate-200 pl-1.5 text-slate-600">
                  {CHANGE_TYPE_BY_CODE[h.change_type].label}
                </span>
                <span className="truncate border-l border-slate-200 pl-1.5 font-mono text-blue-700" title={h.object_id}>
                  {h.object_id}
                </span>
                <span className="truncate border-l border-slate-200 pl-1.5 text-slate-600" title={opinion}>
                  {opinion}
                </span>
                <span className="whitespace-nowrap border-l border-slate-200 pl-1.5 text-slate-400 tabular-nums">
                  {compactDateTime(h.reviewed_at)}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </Accordion>
  );
}

function simpleActionLabel(action: HistoryAction): "생성" | "삭제" | "수정" | "의견" {
  if (action === "create") return "생성";
  if (action === "delete") return "삭제";
  if (action === "edit_meta") return "의견";
  return "수정";
}

function historyOpinion(history: ReturnType<typeof useSheetDetailStore.getState>["history"][number]): string {
  for (const snapshot of [history.after, history.before]) {
    if (!snapshot || !("reviewer_memo" in snapshot)) continue;
    const memo = typeof snapshot.reviewer_memo === "string"
      ? snapshot.reviewer_memo.trim()
      : "";
    return memo || "의견 없음";
  }
  const memo = history.memo?.trim();
  return memo || "-";
}

function compactDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  const parts = new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? "";
  return `${part("month")}.${part("day")} ${part("hour")}:${part("minute")}`;
}
