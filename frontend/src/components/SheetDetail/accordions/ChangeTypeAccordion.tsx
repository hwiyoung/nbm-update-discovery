import { Accordion, Badge } from "@/components/Common";
import {
  useChangeTypeCounts,
  useSheetDetailStore,
} from "@/stores/sheetDetailStore";
import {
  OBJECT_CATEGORY_LABEL,
  VISIBLE_CHANGE_TYPES,
} from "@/utils/constants";
import type { ChangeType, ObjectCategory } from "@/types";
import { cn } from "@/utils/cn";

/**
 * 3·4번 아코디언 — 건물 변화 / 도로 변화.
 *
 * - 마스터 체크 (해당 카테고리 모든 변화 유형 토글)
 * - 변화 유형별 체크 + 카운트 (필터 적용 / 전체)
 * - 클릭 시 sheetDetailStore.filter.changeTypes 갱신
 */
export interface ChangeTypeAccordionProps {
  category: ObjectCategory;
}

export function ChangeTypeAccordion({ category }: ChangeTypeAccordionProps) {
  const types = VISIBLE_CHANGE_TYPES.filter((t) => t.model === category);
  const filterCodes = useSheetDetailStore((s) => s.filter.changeTypes);
  const setFilter = useSheetDetailStore((s) => s.setFilter);
  const counts = useChangeTypeCounts();

  const codes = types.map((t) => t.code);

  // 카테고리에 속한 코드들 중 활성 상태인 것.
  const allActive = codes.every((c) => filterCodes.includes(c));
  const someActive = codes.some((c) => filterCodes.includes(c));

  const total = types.reduce((sum, t) => sum + counts[t.code].total, 0);
  const filtered = types.reduce((sum, t) => sum + counts[t.code].filtered, 0);

  const toggleType = (code: ChangeType) => {
    const allCodes = VISIBLE_CHANGE_TYPES.map((t) => t.code);
    const current = new Set(filterCodes);
    if (current.has(code)) current.delete(code);
    else current.add(code);
    setFilter({ changeTypes: allCodes.filter((c) => current.has(c)) });
  };

  const toggleCategoryMaster = () => {
    const allCodes = VISIBLE_CHANGE_TYPES.map((t) => t.code);
    const current = new Set(filterCodes);
    if (allActive) {
      for (const c of codes) current.delete(c);
    } else {
      for (const c of codes) current.add(c);
    }
    setFilter({ changeTypes: allCodes.filter((c) => current.has(c)) });
  };

  return (
    <Accordion
      id={`changetype-${category}`}
      title={
        <span className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={allActive}
            ref={(el) => {
              if (el) el.indeterminate = !allActive && someActive;
            }}
            onChange={toggleCategoryMaster}
            onClick={(e) => e.stopPropagation()}
            className="w-3.5 h-3.5 rounded text-blue-600 focus:ring-blue-500"
            aria-label={`${OBJECT_CATEGORY_LABEL[category]} 변화 전체 토글`}
          />
          {OBJECT_CATEGORY_LABEL[category]} 변화
        </span>
      }
      trailing={
        <Badge tone="slate">
          {filtered.toLocaleString("ko-KR")} / {total.toLocaleString("ko-KR")}
        </Badge>
      }
    >
      <div className="space-y-1">
        {types.map((t) => {
          const isActive = filterCodes.includes(t.code);
          const c = counts[t.code];
          return (
            <button
              key={t.code}
              type="button"
              onClick={() => toggleType(t.code)}
              className={cn(
                "w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-left transition-colors",
                isActive ? "hover:bg-slate-50" : "opacity-50 hover:bg-slate-50",
              )}
            >
              <span
                className="inline-block w-3 h-3 rounded-sm shrink-0 border border-white shadow-sm"
                style={{ backgroundColor: t.color }}
              />
              <input
                type="checkbox"
                checked={isActive}
                onChange={() => {}}
                onClick={(e) => e.stopPropagation()}
                className="w-3.5 h-3.5 rounded text-blue-600 focus:ring-blue-500 pointer-events-none"
                aria-hidden="true"
                tabIndex={-1}
              />
              <span className="flex-1 text-xs font-bold text-slate-700">
                {t.label}
              </span>
              <span className="text-[11px] text-slate-500 tabular-nums">
                {c.filtered.toLocaleString("ko-KR")}
                <span className="text-slate-300"> / {c.total.toLocaleString("ko-KR")}</span>
              </span>
            </button>
          );
        })}
      </div>
    </Accordion>
  );
}
