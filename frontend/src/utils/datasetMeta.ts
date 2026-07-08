import type { Dataset } from "@/types";

export function getDatasetRegionLabel(dataset: Dataset): string {
  if (!dataset.primary_region) return "권역 미확인";
  const extraCount = Math.max(0, dataset.regions.length - 1);
  return extraCount > 0
    ? `${dataset.primary_region} 외 ${extraCount}`
    : dataset.primary_region;
}

export function getDatasetRegionsTitle(dataset: Dataset): string | undefined {
  return dataset.regions.length > 0 ? dataset.regions.join(", ") : undefined;
}

export function getDatasetCaptureYear(dataset: Dataset): number | null {
  if (dataset.capture_year) return dataset.capture_year;
  const year = new Date(dataset.taken_start_at).getFullYear();
  return Number.isFinite(year) ? year : null;
}

export function getDatasetCaptureYearLabel(dataset: Dataset): string {
  const year = getDatasetCaptureYear(dataset);
  return year ? `${year}년` : "촬영연도 미입력";
}

export function formatDatasetFileSize(bytes: number | null): string {
  if (!bytes || bytes <= 0) return "-";
  const gb = bytes / 1024 / 1024 / 1024;
  if (gb >= 1) return `${gb.toFixed(gb >= 10 ? 1 : 2)} GB`;
  const mb = bytes / 1024 / 1024;
  return `${mb.toFixed(mb >= 10 ? 0 : 1)} MB`;
}
