import { Search } from "lucide-react";
import { Input } from "@/components/Common";
import { useDatasetsStore } from "@/stores/datasetsStore";
import {
  DATASET_SOURCE_LABEL,
  DATASET_STATUS_LABEL,
} from "@/utils/constants";
import type { DatasetSource, DatasetStatus } from "@/types";
import { cn } from "@/utils/cn";

const SOURCES: DatasetSource[] = ["upload", "aerial", "external"];
const STATUSES: DatasetStatus[] = ["pending", "processing", "ready", "failed"];

export function DatasetFilterSidebar() {
  const filter = useDatasetsStore((s) => s.filter);
  const setFilter = useDatasetsStore((s) => s.setFilter);
  const resetFilter = useDatasetsStore((s) => s.resetFilter);

  const toggleSource = (s: DatasetSource) => {
    const next = filter.sources.includes(s)
      ? filter.sources.filter((x) => x !== s)
      : [...filter.sources, s];
    setFilter({ sources: next });
  };

  const toggleStatus = (s: DatasetStatus) => {
    const next = filter.statuses.includes(s)
      ? filter.statuses.filter((x) => x !== s)
      : [...filter.statuses, s];
    setFilter({ statuses: next });
  };

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-xs font-bold text-slate-500 mb-1.5">
          검색
        </label>
        <Input
          type="search"
          placeholder="파일명·권역·경로"
          value={filter.search}
          onChange={(e) => setFilter({ search: e.target.value })}
          leftIcon={<Search size={16} />}
        />
      </div>

      <div>
        <span className="block text-xs font-bold text-slate-500 mb-1.5">출처</span>
        <div className="flex flex-wrap gap-1.5">
          {SOURCES.map((s) => {
            const active = filter.sources.includes(s);
            return (
              <button
                key={s}
                type="button"
                aria-pressed={active}
                onClick={() => toggleSource(s)}
                className={cn(
                  "h-7 px-2.5 rounded-full text-xs font-bold border transition-colors",
                  active
                    ? "bg-blue-600 text-white border-blue-600"
                    : "bg-white text-slate-700 border-slate-200 hover:bg-slate-50",
                )}
              >
                {DATASET_SOURCE_LABEL[s]}
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <span className="block text-xs font-bold text-slate-500 mb-1.5">상태</span>
        <div className="flex flex-wrap gap-1.5">
          {STATUSES.map((s) => {
            const active = filter.statuses.includes(s);
            return (
              <button
                key={s}
                type="button"
                aria-pressed={active}
                onClick={() => toggleStatus(s)}
                className={cn(
                  "h-7 px-2.5 rounded-full text-xs font-bold border transition-colors",
                  active
                    ? "bg-blue-600 text-white border-blue-600"
                    : "bg-white text-slate-700 border-slate-200 hover:bg-slate-50",
                )}
              >
                {DATASET_STATUS_LABEL[s]}
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="block text-xs font-bold text-slate-500 mb-1.5">
            촬영 시작
          </label>
          <Input
            type="date"
            value={filter.takenFrom ?? ""}
            onChange={(e) => setFilter({ takenFrom: e.target.value || null })}
          />
        </div>
        <div>
          <label className="block text-xs font-bold text-slate-500 mb-1.5">
            촬영 종료
          </label>
          <Input
            type="date"
            value={filter.takenTo ?? ""}
            onChange={(e) => setFilter({ takenTo: e.target.value || null })}
          />
        </div>
      </div>

      <button
        type="button"
        onClick={resetFilter}
        className="w-full h-8 text-xs font-bold text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded-md transition-colors"
      >
        모든 필터 초기화
      </button>
    </div>
  );
}
