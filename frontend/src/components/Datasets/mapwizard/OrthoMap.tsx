import { useEffect, useMemo, useRef } from "react";
import {
  GeoJSON,
  MapContainer,
  Rectangle,
  TileLayer,
  ZoomControl,
  useMap,
} from "react-leaflet";
import type {
  GeoJSON as LeafletGeoJSON,
  LatLngBoundsExpression,
  PathOptions,
} from "leaflet";
import L from "leaflet";
import type { Feature, FeatureCollection, Polygon } from "geojson";
import type { Dataset } from "@/types";
import type { BBox, OrthoGroup } from "@/types/mapProject";
import type { WizardStep } from "@/stores/datasetsStore";
import { bboxToLeafletBounds } from "@/utils/geoUtils";
import {
  allOrthoFeatures,
  safeDatasetBBox,
  summarizeOrthoGroups,
} from "@/utils/mapProject";
import { cn } from "@/utils/cn";

const KOREA_CENTER: [number, number] = [36.35, 127.8];
const GUIDE_COLORS = [
  "#0f766e",
  "#7c3aed",
  "#be123c",
  "#0369a1",
  "#15803d",
  "#a16207",
  "#4338ca",
  "#c2410c",
];

export interface OrthoMapProps {
  step: WizardStep;
  datasets: Dataset[];
  regionData: FeatureCollection | null;
  drawnBBox: BBox | null;
  groups: OrthoGroup[];
  hoveredId: string | null;
  onDrawn: (bbox: BBox) => void;
  onClear: () => void;
  onHover: (id: string | null) => void;
  onTogglePast: (pastId: string) => void;
  onToggleCurrent: (currentId: string) => void;
}

export function OrthoMap({
  step,
  datasets,
  regionData,
  drawnBBox,
  groups,
  hoveredId,
  onDrawn,
  onClear,
  onHover,
  onTogglePast,
  onToggleCurrent,
}: OrthoMapProps) {
  const summary = useMemo(() => summarizeOrthoGroups(groups), [groups]);
  const guideFeatures = useMemo(() => buildGuideFeatures(datasets), [datasets]);
  const guideRegions = useMemo(() => buildGuideRegionStats(datasets), [datasets]);

  return (
    <div className="relative h-full w-full bg-slate-100">
      <MapContainer
        center={KOREA_CENTER}
        zoom={7}
        minZoom={5}
        maxZoom={18}
        zoomControl={false}
        className="h-full w-full"
        preferCanvas
      >
        <TileLayer
          url="/vworld/{z}/{x}/{y}.jpg"
          attribution='&copy; <a href="https://www.vworld.kr/">VWorld</a>'
          minZoom={5}
          maxZoom={21}
          maxNativeZoom={16}
          keepBuffer={2}
          updateWhenZooming={false}
          updateWhenIdle={true}
        />
        <ZoomControl position="bottomright" />
        <MapResizeController tick={`${step}-${groups.length}-${Boolean(drawnBBox)}`} />
        <MapFitController
          drawnBBox={drawnBBox}
          groups={groups}
          guideFeatures={guideFeatures}
        />
        <RectangleDrawController
          active={step === "draw"}
          drawnBBox={drawnBBox}
          onDrawn={onDrawn}
          onClear={onClear}
        />
        {step === "draw" && regionData ? (
          <RegionPolygonsLayer data={regionData} selectedRegion={summary.region} />
        ) : null}
        {step === "draw" && guideFeatures.features.length > 0 ? (
          <GuideLayer data={guideFeatures} />
        ) : null}
        {drawnBBox ? (
          <Rectangle
            bounds={bboxToLeafletBounds(drawnBBox)}
            pathOptions={{
              color: "#2563eb",
              weight: 2,
              opacity: 1,
              dashArray: "6 4",
              fillColor: "#3b82f6",
              fillOpacity: 0.12,
            }}
          />
        ) : null}
        {groups.length > 0 ? (
          <FootprintsLayer
            groups={groups}
            hoveredId={hoveredId}
            selectable={step !== "draw"}
            onHover={onHover}
            onTogglePast={onTogglePast}
            onToggleCurrent={onToggleCurrent}
          />
        ) : null}
      </MapContainer>

      <div className="absolute left-1/2 top-3 z-[500] -translate-x-1/2 pointer-events-none">
        <div className="rounded-full border border-white/70 bg-white/95 px-3 py-1.5 text-xs font-black text-slate-700 shadow-sm">
          {step === "draw"
            ? drawnBBox
              ? `좌클릭 드래그로 영역 교체 · 휠 버튼 드래그로 이동 · 정사영상 ${summary.matchedCount.toLocaleString("ko-KR")}장`
              : "좌클릭 드래그로 영역 지정 · 휠 버튼 드래그로 이동"
            : `정사영상 ${summary.matchedCount.toLocaleString("ko-KR")}장 조회`}
        </div>
      </div>

      <RegionOverlay
        step={step}
        selectedRegion={summary.region}
        selectedCount={summary.matchedCount}
        guideRegions={guideRegions}
      />
      <MapLegend step={step} hasGroups={groups.length > 0} />
    </div>
  );
}

function RectangleDrawController({
  active,
  drawnBBox,
  onDrawn,
  onClear,
}: {
  active: boolean;
  drawnBBox: BBox | null;
  onDrawn: (bbox: BBox) => void;
  onClear: () => void;
}) {
  const map = useMap();
  const previewRef = useRef<L.Rectangle | null>(null);

  useEffect(() => {
    if (!active) return undefined;
    const container = map.getContainer();
    const previousCursor = container.style.cursor;
    const wasDraggingEnabled = map.dragging.enabled();
    const wasDoubleClickZoomEnabled = map.doubleClickZoom.enabled();
    let start: L.LatLng | null = null;
    let middlePan: { last: L.Point } | null = null;

    container.style.cursor = "crosshair";
    map.dragging.disable();
    map.doubleClickZoom.disable();

    const clearPreview = () => {
      previewRef.current?.removeFrom(map);
      previewRef.current = null;
    };

    const onMouseDown = (event: L.LeafletMouseEvent) => {
      if (event.originalEvent.button === 1) {
        middlePan = { last: map.latLngToContainerPoint(event.latlng) };
        container.style.cursor = "grabbing";
        L.DomEvent.preventDefault(event.originalEvent);
        L.DomEvent.stop(event.originalEvent);
        return;
      }
      if (event.originalEvent.button !== 0) return;
      start = event.latlng;
      clearPreview();
      previewRef.current = L.rectangle(L.latLngBounds(start, start), {
        color: "#2563eb",
        weight: 2.5,
        opacity: 1,
        dashArray: "6 4",
        fillColor: "#3b82f6",
        fillOpacity: 0.18,
      }).addTo(map);
      L.DomEvent.stop(event.originalEvent);
    };

    const onMouseMove = (event: L.LeafletMouseEvent) => {
      if (middlePan) {
        const current = map.latLngToContainerPoint(event.latlng);
        map.panBy(middlePan.last.subtract(current), { animate: false });
        middlePan = { last: current };
        L.DomEvent.preventDefault(event.originalEvent);
        return;
      }
      if (!start || !previewRef.current) return;
      previewRef.current.setBounds(L.latLngBounds(start, event.latlng));
    };

    const onMouseUp = (event: L.LeafletMouseEvent) => {
      if (middlePan) {
        middlePan = null;
        container.style.cursor = "crosshair";
        L.DomEvent.preventDefault(event.originalEvent);
        L.DomEvent.stop(event.originalEvent);
        return;
      }
      if (!start) return;
      const bounds = L.latLngBounds(start, event.latlng);
      start = null;
      clearPreview();
      const west = bounds.getWest();
      const south = bounds.getSouth();
      const east = bounds.getEast();
      const north = bounds.getNorth();
      if (Math.abs(east - west) < 0.00002 || Math.abs(north - south) < 0.00002) {
        if (drawnBBox && !bboxContainsLatLng(drawnBBox, event.latlng)) {
          onClear();
        }
        return;
      }
      onDrawn([
        west,
        south,
        east,
        north,
      ]);
      L.DomEvent.stop(event.originalEvent);
    };

    const onAuxClick = (event: MouseEvent) => {
      if (event.button !== 1) return;
      event.preventDefault();
    };

    map.on("mousedown", onMouseDown);
    map.on("mousemove", onMouseMove);
    map.on("mouseup", onMouseUp);
    container.addEventListener("auxclick", onAuxClick);
    return () => {
      clearPreview();
      container.style.cursor = previousCursor;
      if (wasDraggingEnabled) map.dragging.enable();
      if (wasDoubleClickZoomEnabled) map.doubleClickZoom.enable();
      map.off("mousedown", onMouseDown);
      map.off("mousemove", onMouseMove);
      map.off("mouseup", onMouseUp);
      container.removeEventListener("auxclick", onAuxClick);
    };
  }, [active, drawnBBox, map, onClear, onDrawn]);

  return null;
}

function MapResizeController({ tick }: { tick: string }) {
  const map = useMap();

  useEffect(() => {
    window.setTimeout(() => map.invalidateSize(), 80);
  }, [map, tick]);

  return null;
}

function MapFitController({
  drawnBBox,
  groups,
  guideFeatures,
}: {
  drawnBBox: BBox | null;
  groups: OrthoGroup[];
  guideFeatures: FeatureCollection<Polygon>;
}) {
  const map = useMap();
  const didInitialFit = useRef(false);

  useEffect(() => {
    if (drawnBBox) {
      map.fitBounds(bboxToLeafletBounds(drawnBBox), {
        padding: [70, 70],
        maxZoom: 15,
      });
      return;
    }
    if (didInitialFit.current) return;
    const bounds = featureBounds(guideFeatures);
    if (!bounds) return;
    didInitialFit.current = true;
    map.fitBounds(bounds, { padding: [40, 40], maxZoom: 10 });
  }, [drawnBBox, guideFeatures, map]);

  useEffect(() => {
    if (groups.length === 0 || drawnBBox) return;
    const bounds = featureBounds(groupsToFeatureCollection(groups));
    if (!bounds) return;
    map.fitBounds(bounds, { padding: [70, 70], maxZoom: 14 });
  }, [drawnBBox, groups, map]);

  return null;
}

function RegionPolygonsLayer({
  data,
  selectedRegion,
}: {
  data: FeatureCollection;
  selectedRegion: string;
}) {
  return (
    <GeoJSON
      key={`regions-${data.features.length}-${selectedRegion}`}
      data={data}
      interactive={false}
      style={(feature) => {
        const region = regionName(feature);
        const color = regionColor(region);
        const selected = selectedRegion !== "-" && selectedRegion === region;
        return {
          color,
          weight: selected ? 2.8 : 1.5,
          opacity: selected ? 0.9 : 0.52,
          fillColor: color,
          fillOpacity: selected ? 0.16 : 0.07,
        };
      }}
      pane="overlayPane"
    />
  );
}

function GuideLayer({ data }: { data: FeatureCollection<Polygon> }) {
  return (
    <GeoJSON
      key={`guide-${data.features.length}`}
      data={data}
      interactive={false}
      style={{
        color: "#d97706",
        weight: 2.4,
        opacity: 0.96,
        dashArray: "8 5",
        fillColor: "#f59e0b",
        fillOpacity: 0.16,
      }}
      pane="overlayPane"
    />
  );
}

function FootprintsLayer({
  groups,
  hoveredId,
  selectable,
  onHover,
  onTogglePast,
  onToggleCurrent,
}: {
  groups: OrthoGroup[];
  hoveredId: string | null;
  selectable: boolean;
  onHover: (id: string | null) => void;
  onTogglePast: (pastId: string) => void;
  onToggleCurrent: (currentId: string) => void;
}) {
  const layerRef = useRef<LeafletGeoJSON | null>(null);
  const fc = useMemo(() => groupsToFeatureCollection(groups), [groups]);

  useEffect(() => {
    const layer = layerRef.current;
    if (!layer) return;
    layer.eachLayer((sub) => {
      const feature = (sub as { feature?: Feature<Polygon> }).feature;
      const id = String(feature?.properties?.id ?? "");
      (sub as unknown as { setStyle: (style: PathOptions) => void }).setStyle(
        footprintStyle(feature, hoveredId === id),
      );
      if (hoveredId === id) {
        (sub as unknown as { bringToFront: () => void }).bringToFront();
      }
    });
  }, [hoveredId, fc]);

  return (
    <GeoJSON
      key={fc.features
        .map((feature) => `${feature.properties?.id}:${feature.properties?.included}`)
        .join("|")}
      ref={(layer) => {
        layerRef.current = layer ?? null;
      }}
      data={fc}
      style={(feature) => footprintStyle(feature, hoveredId === feature?.properties?.id)}
      onEachFeature={(feature, layer) => {
        const id = String(feature.properties?.id ?? "");
        const era = String(feature.properties?.era ?? "");
        const label = String(feature.properties?.label ?? id);
        layer.bindTooltip(label, {
          sticky: true,
          direction: "top",
          className: "leaflet-tooltip-soft",
        });
        layer.on({
          mouseover: () => onHover(id),
          mouseout: () => onHover(null),
          click: (event) => {
            if (!selectable) return;
            if (era === "current") {
              onToggleCurrent(id);
            } else {
              onTogglePast(id);
            }
            L.DomEvent.stopPropagation(event);
          },
        });
      }}
      pane="overlayPane"
    />
  );
}

function MapLegend({
  step,
  hasGroups,
}: {
  step: WizardStep;
  hasGroups: boolean;
}) {
  return (
    <div className="absolute left-3 bottom-3 z-[500] rounded-lg border border-white/70 bg-white/95 p-2.5 shadow-sm">
      <div className="space-y-1.5 text-[11px] font-bold text-slate-600">
        {step === "draw" ? (
          <>
            <LegendItem className="border-teal-700 bg-teal-500/10">
              권역 폴리곤
            </LegendItem>
            <LegendItem className="border-dashed border-amber-600 bg-amber-500/25">
              정사영상 보유 영역
            </LegendItem>
          </>
        ) : null}
        {hasGroups ? (
          <>
            <LegendItem className="border-dashed border-blue-600 bg-blue-500/10">
              과년도
            </LegendItem>
            <LegendItem className="border-emerald-600 bg-emerald-500/20">
              당해년도
            </LegendItem>
          </>
        ) : null}
        <LegendItem className="border-dashed border-blue-600 bg-blue-500/10">
          지정 범위
        </LegendItem>
      </div>
    </div>
  );
}

function RegionOverlay({
  step,
  selectedRegion,
  selectedCount,
  guideRegions,
}: {
  step: WizardStep;
  selectedRegion: string;
  selectedCount: number;
  guideRegions: GuideRegionStat[];
}) {
  if (step !== "draw" && selectedCount === 0) return null;

  return (
    <div className="absolute left-3 top-3 z-[500] max-w-[260px] rounded-lg border border-white/70 bg-white/95 p-3 shadow-sm">
      {selectedCount > 0 ? (
        <>
          <div className="text-[10px] font-black uppercase tracking-wide text-slate-400">
            선택 권역
          </div>
          <div className="mt-1 text-sm font-black text-slate-900">
            {selectedRegion}
          </div>
        </>
      ) : (
        <>
          <div className="text-[10px] font-black uppercase tracking-wide text-slate-400">
            보유 권역
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {guideRegions.slice(0, 8).map((item) => (
              <span
                key={item.region}
                className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] font-black text-slate-700"
              >
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: item.color }}
                />
                {item.region}
                <span className="text-slate-400">{item.count}</span>
              </span>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function LegendItem({
  className,
  children,
}: {
  className: string;
  children: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className={cn("h-3 w-5 rounded-sm border-2", className)} />
      <span>{children}</span>
    </div>
  );
}

function buildGuideFeatures(datasets: Dataset[]): FeatureCollection<Polygon> {
  return {
    type: "FeatureCollection",
    features: datasets
      .filter((dataset) => dataset.status === "ready")
      .filter((dataset) => safeDatasetBBox(dataset) !== null)
      .map((dataset) => ({
        type: "Feature",
        properties: {
          id: dataset.id,
          label: dataset.display_name,
          region: dataset.primary_region ?? dataset.regions[0] ?? "권역 미확인",
        },
        geometry: dataset.bbox,
      })),
  };
}

interface GuideRegionStat {
  region: string;
  count: number;
  color: string;
}

function buildGuideRegionStats(datasets: Dataset[]): GuideRegionStat[] {
  const counts = new Map<string, number>();
  for (const dataset of datasets) {
    if (dataset.status !== "ready" || safeDatasetBBox(dataset) === null) continue;
    const region = dataset.primary_region ?? dataset.regions[0] ?? "권역 미확인";
    counts.set(region, (counts.get(region) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "ko-KR"))
    .map(([region, count], index) => ({
      region,
      count,
      color: GUIDE_COLORS[index % GUIDE_COLORS.length]!,
    }));
}

function regionName(feature: Feature | undefined): string {
  return String(
    feature?.properties?.region ??
      feature?.properties?.region_full ??
      feature?.properties?.name ??
      "권역 미확인",
  );
}

function regionColor(region: string): string {
  let hash = 0;
  for (let i = 0; i < region.length; i += 1) {
    hash = (hash * 31 + region.charCodeAt(i)) >>> 0;
  }
  return GUIDE_COLORS[hash % GUIDE_COLORS.length]!;
}

function groupsToFeatureCollection(groups: OrthoGroup[]): FeatureCollection<Polygon> {
  const byId = new Map<
    string,
    {
      image: ReturnType<typeof allOrthoFeatures>[number];
      pastIncluded: boolean;
      currentIncluded: boolean;
    }
  >();

  for (const group of groups) {
    const past = byId.get(group.past.id) ?? {
      image: group.past,
      pastIncluded: false,
      currentIncluded: false,
    };
    past.pastIncluded ||= group.past.included;
    byId.set(group.past.id, past);

    for (const current of group.currents) {
      const item = byId.get(current.id) ?? {
        image: current,
        pastIncluded: false,
        currentIncluded: false,
      };
      item.currentIncluded ||= current.included;
      byId.set(current.id, item);
    }
  }

  const features = Array.from(byId.values()).map((item) => {
    const era =
      item.pastIncluded && item.currentIncluded
        ? "both"
        : item.currentIncluded
          ? "current"
          : "past";
    return {
      type: "Feature" as const,
      properties: {
        id: item.image.id,
        era,
        included: item.pastIncluded || item.currentIncluded,
        label: `${item.image.id} · ${item.image.displayName}`,
      },
      geometry: item.image.geometry,
    };
  });
  return { type: "FeatureCollection", features };
}

function footprintStyle(feature: Feature | undefined, hovered: boolean): PathOptions {
  const era = String(feature?.properties?.era ?? "");
  const included = feature?.properties?.included !== false;

  if (era === "both") {
    return {
      color: included ? "#7c3aed" : "#94a3b8",
      weight: hovered ? 3.4 : 2.6,
      opacity: included ? 1 : 0.45,
      dashArray: "4 3",
      fillColor: included ? "#8b5cf6" : "#94a3b8",
      fillOpacity: included ? (hovered ? 0.24 : 0.14) : 0.04,
    };
  }

  if (era === "past") {
    return {
      color: included ? "#2563eb" : "#94a3b8",
      weight: hovered ? 3.2 : 2.2,
      opacity: included ? 1 : 0.45,
      dashArray: "6 4",
      fillColor: included ? "#3b82f6" : "#94a3b8",
      fillOpacity: included ? (hovered ? 0.16 : 0.07) : 0.04,
    };
  }

  return {
    color: included ? "#059669" : "#94a3b8",
    weight: hovered ? 3.2 : 2.4,
    opacity: included ? 1 : 0.45,
    fillColor: included ? "#10b981" : "#94a3b8",
    fillOpacity: included ? (hovered ? 0.28 : 0.18) : 0.04,
  };
}

function bboxContainsLatLng(bbox: BBox, latlng: L.LatLng): boolean {
  return (
    latlng.lng >= bbox[0] &&
    latlng.lng <= bbox[2] &&
    latlng.lat >= bbox[1] &&
    latlng.lat <= bbox[3]
  );
}

function featureBounds(
  featureCollection: FeatureCollection<Polygon>,
): LatLngBoundsExpression | null {
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;

  for (const feature of featureCollection.features) {
    for (const [lng, lat] of feature.geometry.coordinates[0] ?? []) {
      west = Math.min(west, lng);
      south = Math.min(south, lat);
      east = Math.max(east, lng);
      north = Math.max(north, lat);
    }
  }

  if (![west, south, east, north].every(Number.isFinite)) return null;
  if (west >= east || south >= north) return null;
  return [
    [south, west],
    [north, east],
  ];
}
