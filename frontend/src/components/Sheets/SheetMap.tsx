import { useEffect, useMemo, useRef, useState } from "react";
import {
  GeoJSON,
  MapContainer,
  Popup,
  TileLayer,
  useMap,
  useMapEvents,
} from "react-leaflet";
import L from "leaflet";
import type {
  GeoJSON as LeafletGeoJSON,
  LeafletMouseEvent,
  PathOptions,
} from "leaflet";
import type {
  Feature,
  FeatureCollection,
  MultiPolygon,
  Polygon,
} from "geojson";
import { useSheetsStore } from "@/stores/sheetsStore";
import { useDatasetsStore } from "@/stores/datasetsStore";
import { useTasksStore } from "@/stores/tasksStore";
import type { Dataset, Task } from "@/types";

/**
 * /sheets 의 한국 전도 지도 — React-Leaflet.
 *
 * 레이어 구성:
 *   1) 권역 디졸브 GeoJSON (8 features). 기본 배경.
 *   2) 프로젝트 실제 처리영역 (과년도 합집합 ∩ 당해년도 합집합).
 *
 * 동기화:
 *   - 프로젝트 row/폴리곤 hover: 파란색 미리보기.
 *   - 프로젝트 row/폴리곤 클릭: 파란색 선택 유지 + 실제 처리영역으로 fly.
 */
const KOREA_CENTER: [number, number] = [36.5, 127.8];
const KOREA_ZOOM = 7;

const INACTIVE_FILL = "#cbd5e1";
const INACTIVE_STROKE = "#475569";
const ACTIVE_FILL = "#3b82f6";
const ACTIVE_STROKE = "#2563eb";

interface OverlapProjectChoice {
  position: [number, number];
  tasks: Task[];
}

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
  const activeRegion = useSheetsStore((s) => s.filter.region);
  const highlightedTaskId = useSheetsStore((s) => s.highlightedTaskId);
  const selectedTaskId = useSheetsStore((s) => s.selectedTaskId);
  const setHighlightedTask = useSheetsStore((s) => s.setHighlightedTask);
  const setSelectedTask = useSheetsStore((s) => s.setSelectedTask);
  const tasks = useTasksStore((s) => s.tasks);
  const activeTaskId = highlightedTaskId ?? selectedTaskId;
  const [overlapChoice, setOverlapChoice] =
    useState<OverlapProjectChoice | null>(null);

  useEffect(() => {
    setOverlapChoice(null);
  }, [selectedTaskId]);

  const handleTaskAreaClick = (
    clickedTaskId: string,
    event: LeafletMouseEvent,
  ) => {
    const { lng, lat } = event.latlng;
    const overlappingTasks = tasks.filter(
      (task) =>
        task.processing_geometry != null &&
        pointInProcessingGeometry(lng, lat, task.processing_geometry),
    );
    const candidates = overlappingTasks.length > 0
      ? overlappingTasks
      : tasks.filter((task) => task.id === clickedTaskId);

    setHighlightedTask(null);
    if (candidates.length <= 1) {
      setOverlapChoice(null);
      if (candidates[0]) setSelectedTask(candidates[0].id);
      return;
    }
    setOverlapChoice({ position: [lat, lng], tasks: candidates });
  };

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
      <ProjectProcessingAreasLayer
        tasks={tasks}
        activeTaskId={activeTaskId}
        onTaskHover={setHighlightedTask}
        onTaskClick={handleTaskAreaClick}
      />
      <SelectedTaskFlyController tasks={tasks} />
      <SelectedDatasetBboxLayer />
      {overlapChoice ? (
        <Popup
          position={overlapChoice.position}
          closeButton
          closeOnClick={false}
          autoPan
          eventHandlers={{
            remove: () => {
              setOverlapChoice(null);
              setHighlightedTask(null);
            },
          }}
        >
          <div className="min-w-64 py-1">
            <div className="text-sm font-bold text-slate-800">
              겹치는 프로젝트 {overlapChoice.tasks.length}개
            </div>
            <p className="mt-1 text-xs text-slate-500">
              선택할 프로젝트를 골라주세요.
            </p>
            <div className="mt-2 space-y-1">
              {overlapChoice.tasks.map((task) => (
                <button
                  key={task.id}
                  type="button"
                  onMouseEnter={() => setHighlightedTask(task.id)}
                  onMouseLeave={() => setHighlightedTask(null)}
                  onClick={() => {
                    setSelectedTask(task.id);
                    setHighlightedTask(null);
                    setOverlapChoice(null);
                  }}
                  className={`flex w-full items-center justify-between gap-3 rounded-md border px-2.5 py-2 text-left transition-colors ${
                    task.id === selectedTaskId
                      ? "border-blue-300 bg-blue-50 text-blue-800"
                      : "border-slate-200 bg-white text-slate-700 hover:border-blue-300 hover:bg-blue-50"
                  }`}
                >
                  <span className="min-w-0 truncate text-xs font-semibold">
                    {task.name}
                  </span>
                  <span className="shrink-0 text-[11px] tabular-nums text-slate-500">
                    {formatProcessingArea(task.processing_area_m2)}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </Popup>
      ) : null}
      <MapSelectionClearController
        onClear={() => setOverlapChoice(null)}
      />
    </MapContainer>
  );
}

/** 지도 빈 공간 클릭 시 프로젝트 선택을 해제. */
function MapSelectionClearController({ onClear }: { onClear: () => void }) {
  const clearMapSelection = useSheetsStore((s) => s.clearMapSelection);
  useMapEvents({
    click: () => {
      onClear();
      clearMapSelection();
    },
  });
  return null;
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
// 프로젝트 실제 처리영역 폴리곤
// ============================================================
function ProjectProcessingAreasLayer({
  tasks,
  activeTaskId,
  onTaskHover,
  onTaskClick,
}: {
  tasks: Task[];
  activeTaskId: string | null;
  onTaskHover: (taskId: string | null) => void;
  onTaskClick: (taskId: string, event: LeafletMouseEvent) => void;
}) {
  const fc = useMemo<FeatureCollection<Polygon | MultiPolygon>>(() => {
    return {
      type: "FeatureCollection",
      // 최신 프로젝트가 겹친 영역에서 위에 오도록 오래된 순서로 그린다.
      features: [...tasks]
        .reverse()
        .filter(
          (
            task,
          ): task is Task & {
            processing_geometry: Polygon | MultiPolygon;
          } =>
            task.processing_geometry != null,
        )
        .map((task) => ({
          type: "Feature",
          properties: {
            taskId: task.id,
            name: task.name,
            areaM2: task.processing_area_m2,
          },
          geometry: task.processing_geometry,
        })),
    };
  }, [tasks]);
  const geometryKey = useMemo(
    () =>
      fc.features
        .map(
          (feature) =>
            `${String(feature.properties?.taskId)}:${JSON.stringify(feature.geometry.coordinates)}`,
        )
        .join("|"),
    [fc],
  );

  const layerRef = useRef<LeafletGeoJSON | null>(null);

  useEffect(() => {
    const layer = layerRef.current;
    if (!layer) return;
    layer.eachLayer((sub) => {
      const f = (sub as { feature?: Feature }).feature;
      const taskId = String(f?.properties?.taskId ?? "");
      const isActive = taskId === activeTaskId;
      (sub as unknown as { setStyle: (s: PathOptions) => void }).setStyle(
        processingAreaStyle(isActive),
      );
      if (isActive) {
        (sub as unknown as { bringToFront: () => void }).bringToFront();
      }
    });
  }, [activeTaskId]);

  if (fc.features.length === 0) return null;

  return (
    <GeoJSON
      key={`processing-areas-${geometryKey}`}
      ref={(layer) => {
        layerRef.current = layer ?? null;
      }}
      data={fc}
      style={(feature) => {
        const taskId = String(feature?.properties?.taskId ?? "");
        return processingAreaStyle(taskId === activeTaskId);
      }}
      onEachFeature={(feature, sub) => {
        const taskId = String(feature.properties?.taskId ?? "");
        const name = String(feature.properties?.name ?? taskId);
        const areaText = formatProcessingArea(
          Number(feature.properties?.areaM2 ?? 0),
        );
        sub.bindTooltip(`${name} · ${areaText}`, {
          sticky: true,
          direction: "top",
          className: "leaflet-tooltip-soft",
        });
        sub.on({
          mouseover: () => onTaskHover(taskId),
          mouseout: () => onTaskHover(null),
          click: (event) => {
            onTaskClick(taskId, event);
            L.DomEvent.stopPropagation(event);
          },
        });
      }}
    />
  );
}

function formatProcessingArea(areaM2: number | null | undefined): string {
  if (!areaM2 || areaM2 <= 0) return "면적 정보 없음";
  return `${(areaM2 / 1_000_000).toLocaleString("ko-KR", {
    maximumFractionDigits: 2,
  })} km²`;
}

function pointInProcessingGeometry(
  lng: number,
  lat: number,
  geometry: Polygon | MultiPolygon,
): boolean {
  const polygons =
    geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  return polygons.some((polygon) => {
    const [outer, ...holes] = polygon;
    return (
      pointInRing(lng, lat, outer) &&
      !holes.some((hole) => pointInRing(lng, lat, hole))
    );
  });
}

function pointInRing(
  lng: number,
  lat: number,
  ring: Polygon["coordinates"][number],
): boolean {
  if (ring.length < 3) return false;
  let inside = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index++) {
    const [currentLng, currentLat] = ring[index];
    const [previousLng, previousLat] = ring[previous];
    if (
      pointOnSegment(
        lng,
        lat,
        previousLng,
        previousLat,
        currentLng,
        currentLat,
      )
    ) {
      return true;
    }
    const crossesLatitude = (currentLat > lat) !== (previousLat > lat);
    if (
      crossesLatitude &&
      lng <
        ((previousLng - currentLng) * (lat - currentLat)) /
          (previousLat - currentLat) +
          currentLng
    ) {
      inside = !inside;
    }
  }
  return inside;
}

function pointOnSegment(
  lng: number,
  lat: number,
  startLng: number,
  startLat: number,
  endLng: number,
  endLat: number,
): boolean {
  const cross =
    (lng - startLng) * (endLat - startLat) -
    (lat - startLat) * (endLng - startLng);
  if (Math.abs(cross) > 1e-10) return false;
  return (
    lng >= Math.min(startLng, endLng) - 1e-10 &&
    lng <= Math.max(startLng, endLng) + 1e-10 &&
    lat >= Math.min(startLat, endLat) - 1e-10 &&
    lat <= Math.max(startLat, endLat) + 1e-10
  );
}

function processingAreaStyle(isActive: boolean): PathOptions {
  if (isActive) {
    return {
      color: ACTIVE_STROKE,
      weight: 3,
      fillColor: ACTIVE_FILL,
      fillOpacity: 0.42,
      opacity: 1,
    };
  }
  return {
    color: INACTIVE_STROKE,
    weight: 1.8,
    fillColor: INACTIVE_FILL,
    fillOpacity: 0.28,
    opacity: 0.8,
  };
}

// ============================================================
// 선택된 프로젝트의 실제 처리영역으로 fly
// ============================================================
function SelectedTaskFlyController({ tasks }: { tasks: Task[] }) {
  const map = useMap();
  const selectedTaskId = useSheetsStore((s) => s.selectedTaskId);
  const selectedTaskTick = useSheetsStore((s) => s.selectedTaskTick);

  useEffect(() => {
    const geometry = tasks.find(
      (task) => task.id === selectedTaskId,
    )?.processing_geometry;
    const extent = processingGeometryExtent(geometry ?? null);
    if (!extent) return;
    const [minLng, minLat, maxLng, maxLat] = extent;
    map.flyToBounds(
      [
        [minLat, minLng],
        [maxLat, maxLng],
      ],
      { padding: [60, 60], maxZoom: 13, duration: 0.7 },
    );
  }, [selectedTaskTick, selectedTaskId, tasks, map]);

  return null;
}

function processingGeometryExtent(
  geometry: Polygon | MultiPolygon | null,
): [number, number, number, number] | null {
  if (!geometry) return null;
  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;
  const polygons =
    geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;

  for (const polygon of polygons) {
    for (const ring of polygon) {
      for (const [lng, lat] of ring) {
        if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
        minLng = Math.min(minLng, lng);
        minLat = Math.min(minLat, lat);
        maxLng = Math.max(maxLng, lng);
        maxLat = Math.max(maxLat, lat);
      }
    }
  }

  if (![minLng, minLat, maxLng, maxLat].every(Number.isFinite)) return null;
  return [minLng, minLat, maxLng, maxLat];
}
