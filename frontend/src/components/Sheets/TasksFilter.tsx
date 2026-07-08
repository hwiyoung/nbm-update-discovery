import { Search } from "lucide-react";
import { Input } from "@/components/Common";
import { useTasksStore } from "@/stores/tasksStore";
import { REGIONS } from "@/utils/constants";

/**
 * 프로젝트(=task) 리스트 검색 + 권역 필터.
 *
 * 검색 — task.name + description + sheet_codes 부분 매치.
 * 권역 — task 의 sheet_codes 중 하나라도 해당 권역 sheet 면 통과.
 */
export function TasksFilter() {
  const filter = useTasksStore((s) => s.filter);
  const setFilter = useTasksStore((s) => s.setFilter);

  return (
    <div className="space-y-2">
      <Input
        type="search"
        placeholder="프로젝트명·도엽코드 검색"
        value={filter.search}
        onChange={(e) => setFilter({ search: e.target.value })}
        leftIcon={<Search size={14} />}
      />
      <select
        value={filter.region ?? ""}
        onChange={(e) =>
          setFilter({ region: e.target.value || null })
        }
        aria-label="권역"
        className="w-full h-9 px-3 py-2 border border-slate-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
      >
        <option value="">전체 권역</option>
        {REGIONS.map((r) => (
          <option key={r} value={r}>
            {r}
          </option>
        ))}
      </select>
    </div>
  );
}
