import { useEffect, useMemo, useState } from "react";
import { Image } from "lucide-react";
import { Accordion } from "@/components/Common";
import { getDatasetPreflightMetadata } from "@/api/client";
import { useSheetDetailStore } from "@/stores/sheetDetailStore";
import { formatYearMonth } from "@/utils/formatters";
import type {
  Dataset,
  DatasetPreflightRaster,
  DatasetPreflightResult,
} from "@/types";

/**
 * 1번 아코디언 — 분석 데이터.
 * 과년도·당해년도 파일명 + 가시성 토글 placeholder (이정표 4 백엔드 통합 후).
 */
export function AnalysisDataAccordion() {
  const sheet = useSheetDetailStore((s) => s.sheet);
  const task = useSheetDetailStore((s) => s.task);
  const standardDataset = useSheetDetailStore((s) => s.standardDataset);
  const compareDataset = useSheetDetailStore((s) => s.compareDataset);
  const progressAnalysis = useMemo(
    () => parsePreflightResult(task?.progress_detail?.analysis),
    [task?.progress_detail],
  );
  const [metadata, setMetadata] = useState<DatasetPreflightResult | null>(null);
  const [metadataError, setMetadataError] = useState<string | null>(null);
  const [metadataLoading, setMetadataLoading] = useState(false);

  useEffect(() => {
    if (
      task?.standard_resource_id == null ||
      task.compare_resource_id == null
    ) {
      return;
    }
    let cancelled = false;
    setMetadataLoading(true);
    setMetadataError(null);
    getDatasetPreflightMetadata(task.standard_resource_id, task.compare_resource_id)
      .then((result) => {
        if (!cancelled) setMetadata(result);
      })
      .catch((err) => {
        if (!cancelled) {
          setMetadataError(err instanceof Error ? err.message : String(err));
        }
      })
      .finally(() => {
        if (!cancelled) setMetadataLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [task?.standard_resource_id, task?.compare_resource_id]);

  if (!sheet) return null;

  const analysis = metadata ?? progressAnalysis;
  const overlapAnalysis = metadata ?? progressAnalysis;
  const isTaskInProgress = task?.status === "pending" || task?.status === "running";
  const isOverlapPending = isTaskInProgress && metadataLoading && !overlapAnalysis;

  return (
    <Accordion id="analysis" title="분석 데이터">
      <div className="space-y-2">
        <ResourceRow
          label="과년도"
          dataset={standardDataset}
          fallbackDatasetId={sheet.standard_resource_id}
          raster={analysis?.standard ?? null}
        />
        <ResourceRow
          label="당해년도"
          dataset={compareDataset}
          fallbackDatasetId={sheet.compare_resource_id}
          raster={analysis?.compare ?? null}
        />
      </div>
      {overlapAnalysis ? <OverlapSummary analysis={overlapAnalysis} pending={isOverlapPending} /> : null}
      {metadataLoading ? (
        <p className="mt-3 text-[11px] text-slate-500">영상 메타데이터 확인 중...</p>
      ) : null}
      {metadataError ? (
        <p className="mt-3 text-[11px] text-red-600">{metadataError}</p>
      ) : null}
    </Accordion>
  );
}

function ResourceRow({
  label,
  dataset,
  fallbackDatasetId,
  raster,
}: {
  label: string;
  dataset: Dataset | null;
  fallbackDatasetId: number | null;
  raster: DatasetPreflightRaster | null;
}) {
  const datasetId = dataset?.id ?? fallbackDatasetId;
  const displayName = dataset?.display_name ?? "영상 정보 없음";
  const taken = dataset?.taken_start_at ? formatYearMonth(dataset.taken_start_at) : "-";

  return (
    <div className="rounded-md border border-slate-100 bg-slate-50 px-3 py-2">
      <div className="flex items-center justify-between gap-2 mb-0.5">
        <div className="flex items-center gap-1.5 text-xs font-bold text-slate-700 min-w-0">
          <Image size={14} className="text-slate-400" />
          <span className="shrink-0">{label}</span>
          <span className="truncate font-medium text-slate-500">{displayName}</span>
        </div>
        <span className="text-[11px] text-slate-400 shrink-0">
          {datasetId != null ? `#${datasetId}` : "-"}
        </span>
      </div>
      <div className="text-[11px] text-slate-500">{taken}</div>
      {raster ? (
        <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] text-slate-500">
          <MetaItem label="해상도" value={formatGsd(raster.mean_gsd_m)} />
          <MetaItem label="크기" value={`${raster.width.toLocaleString("ko-KR")} x ${raster.height.toLocaleString("ko-KR")}`} />
          <MetaItem label="좌표계" value={raster.crs} wide />
          <MetaItem label="밴드" value={`${raster.band_count}개`} />
          <MetaItem label="면적" value={formatArea(raster.footprint_area_m2)} />
        </div>
      ) : null}
    </div>
  );
}

function MetaItem({
  label,
  value,
  wide = false,
}: {
  label: string;
  value: string;
  wide?: boolean;
}) {
  return (
    <div className={wide ? "col-span-2 min-w-0" : "min-w-0"}>
      <span className="text-slate-400">{label}</span>
      <span className="ml-1 font-medium text-slate-700 break-words">{value}</span>
    </div>
  );
}

function OverlapSummary({
  analysis,
  pending,
}: {
  analysis: DatasetPreflightResult;
  pending: boolean;
}) {
  const pendingText = "계산중...";
  return (
    <div className="mt-3 rounded-md border border-slate-100 bg-white px-3 py-2 text-[11px] text-slate-500">
      <div className="flex items-center justify-between gap-2">
        <span>중첩률</span>
        <span className="font-bold text-slate-800">
          {pending ? pendingText : formatRatio(analysis.overlap_ratio)}
        </span>
      </div>
      <div className="mt-1 flex items-center justify-between gap-2">
        <span>교차 면적</span>
        <span className="font-medium text-slate-700">
          {pending ? pendingText : formatArea(analysis.intersection_area_m2)}
        </span>
      </div>
    </div>
  );
}

function parsePreflightResult(value: unknown): DatasetPreflightResult | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<DatasetPreflightResult>;
  if (
    !candidate.standard ||
    !candidate.compare ||
    typeof candidate.target_gsd_m !== "number" ||
    typeof candidate.intersection_area_m2 !== "number"
  ) {
    return null;
  }
  return {
    ...candidate,
    overlap_ratio: typeof candidate.overlap_ratio === "number" ? candidate.overlap_ratio : 0,
    overlap_method: typeof candidate.overlap_method === "string"
      ? candidate.overlap_method
      : "unknown",
    intersection_bounds_5186: candidate.intersection_bounds_5186 ?? null,
    can_proceed: Boolean(candidate.can_proceed),
    warnings: Array.isArray(candidate.warnings) ? candidate.warnings : [],
  } as DatasetPreflightResult;
}

function formatGsd(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "-";
  return `${value.toFixed(2)} m`;
}

function formatRatio(value: number): string {
  if (!Number.isFinite(value) || value < 0) return "-";
  return `${(value * 100).toFixed(1)}%`;
}

function formatArea(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "-";
  return `${(value / 1_000_000).toFixed(2)} km²`;
}
