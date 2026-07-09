import { useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Download, FileSpreadsheet, Layers } from "lucide-react";
import toast from "react-hot-toast";
import {
  useFilteredDetections,
  useSheetDetailStore,
} from "@/stores/sheetDetailStore";
import { Badge, Button, Tabs } from "@/components/Common";
import {
  createExportSaveTarget,
  getDefaultTaskExportFilename,
  isExportSaveCanceled,
} from "@/services/exporters/saveTarget";
import type { ChangeType, DetectionObject, ObjectCategory } from "@/types";
import {
  CHANGE_TYPE_BY_CODE,
  OBJECT_CATEGORY_LABEL,
  VISIBLE_CHANGE_TYPES,
} from "@/utils/constants";
import { formatNumber, formatSquareMeters } from "@/utils/formatters";
import { ReportGrid } from "./ReportGrid";

type TypeFilter = ChangeType | "all";

const MODEL_TABS: ObjectCategory[] = ["building", "road"];

export function ReportPanel() {
  const filtered = useFilteredDetections();
  const detections = useSheetDetailStore((s) => s.detections);
  const sheet = useSheetDetailStore((s) => s.sheet);
  const task = useSheetDetailStore((s) => s.task);
  const selectAndFly = useSheetDetailStore((s) => s.selectAndFly);
  const [model, setModel] = useState<ObjectCategory>("building");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [downloadBusy, setDownloadBusy] = useState(false);

  const modelCounts = useMemo(() => {
    const counts: Record<ObjectCategory, { total: number; filtered: number }> = {
      building: { total: 0, filtered: 0 },
      road: { total: 0, filtered: 0 },
    };
    for (const det of detections) {
      if (det.is_deleted) continue;
      counts[det.model].total += 1;
    }
    for (const det of filtered) {
      counts[det.model].filtered += 1;
    }
    return counts;
  }, [detections, filtered]);

  const modelRows = useMemo(
    () =>
      filtered
        .filter((det) => det.model === model)
        .sort((a, b) => b.area_m2 - a.area_m2),
    [filtered, model],
  );

  const typeOptions = useMemo(
    () => VISIBLE_CHANGE_TYPES.filter((item) => item.model === model),
    [model],
  );

  const detailRows = useMemo(
    () =>
      typeFilter === "all"
        ? modelRows
        : modelRows.filter((det) => det.change_type === typeFilter),
    [modelRows, typeFilter],
  );

  const summary = useMemo(() => {
    const area = modelRows.reduce((sum, det) => sum + det.area_m2, 0);
    const memoCount = modelRows.filter((det) => det.reviewer_memo.trim() !== "").length;
    const total = modelCounts[model].total;
    return {
      count: modelRows.length,
      total,
      area,
      memoCount,
      filterRatio: total > 0 ? Math.round((modelRows.length / total) * 100) : 0,
    };
  }, [model, modelCounts, modelRows]);

  const typeDistribution = useMemo(
    () =>
      typeOptions
        .map((type) => {
          const rows = modelRows.filter((det) => det.change_type === type.code);
          return {
            code: type.code,
            name: type.label,
            count: rows.length,
            area: rows.reduce((sum, det) => sum + det.area_m2, 0),
            color: type.color,
          };
        })
        .filter((item) => item.count > 0),
    [modelRows, typeOptions],
  );

  const typeStats = useMemo(
    () =>
      typeOptions.map((type) => {
        const rows = modelRows.filter((det) => det.change_type === type.code);
        return {
          code: type.code,
          label: type.label,
          color: type.color,
          count: rows.length,
          area: rows.reduce((sum, det) => sum + det.area_m2, 0),
        };
      }),
    [modelRows, typeOptions],
  );

  const sheetDistribution = useMemo(() => {
    const map = new Map<string, number>();
    for (const det of modelRows) {
      const label = det.sheet_code || "미지정";
      map.set(label, (map.get(label) ?? 0) + 1);
    }
    return [...map.entries()]
      .map(([sheetCode, count]) => ({ sheetCode, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);
  }, [modelRows]);

  const taskId = task?.id ?? sheet?.task_id ?? null;

  const onDownloadPdf = async () => {
    if (!taskId || downloadBusy) return;
    setDownloadBusy(true);
    const tid = `report-pdf-${taskId}`;
    toast.loading("PDF 리포트 저장 준비 중…", { id: tid });
    try {
      const saveTarget = await createExportSaveTarget(
        task
          ? getDefaultTaskExportFilename(task, "pdf")
          : `nbm_${taskId}_report.pdf`,
        "pdf",
      );
      toast.loading("PDF 리포트 생성 중…", { id: tid });
      const mod = await import("@/services/exporters");
      await mod.exportTaskAsPdf(taskId, undefined, saveTarget);
      toast.success("PDF 리포트 저장 요청 완료", { id: tid });
    } catch (err) {
      if (isExportSaveCanceled(err)) toast.dismiss(tid);
      else {
        toast.error(err instanceof Error ? err.message : "PDF 리포트 생성 실패", {
          id: tid,
        });
      }
    } finally {
      setDownloadBusy(false);
    }
  };

  const onDownloadCsv = () => {
    downloadCsv(detailRows, `${sheet?.code ?? task?.id ?? "nbm"}_${model}_report.csv`);
  };

  return (
    <div className="h-full flex flex-col">
      <div className="shrink-0 px-4 pt-3 border-b border-slate-200 bg-white">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="min-w-0">
            <div className="text-sm font-bold text-slate-800">리포트</div>
            <div className="text-[11px] text-slate-500 truncate">
              {task?.name ?? sheet?.name ?? "분석 결과"}
            </div>
          </div>
          <Button
            size="sm"
            variant="secondary"
            leftIcon={<Download size={13} />}
            disabled={!taskId || downloadBusy}
            onClick={() => void onDownloadPdf()}
          >
            PDF
          </Button>
        </div>
        <Tabs
          value={model}
          onChange={(next) => {
            setModel(next);
            setTypeFilter("all");
          }}
          items={MODEL_TABS.map((item) => ({
            value: item,
            label: `${OBJECT_CATEGORY_LABEL[item]}변화`,
            trailing: (
              <Badge tone={model === item ? "blue" : "slate"}>
                {formatNumber(modelCounts[item].filtered)}
              </Badge>
            ),
          }))}
        />
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar p-4 space-y-4">
        <div className="grid grid-cols-4 gap-2">
          <MetricCard label="필터 결과" value={`${formatNumber(summary.count)}건`} />
          <MetricCard label="총 면적" value={formatSquareMeters(summary.area)} />
          <MetricCard label="전체 대비" value={`${summary.filterRatio}%`} />
          <MetricCard label="의견 입력" value={`${formatNumber(summary.memoCount)}건`} />
        </div>

        <section className="border border-slate-200 rounded-md bg-white p-3">
          <div className="flex items-center justify-between gap-2 mb-2">
            <div className="text-xs font-bold text-slate-700">변화 유형 분포</div>
            <div className="inline-flex items-center gap-1 text-[11px] text-slate-400">
              <Layers size={12} />
              {formatNumber(summary.total)}건 중 필터 적용
            </div>
          </div>
          <div className="grid grid-cols-[220px_minmax(0,1fr)] gap-3">
            <div className="h-[190px]">
              {typeDistribution.length === 0 ? (
                <EmptyChart />
              ) : (
                <ResponsiveContainer>
                  <PieChart>
                    <Pie
                      data={typeDistribution}
                      dataKey="count"
                      nameKey="name"
                      innerRadius={42}
                      outerRadius={68}
                      paddingAngle={2}
                    >
                      {typeDistribution.map((item) => (
                        <Cell key={item.code} fill={item.color} />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{ fontSize: 11 }}
                      formatter={(value: number, _name, props) => [
                        `${formatNumber(value)}건`,
                        props.payload?.name ?? "유형",
                      ]}
                    />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </div>
            <div className="min-w-0">
              <TypeStatsTable rows={typeStats} total={summary.count} />
            </div>
          </div>
        </section>

        <section className="border border-slate-200 rounded-md bg-white p-3">
          <div className="text-xs font-bold text-slate-700 mb-2">도엽별 분포</div>
          <div className="h-[180px]">
            {sheetDistribution.length === 0 ? (
              <EmptyChart />
            ) : (
              <ResponsiveContainer>
                <BarChart
                  data={sheetDistribution}
                  margin={{ top: 8, right: 8, left: -18, bottom: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis
                    dataKey="sheetCode"
                    tick={{ fontSize: 10, fill: "#64748b" }}
                    interval={0}
                    height={42}
                  />
                  <YAxis
                    allowDecimals={false}
                    tick={{ fontSize: 10, fill: "#94a3b8" }}
                  />
                  <Tooltip
                    contentStyle={{ fontSize: 11 }}
                    formatter={(value: number) => [`${formatNumber(value)}건`, "객체"]}
                  />
                  <Bar dataKey="count" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </section>

        <section className="space-y-2" data-pdf-exclude="true">
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="text-xs font-bold text-slate-700">상세목록</div>
              <div className="text-[11px] text-slate-400">
                행 클릭 시 해당 객체로 이동합니다.
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              <select
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value as TypeFilter)}
                className="h-7 px-2 text-xs border border-slate-200 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="all">전체 유형</option>
                {typeOptions.map((type) => (
                  <option key={type.code} value={type.code}>
                    {type.label}
                  </option>
                ))}
              </select>
              <Button
                size="sm"
                variant="secondary"
                leftIcon={<FileSpreadsheet size={13} />}
                disabled={detailRows.length === 0}
                onClick={onDownloadCsv}
              >
                CSV
              </Button>
            </div>
          </div>
          <ReportGrid rows={detailRows} onSelect={selectAndFly} />
        </section>
      </div>
    </div>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-slate-200 rounded-md bg-white p-2.5 min-w-0">
      <div className="text-[11px] font-bold text-slate-400 truncate">{label}</div>
      <div className="mt-1 text-sm font-bold text-slate-800 truncate">{value}</div>
    </div>
  );
}

function TypeStatsTable({
  rows,
  total,
}: {
  rows: {
    code: ChangeType;
    label: string;
    color: string;
    count: number;
    area: number;
  }[];
  total: number;
}) {
  return (
    <div className="border border-slate-200 rounded-md overflow-hidden">
      <table className="w-full text-xs">
        <thead className="bg-slate-50 border-b border-slate-200 text-[11px] text-slate-500">
          <tr>
            <th className="px-3 py-2 text-left font-bold">유형</th>
            <th className="px-3 py-2 text-right font-bold">건수</th>
            <th className="px-3 py-2 text-right font-bold">면적(m²)</th>
            <th className="px-3 py-2 text-right font-bold">비율</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.code} className="border-b border-slate-100 last:border-b-0">
              <td className="px-3 py-2">
                <span className="inline-flex items-center gap-1.5">
                  <span
                    className="w-2.5 h-2.5 rounded-sm"
                    style={{ backgroundColor: row.color }}
                  />
                  {row.label}
                </span>
              </td>
              <td className="px-3 py-2 text-right tabular-nums">
                {formatNumber(row.count)}
              </td>
              <td className="px-3 py-2 text-right tabular-nums">
                {formatSquareMeters(row.area)}
              </td>
              <td className="px-3 py-2 text-right tabular-nums">
                {total > 0 ? `${Math.round((row.count / total) * 100)}%` : "0%"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function EmptyChart() {
  return (
    <div className="h-full flex items-center justify-center text-xs text-slate-400">
      차트 데이터 없음
    </div>
  );
}

function downloadCsv(rows: DetectionObject[], filename: string) {
  const headers = ["ID", "도엽", "객체", "변화유형", "확신도", "면적(m²)", "주소", "의견"];
  const body = rows.map((row) => [
    row.id,
    row.sheet_code,
    OBJECT_CATEGORY_LABEL[row.model],
    CHANGE_TYPE_BY_CODE[row.change_type].label,
    String(row.confidence),
    row.area_m2.toFixed(1),
    row.address,
    row.reviewer_memo,
  ]);
  const csv = [headers, ...body]
    .map((line) => line.map(escapeCsv).join(","))
    .join("\n");
  const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

function escapeCsv(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}
