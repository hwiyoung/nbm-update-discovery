import type { Polygon } from "geojson";

export type BBox = [west: number, south: number, east: number, north: number];

export interface OrthoImage {
  id: string;
  datasetId: number;
  displayName: string;
  year: number | null;
  era: "past" | "current";
  platform: string;
  gsd: string;
  captured: string;
  bbox: BBox;
  geometry: Polygon;
  sheets: string[];
  regions: string[];
}

export interface OrthoCurrent extends OrthoImage {
  era: "current";
  included: boolean;
  overlap: number;
}

export interface OrthoPast extends OrthoImage {
  era: "past";
}

export interface OrthoGroup {
  past: OrthoPast;
  overlap: number;
  currents: OrthoCurrent[];
}

export interface OrthoSummary {
  pastIds: string[];
  currentIds: string[];
  pastCount: number;
  currentCount: number;
  pairCount: number;
  matchedCount: number;
  sheetCodes: string[];
  sheetCount: number;
  areaKm2: number;
  overlap: number;
  region: string;
}

export interface OrthoPair {
  past: OrthoPast;
  current: OrthoCurrent;
  commonSheets: string[];
}
