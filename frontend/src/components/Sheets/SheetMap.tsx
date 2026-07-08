import { useEffect, useMemo, useRef } from "react";
import { GeoJSON, MapContainer, TileLayer, useMap } from "react-leaflet";
import L from "leaflet";
import type { GeoJSON as LeafletGeoJSON, PathOptions } from "leaflet";
import type { Feature, FeatureCollection, Polygon } from "geojson";
import { useSheetsStore, useFilteredSheets } from "@/stores/sheetsStore";
import { useDatasetsStore } from "@/stores/datasetsStore";
import type { Dataset, MapSheet, ReviewStatus } from "@/types";

/**
 * /sheets 의 한국 전도 지도 — React-Leaflet.
 *
 * 레이어 구성:
 *   1) 권역 디졸브 GeoJSON (8 features). 기본 배경.
 *   2) 도엽 메타 폴리곤 (sheets[].geometry). filter / hover / 선택 상태 동기화.
 *
 * 동기화:
 *   - hoveredSheetCode: row hover 시 폴리곤 강조 (얇은 ring).
 *   - selectedSheetCode + flyTick: row 클릭 시 해당 폴리곤으로 fly + 강한 강조.
 */
const KOREA_CENTER: [number, number] = [36.5, 127.8];
const KOREA_ZOOM = 7;

const STATUS_FILL: Record<ReviewStatus, string> = {
  pending: "#cbd5e1",
  in_progress: "#3b82f6",
  completed: "#10b981",
  on_hold: "#f59e0b",
};

const STATUS_STROKE: Record<ReviewStatus, string> = {
  pending: "#475569",
  in_progress: "#1d4ed8",
  completed: "#047857",
  on_hold: "#b45309",
};

/**
 * 권역별 categorical palette — ColorBrewer Set2 변형. 인접 권역끼리도 색이
 * 확실히 구분되도록 hue 를 충분히 떨어뜨림. OSM 배경 위에서 가독성 확보를 위해
 * 채도는 중간, 내부는 투명, stroke 는 진한 톤.
 */
const REGION_FILL: Record<string, string> = {
  수도권북부: "#3b82f6", // blue-500
  수도권남부: "#06b6d4", // cyan-500
  강원: "#10b981", // emerald-500
  충청: "#f59e0b", // amber-500
  전라동부: "#ec4899", // pink-500
  전라서부: "#f97316", // orange-500
  경북: "#a855f7", // purple-500
  경남: "#14b8a6", // teal-500
};
const REGION_STROKE: Record<string, string> = {
  수도권북부: "#1e40af", // blue-800
  수도권남부: "#155e75", // cyan-800
  강원: "#065f46", // emerald-800
  충청: "#92400e", // amber-800
  전라동부: "#9d174d", // pink-800
  전라서부: "#9a3412", // orange-800
  경북: "#6b21a8", // purple-800
  경남: "#115e59", // teal-800
};
const DEFAULT_REGION_FILL = "#94a3b8";
const DEFAULT_REGION_STROKE = "#475569";

function regionStyle(region: string, isActive: boolean): PathOptions {
  const fill = REGION_FILL[region] ?? DEFAULT_REGION_FILL;
  const stroke = REGION_STROKE[region] ?? DEFAULT_REGION_STROKE;
  return {
    color: stroke,
    weight: isActive ? 2.2 : 1.3,
    opacity: 1,
    fillColor: fill,
    fillOpacity: 0,
    dashArray: undefined,
  };
}

export function SheetMap() {
  const regions = useSheetsStore((s) => s.regions);
  const sheets = useSheetsStore((s) => s.sheets);
  const activeRegion = useSheetsStore((s) => s.filter.region);
  const filteredCodes = useFilteredCodesSet();
  const hoveredCode = useSheetsStore((s) => s.hoveredSheetCode);
  const setHovered = useSheetsStore((s) => s.setHoveredSheet);
  const setSelectedSheet = useSheetsStore((s) => s.setSelectedSheet);
  const selectedCode = useSheetsStore((s) => s.selectedSheetCode);
  const highlighted = useSheetsStore((s) => s.highlightedSheetCodes);

  if (!regions) {
    return (
      <div className="h-full w-full flex items-center justify-center text-sm text-slate-400">
        지도 데이터를 불러오는 중…
      </div>
    );
  }

  return (
    <MapContainer
      center={KOREA_CENTER}
      zoom={KOREA_ZOOM}
      minZoom={5}
      maxZoom={16}
      className="h-full w-full"
      preferCanvas
    >
      <TileLayer
        url="/vworld/{z}/{x}/{y}.jpg"
        attribution='&copy; <a href="https://www.vworld.kr/">VWorld</a>'
        minZoom={5}
        maxZoom={16}
      />
      <RegionsLayer data={regions} activeRegion={activeRegion} />
      <SheetsLayer
        sheets={sheets}
        filteredCodes={filteredCodes}
        hoveredCode={hoveredCode}
        selectedCode={selectedCode}
        highlightedCodes={highlighted}
        onSheetHover={setHovered}
        onSheetSelect={setSelectedSheet}
      />
      <SelectedSheetFlyController />
      <BoundsFlyController />
      <SelectedDatasetBboxLayer />
    </MapContainer>
  );
}

// ============================================================
// 데이터셋 자원 bbox 레이어 — DatasetRow 클릭 시 표시 + fly
// ============================================================
function SelectedDatasetBboxLayer() {
  const map = useMap();
  const datasets = useDatasetsStore((s) => s.datasets);
  const selectedId = useDatasetsStore((s) => s.selectedDatasetId);
  const tick = useDatasetsStore((s) => s.selectedDatasetFlyTick);

  const selected: Dataset | null = useMemo(
    () =>
      selectedId == null
        ? null
        : (datasets.find((d) => d.id === selectedId) ?? null),
    [datasets, selectedId],
  );

  const fc = useMemo<FeatureCollection<Polygon> | null>(() => {
    if (!selected) return null;
    return {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: { id: selected.id, name: selected.display_name },
          geometry: selected.bbox,
        },
      ],
    };
  }, [selected]);

  useEffect(() => {
    if (!selected || tick === 0) return;
    const ring = selected.bbox.coordinates[0] ?? [];
    if (ring.length < 2) return;
    let minLng = Infinity;
    let minLat = Infinity;
    let maxLng = -Infinity;
    let maxLat = -Infinity;
    for (const [lng, lat] of ring) {
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    }
    map.flyToBounds(
      [
        [minLat, minLng],
        [maxLat, maxLng],
      ],
      { padding: [80, 80], maxZoom: 14, duration: 0.7 },
    );
  }, [tick, selected, map]);

  if (!fc) return null;
  return (
    <GeoJSON
      key={`dataset-bbox-${selected?.id}`}
      data={fc}
      style={{
        color: "#ef4444",
        weight: 2.5,
        fillColor: "#ef4444",
        fillOpacity: 0.08,
        dashArray: "6 4",
        opacity: 1,
      }}
      onEachFeature={(_feature, layer) => {
        if (!selected) return;
        layer.bindTooltip(
          `${selected.display_name} · 도엽 ${selected.sheet_codes.length}매`,
          {
            sticky: true,
            direction: "top",
            className: "leaflet-tooltip-soft",
          },
        );
      }}
      pane="overlayPane"
    />
  );
}

// ============================================================
// 권역 디졸브 레이어
// ============================================================
function RegionsLayer({
  data,
  activeRegion,
}: {
  data: FeatureCollection;
  activeRegion: string | null;
}) {
  const map = useMap();
  const layerRef = useRef<LeafletGeoJSON | null>(null);

  useEffect(() => {
    const layer = layerRef.current;
    if (!layer) return;
    try {
      const bounds = layer.getBounds();
      if (bounds.isValid()) {
        map.fitBounds(bounds, { padding: [40, 40], maxZoom: KOREA_ZOOM + 1 });
      }
    } catch {
      /* ignore */
    }
  }, [map, data]);

  useEffect(() => {
    const layer = layerRef.current;
    if (!layer) return;
    layer.eachLayer((sub) => {
      const f = (sub as { feature?: Feature }).feature;
      const region = String(f?.properties?.region ?? "");
      (sub as unknown as { setStyle: (s: PathOptions) => void }).setStyle(
        regionStyle(region, region === activeRegion),
      );
    });
  }, [activeRegion]);

  return (
    <GeoJSON
      ref={(layer) => {
        layerRef.current = layer ?? null;
      }}
      data={data}
      style={(feature) => {
        const region = String(feature?.properties?.region ?? "");
        return regionStyle(region, region === activeRegion);
      }}
      onEachFeature={(feature, sub) => {
        const region = String(feature.properties?.region ?? "");
        const sheetCount = Number(feature.properties?.sheet_count ?? 0);
        sub.bindTooltip(
          `${region} · 도엽 ${sheetCount.toLocaleString("ko-KR")}매`,
          {
            sticky: true,
            direction: "top",
            className: "leaflet-tooltip-soft",
          },
        );
      }}
      pane="overlayPane"
    />
  );
}

// ============================================================
// 도엽 메타 폴리곤
// ============================================================
function SheetsLayer({
  sheets,
  filteredCodes,
  hoveredCode,
  selectedCode,
  highlightedCodes,
  onSheetHover,
  onSheetSelect,
}: {
  sheets: MapSheet[];
  filteredCodes: Set<string>;
  hoveredCode: string | null;
  selectedCode: string | null;
  highlightedCodes: Set<string>;
  onSheetHover: (code: string | null) => void;
  onSheetSelect: (code: string | null) => void;
}) {
  const fc = useMemo<FeatureCollection<Polygon>>(() => {
    return {
      type: "FeatureCollection",
      features: sheets.map((s) => ({
        type: "Feature",
        properties: { code: s.code, name: s.name, status: s.review_status },
        geometry: s.geometry,
      })),
    };
  }, [sheets]);

  const layerRef = useRef<LeafletGeoJSON | null>(null);
  const sheetByCode = useMemo(() => {
    const m = new Map<string, MapSheet>();
    for (const s of sheets) m.set(s.code, s);
    return m;
  }, [sheets]);

  // filter / hover / selection / highlight 변경 시 색만 갱신 (재생성 없음)
  useEffect(() => {
    const layer = layerRef.current;
    if (!layer) return;
    layer.eachLayer((sub) => {
      const f = (sub as { feature?: Feature }).feature;
      const code = String(f?.properties?.code ?? "");
      const meta = sheetByCode.get(code);
      const isFiltered = filteredCodes.has(code);
      const isHovered = hoveredCode === code;
      const isSelected = selectedCode === code;
      const isHighlighted = highlightedCodes.has(code);
      (sub as unknown as { setStyle: (s: PathOptions) => void }).setStyle(
        sheetStyle(meta, isFiltered, isHovered, isSelected, isHighlighted),
      );
      if (isSelected || isHighlighted) {
        (sub as unknown as { bringToFront: () => void }).bringToFront();
      }
    });
  }, [sheetByCode, filteredCodes, hoveredCode, selectedCode, highlightedCodes]);

  return (
    <GeoJSON
      key={`sheets-${sheets.length}`}
      ref={(layer) => {
        layerRef.current = layer ?? null;
      }}
      data={fc}
      style={(feature) => {
        const code = String(feature?.properties?.code ?? "");
        return sheetStyle(
          sheetByCode.get(code),
          filteredCodes.has(code),
          hoveredCode === code,
          selectedCode === code,
          highlightedCodes.has(code),
        );
      }}
      onEachFeature={(feature, sub) => {
        const code = String(feature.properties?.code ?? "");
        const name = String(feature.properties?.name ?? code);
        sub.bindTooltip(`${name} (${code})`, {
          sticky: true,
          direction: "top",
        });
        sub.on({
          mouseover: () => onSheetHover(code),
          mouseout: () => onSheetHover(null),
          click: (e) => {
            onSheetSelect(code);
            L.DomEvent.stopPropagation(e);
          },
        });
      }}
    />
  );
}

function sheetStyle(
  meta: MapSheet | undefined,
  isFiltered: boolean,
  isHovered: boolean,
  isSelected: boolean,
  isHighlighted: boolean,
): PathOptions {
  if (!meta) return { opacity: 0, fillOpacity: 0 };
  if (!isFiltered) {
    return {
      color: "#94a3b8",
      weight: 0.8,
      fillColor: "#cbd5e1",
      fillOpacity: 0.15,
      opacity: 0.4,
    };
  }
  if (isSelected) {
    return {
      color: STATUS_STROKE[meta.review_status],
      weight: 4,
      fillColor: STATUS_FILL[meta.review_status],
      fillOpacity: 0.6,
      opacity: 1,
      dashArray: undefined,
    };
  }
  if (isHighlighted) {
    return {
      color: "#2563eb",
      weight: 2.5,
      fillColor: "#3b82f6",
      fillOpacity: 0.45,
      opacity: 1,
    };
  }
  return {
    color: STATUS_STROKE[meta.review_status],
    weight: isHovered ? 2.5 : 1.4,
    fillColor: STATUS_FILL[meta.review_status],
    fillOpacity: isHovered ? 0.55 : 0.35,
    opacity: 1,
  };
}

// ============================================================
// 선택된 도엽으로 fly — flyTick 변경 시 발동
// ============================================================
function SelectedSheetFlyController() {
  const map = useMap();
  const selectedCode = useSheetsStore((s) => s.selectedSheetCode);
  const flyTick = useSheetsStore((s) => s.flyTick);
  const sheets = useSheetsStore((s) => s.sheets);

  useEffect(() => {
    if (!selectedCode) return;
    const sheet = sheets.find((s) => s.code === selectedCode);
    if (!sheet) return;
    const ring = sheet.geometry.coordinates[0] ?? [];
    if (ring.length < 2) return;
    let minLng = Infinity;
    let minLat = Infinity;
    let maxLng = -Infinity;
    let maxLat = -Infinity;
    for (const [lng, lat] of ring) {
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    }
    map.flyToBounds(
      [
        [minLat, minLng],
        [maxLat, maxLng],
      ],
      { padding: [80, 80], maxZoom: 13, duration: 0.7 },
    );
    // flyTick 만 dep 가 아니라 selectedCode 도 dep — 다른 도엽 선택 시도 발동
  }, [flyTick, selectedCode, sheets, map]);

  return null;
}

// ============================================================
// flyToSheets — 프로젝트 row 클릭 시 N매 도엽 union bbox 로 fly
// ============================================================
function BoundsFlyController() {
  const map = useMap();
  const flyBounds = useSheetsStore((s) => s.flyBounds);
  const tick = useSheetsStore((s) => s.flyBoundsTick);

  useEffect(() => {
    if (!flyBounds || tick === 0) return;
    const [minLng, minLat, maxLng, maxLat] = flyBounds;
    map.flyToBounds(
      [
        [minLat, minLng],
        [maxLat, maxLng],
      ],
      { padding: [60, 60], maxZoom: 13, duration: 0.7 },
    );
  }, [tick, flyBounds, map]);

  return null;
}

// ============================================================
// selectors
// ============================================================
function useFilteredCodesSet(): Set<string> {
  const filtered = useFilteredSheets();
  return useMemo(() => new Set(filtered.map((s) => s.code)), [filtered]);
}
