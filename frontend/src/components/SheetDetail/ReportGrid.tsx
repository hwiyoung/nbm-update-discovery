import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, MapPin } from "lucide-react";
import type { DetectionObject } from "@/types";
import { CHANGE_TYPE_BY_CODE } from "@/utils/constants";
import { formatNumber, formatPercent, formatSquareMeters } from "@/utils/formatters";
import { cn } from "@/utils/cn";

interface ReportGridProps {
  rows: DetectionObject[];
  onSelect: (id: string) => void;
  pageSize?: number;
}

export function ReportGrid({ rows, onSelect, pageSize = 10 }: ReportGridProps) {
  const [page, setPage] = useState(0);
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));

  useEffect(() => {
    setPage(0);
  }, [rows]);

  const visibleRows = useMemo(() => {
    const start = page * pageSize;
    return rows.slice(start, start + pageSize);
  }, [page, pageSize, rows]);

  if (rows.length === 0) {
    return (
      <div className="h-40 flex items-center justify-center border border-dashed border-slate-200 rounded-md text-xs text-slate-400">
        표시할 객체가 없습니다.
      </div>
    );
  }

  return (
    <div className="border border-slate-200 rounded-md overflow-hidden bg-white">
      <div className="overflow-x-auto custom-scrollbar">
        <table className="w-full min-w-[460px] text-xs">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr className="text-[11px] text-slate-500">
              <Th className="w-[46%]">위치</Th>
              <Th className="w-[20%]">유형</Th>
              <Th className="w-[18%] text-right">면적(m²)</Th>
              <Th className="w-[16%] text-right">확신도</Th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((row) => {
              const change = CHANGE_TYPE_BY_CODE[row.change_type];
              const location = locationLabel(row);
              return (
                <tr
                  key={row.id}
                  className="border-b border-slate-100 last:border-b-0 hover:bg-blue-50/50 transition-colors"
                >
                  <Td>
                    <button
                      type="button"
                      onClick={() => onSelect(row.id)}
                      className="w-full text-left inline-flex items-center gap-1.5 text-blue-600 hover:text-blue-700"
                      title={location}
                    >
                      <MapPin size={12} className="shrink-0" />
                      <span className="truncate">{location}</span>
                    </button>
                  </Td>
                  <Td>
                    <span className="inline-flex items-center gap-1.5">
                      <span
                        className="w-2.5 h-2.5 rounded-sm"
                        style={{ backgroundColor: change.color }}
                      />
                      {change.label}
                    </span>
                  </Td>
                  <Td className="text-right tabular-nums">
                    {formatSquareMeters(row.area_m2)}
                  </Td>
                  <Td className="text-right tabular-nums">
                    {formatPercent(row.confidence)}
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="h-9 px-2.5 flex items-center justify-between bg-slate-50 border-t border-slate-100">
        <div className="text-[11px] text-slate-500">
          총 <span className="font-bold text-slate-700">{formatNumber(rows.length)}</span>건
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            aria-label="이전 페이지"
            disabled={page === 0}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            className="w-7 h-7 inline-flex items-center justify-center rounded text-slate-500 hover:bg-white disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <ChevronLeft size={14} />
          </button>
          <span className="text-[11px] text-slate-500 tabular-nums min-w-[48px] text-center">
            {page + 1} / {totalPages}
          </span>
          <button
            type="button"
            aria-label="다음 페이지"
            disabled={page >= totalPages - 1}
            onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
            className="w-7 h-7 inline-flex items-center justify-center rounded text-slate-500 hover:bg-white disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <ChevronRight size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}

function Th({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <th className={cn("px-3 py-2 font-bold text-left", className)}>
      {children}
    </th>
  );
}

function Td({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <td className={cn("px-3 py-2 align-middle", className)}>{children}</td>;
}

function locationLabel(row: DetectionObject): string {
  const address = row.address.trim();
  if (address) return address;
  if (row.region_code) return `행정코드 ${row.region_code}`;
  if (row.sheet_code) return row.sheet_code;
  return "-";
}
