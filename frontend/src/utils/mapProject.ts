import type { Dataset } from "@/types";
import type {
  BBox,
  OrthoCurrent,
  OrthoGroup,
  OrthoImage,
  OrthoPair,
  OrthoPast,
  OrthoSummary,
} from "@/types/mapProject";
import { bboxFromPolygon } from "@/utils/geoUtils";

export const EMPTY_ORTHO_SUMMARY: OrthoSummary = {
  pastIds: [],
  currentIds: [],
  pastCount: 0,
  currentCount: 0,
  pairCount: 0,
  matchedCount: 0,
  sheetCodes: [],
  sheetCount: 0,
  areaKm2: 0,
  overlap: 0,
  region: "-",
};

export function buildOrthoGroupsFromDatasets(
  datasets: Dataset[],
  drawnBBox: BBox,
): OrthoGroup[] {
  const readyHits = datasets
    .filter((dataset) => dataset.status === "ready")
    .map((dataset) => ({ dataset, bbox: safeDatasetBBox(dataset) }))
    .filter(
      (entry): entry is { dataset: Dataset; bbox: BBox } =>
        Boolean(entry.bbox) && intersects(entry.bbox as BBox, drawnBBox),
    );

  const years = Array.from(
    new Set(
      readyHits
        .map(({ dataset }) => dataset.capture_year ?? yearFromIso(dataset.taken_start_at))
        .filter((year): year is number => Number.isFinite(year)),
    ),
  ).sort((a, b) => a - b);

  if (years.length < 2) return [];

  const currentYear = years[years.length - 1]!;
  const pasts: OrthoPast[] = [];
  const currents: OrthoCurrent[] = [];

  for (const { dataset, bbox } of readyHits) {
    const year = dataset.capture_year ?? yearFromIso(dataset.taken_start_at);
    if (year == null) continue;
    const base = datasetToOrtho(dataset, bbox, year, year === currentYear ? "current" : "past");
    if (base.era === "current") {
      currents.push({ ...base, era: "current", included: true, overlap: 0 });
    } else {
      pasts.push({ ...base, era: "past" });
    }
  }

  return pasts
    .map((past) => {
      const matched = currents
        .filter((current) => intersects(current.bbox, past.bbox))
        .map((current) => ({
          ...current,
          overlap: overlapFraction(current.bbox, past.bbox),
        }));
      if (matched.length === 0) return null;
      return recalculateGroup({ past, currents: matched, overlap: 0 });
    })
    .filter((group): group is OrthoGroup => group !== null);
}

export function summarizeOrthoGroups(groups: OrthoGroup[]): OrthoSummary {
  const activeGroups = groups.filter((group) =>
    group.currents.some((current) => current.included),
  );
  if (activeGroups.length === 0) return EMPTY_ORTHO_SUMMARY;

  const currentIds: string[] = [];
  const sheetCodes = new Set<string>();
  const regions = new Map<string, number>();
  let weightedArea = 0;
  let weightedOverlap = 0;
  let areaKm2 = 0;
  let pairCount = 0;

  for (const group of activeGroups) {
    const pastArea = degreeArea(group.past.bbox);
    const included = group.currents.filter((current) => current.included);
    areaKm2 += bboxAreaKm2(group.past.bbox);
    weightedArea += pastArea;
    weightedOverlap += pastArea * group.overlap;
    for (const region of group.past.regions) {
      regions.set(region, (regions.get(region) ?? 0) + 1);
    }
    for (const current of included) {
      currentIds.push(current.id);
      pairCount += 1;
      const common = commonSheets(group.past, current);
      for (const code of common.length > 0 ? common : group.past.sheets) {
        sheetCodes.add(code);
      }
    }
  }

  const region =
    Array.from(regions.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ??
    activeGroups[0]?.past.regions[0] ??
    "-";

  return {
    pastIds: activeGroups.map((group) => group.past.id),
    currentIds,
    pastCount: activeGroups.length,
    currentCount: currentIds.length,
    pairCount,
    matchedCount: groups.reduce((sum, group) => sum + group.currents.length + 1, 0),
    sheetCodes: Array.from(sheetCodes).sort(),
    sheetCount: sheetCodes.size,
    areaKm2,
    overlap: weightedArea > 0 ? weightedOverlap / weightedArea : 0,
    region,
  };
}

export function toggleCurrentInGroups(
  groups: OrthoGroup[],
  pastId: string,
  currentId: string,
): OrthoGroup[] {
  return groups.map((group) => {
    if (group.past.id !== pastId) return group;
    return recalculateGroup({
      ...group,
      currents: group.currents.map((current) =>
        current.id === currentId
          ? { ...current, included: !current.included }
          : current,
      ),
    });
  });
}

export function selectedOrthoPairs(groups: OrthoGroup[]): OrthoPair[] {
  return groups.flatMap((group) =>
    group.currents
      .filter((current) => current.included)
      .map((current) => ({
        past: group.past,
        current,
        commonSheets: commonSheets(group.past, current),
      })),
  );
}

export function allOrthoFeatures(groups: OrthoGroup[]): OrthoImage[] {
  const features: OrthoImage[] = [];
  for (const group of groups) {
    features.push(group.past);
    features.push(...group.currents);
  }
  return features;
}

export function safeDatasetBBox(dataset: Dataset): BBox | null {
  try {
    const bbox = bboxFromPolygon(dataset.bbox);
    if (bbox.some((value) => !Number.isFinite(value))) return null;
    if (bbox[0] >= bbox[2] || bbox[1] >= bbox[3]) return null;
    return bbox;
  } catch {
    return null;
  }
}

export function bboxIntersectsDataset(dataset: Dataset, bbox: BBox): boolean {
  const datasetBBox = safeDatasetBBox(dataset);
  return datasetBBox ? intersects(datasetBBox, bbox) : false;
}

export function intersects(a: BBox, b: BBox): boolean {
  return !(a[2] <= b[0] || a[0] >= b[2] || a[3] <= b[1] || a[1] >= b[3]);
}

export function overlapPercent(overlap: number): string {
  return `${Math.round(overlap * 100)}%`;
}

export function overlapTone(overlap: number): "good" | "warn" | "bad" {
  if (overlap >= 0.95) return "good";
  if (overlap >= 0.7) return "warn";
  return "bad";
}

function datasetToOrtho(
  dataset: Dataset,
  bbox: BBox,
  year: number,
  era: "past" | "current",
): OrthoImage {
  return {
    id: `${year}_${dataset.id}`,
    datasetId: dataset.id,
    displayName: dataset.display_name,
    year,
    era,
    platform: dataset.platform,
    gsd: "해상도 미확인",
    captured: formatDate(dataset.taken_start_at),
    bbox,
    geometry: dataset.bbox,
    sheets: dataset.sheet_codes,
    regions:
      dataset.regions.length > 0
        ? dataset.regions
        : dataset.primary_region
          ? [dataset.primary_region]
          : [],
  };
}

function recalculateGroup(group: OrthoGroup): OrthoGroup {
  const included = group.currents.filter((current) => current.included);
  const pastArea = degreeArea(group.past.bbox);
  const covered = included.reduce(
    (sum, current) => sum + intersectionArea(current.bbox, group.past.bbox),
    0,
  );
  return {
    ...group,
    overlap: pastArea > 0 ? Math.min(1, covered / pastArea) : 0,
  };
}

function commonSheets(past: OrthoPast, current: OrthoCurrent): string[] {
  const currentSheets = new Set(current.sheets);
  return past.sheets.filter((code) => currentSheets.has(code));
}

function overlapFraction(current: BBox, past: BBox): number {
  const pastArea = degreeArea(past);
  return pastArea > 0 ? Math.min(1, intersectionArea(current, past) / pastArea) : 0;
}

function degreeArea(bbox: BBox): number {
  return Math.max(0, bbox[2] - bbox[0]) * Math.max(0, bbox[3] - bbox[1]);
}

function intersectionArea(a: BBox, b: BBox): number {
  const west = Math.max(a[0], b[0]);
  const south = Math.max(a[1], b[1]);
  const east = Math.min(a[2], b[2]);
  const north = Math.min(a[3], b[3]);
  return Math.max(0, east - west) * Math.max(0, north - south);
}

function bboxAreaKm2(bbox: BBox): number {
  const midLat = (bbox[1] + bbox[3]) / 2;
  const widthKm = (bbox[2] - bbox[0]) * 111.32 * Math.cos((midLat * Math.PI) / 180);
  const heightKm = (bbox[3] - bbox[1]) * 110.57;
  return Math.max(0, widthKm * heightKm);
}

function yearFromIso(value: string | null | undefined): number | null {
  if (!value) return null;
  const year = new Date(value).getFullYear();
  return Number.isFinite(year) ? year : null;
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toISOString().slice(0, 10);
}
