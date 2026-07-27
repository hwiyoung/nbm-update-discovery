import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  Circle,
  Download,
  FileText,
  Hexagon,
  Loader2,
  Map as MapIcon,
  Mountain,
  Pencil,
  Save,
  Square,
  X,
} from "lucide-react";
import { GeoJSON, MapContainer, TileLayer, ZoomControl, useMap } from "react-leaflet";
import L from "leaflet";
import type { FeatureCollection, MultiPolygon, Polygon } from "geojson";
import toast from "react-hot-toast";
import { getDataset, listTaskDetections } from "@/api/client";
import { Button, Input, Modal, ModalDescription } from "@/components/Common";
import {
  createExportSaveTarget,
  getDefaultTaskExportFilename,
  isExportSaveCanceled,
  type ExportKind,
  type ExportSaveTarget,
} from "@/services/exporters/saveTarget";
import type { Dataset, DetectionObject, Task } from "@/types";
import { CHANGE_TYPE_BY_CODE } from "@/utils/constants";
import { cn } from "@/utils/cn";
import { polygonsIntersect } from "@/utils/polygonSelection";

type ExportScope = "region" | "all";
type DrawMode = "circle" | "polygon" | "freehand" | "rectangle";
type ImagerySide = "standard" | "compare";

const EXPORT_META: Record<ExportKind, {
  label: string;
  sub: string;
  ext: string;
  icon: ReactNode;
}> = {
  shp: {
    label: "폴리곤 SHP",
    sub: "EPSG:5186 + .prj 동봉",
    ext: ".zip",
    icon: <MapIcon size={14} />,
  },
  dxf: {
    label: "폴리곤 DXF (2D)",
    sub: "변화 유형별 layer",
    ext: ".dxf",
    icon: <MapIcon size={14} />,
  },
  dxf3d: {
    label: "폴리곤 3D DXF",
    sub: "vertex 별 DEM 높이 자동 적용",
    ext: ".dxf",
    icon: <Mountain size={14} />,
  },
  pdf: {
    label: "리포트 PDF",
    sub: "요약 + 그래프",
    ext: ".pdf",
    icon: <FileText size={14} />,
  },
};

const DRAW_TOOLS: Array<{ mode: DrawMode; label: string; icon: ReactNode }> = [
  { mode: "circle", label: "원형", icon: <Circle size={14} /> },
  { mode: "polygon", label: "다각형", icon: <Hexagon size={14} /> },
  { mode: "freehand", label: "자유형", icon: <Pencil size={14} /> },
  { mode: "rectangle", label: "사각형", icon: <Square size={14} /> },
];

export function TaskExportDialog({
  task,
  open,
  onClose,
}: {
  task: Task;
  open: boolean;
  onClose: () => void;
}) {
  const [detections, setDetections] = useState<DetectionObject[]>([]);
  const [standardDatasets, setStandardDatasets] = useState<Dataset[]>([]);
  const [compareDatasets, setCompareDatasets] = useState<Dataset[]>([]);
  const [imagerySide, setImagerySide] = useState<ImagerySide>("compare");
  const [imageryError, setImageryError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [scope, setScope] = useState<ExportScope>("region");
  const [kind, setKind] = useState<ExportKind>("shp");
  const [drawMode, setDrawMode] = useState<DrawMode | null>(null);
  const [region, setRegion] = useState<Polygon | null>(null);
  const [filename, setFilename] = useState(getExportFilename(task, "shp", true));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let canceled = false;
    setScope("region");
    setKind("shp");
    setDrawMode(null);
    setRegion(null);
    setFilename(getExportFilename(task, "shp", true));
    setError(null);
    setLoadError(null);
    setImageryError(null);
    setStandardDatasets([]);
    setCompareDatasets([]);
    const standardIds = taskResourceIds(task, "standard");
    const compareIds = taskResourceIds(task, "compare");
    setImagerySide(compareIds.length > 0 ? "compare" : "standard");
    setLoading(true);
    void Promise.all([
      listTaskDetections(task.id),
      Promise.allSettled(standardIds.map((id) => getDataset(id))),
      Promise.allSettled(compareIds.map((id) => getDataset(id))),
    ])
      .then(([items, standardResults, compareResults]) => {
        if (canceled) return;
        const loadedStandard = fulfilledDatasets(standardResults);
        const loadedCompare = fulfilledDatasets(compareResults);
        setDetections(items.filter((item) => !item.is_deleted));
        setStandardDatasets(loadedStandard);
        setCompareDatasets(loadedCompare);
        const failedCount = rejectedCount(standardResults) + rejectedCount(compareResults);
        if (failedCount > 0) {
          setImageryError(`정사영상 정보 ${failedCount}건을 불러오지 못해 일부 영상 또는 경계가 표시되지 않습니다.`);
        }
        if (loadedCompare.length === 0 && loadedStandard.length > 0) {
          setImagerySide("standard");
        }
      })
      .catch((reason) => {
        if (!canceled) {
          setDetections([]);
          setLoadError(reason instanceof Error ? reason.message : "변화탐지 결과를 불러오지 못했습니다");
        }
      })
      .finally(() => {
        if (!canceled) setLoading(false);
      });
    return () => {
      canceled = true;
    };
  }, [open, task.id]);

  useEffect(() => {
    setFilename(getExportFilename(task, kind, scope === "region"));
    setError(null);
  }, [kind, scope, task]);

  const selectedIds = useMemo(
    () => region
      ? detections
        .filter((detection) => polygonsIntersect(region, detection.geometry))
        .map((detection) => detection.id)
      : [],
    [detections, region],
  );

  const finishDrawing = useCallback((polygon: Polygon) => {
    setRegion(polygon);
    setDrawMode(null);
    setError(null);
  }, []);

  const submit = async () => {
    if (busy || loading) return;
    const normalized = normalizeExportFilename(filename, kind);
    if (!normalized) {
      setError("파일명을 입력하세요");
      return;
    }
    if (scope === "region" && !region) {
      setError("지도에서 내보낼 관심지역을 지정하세요");
      return;
    }
    if (scope === "region" && selectedIds.length === 0) {
      setError("선택한 영역 안에 변화탐지 객체가 없습니다");
      return;
    }

    setBusy(true);
    setError(null);
    const toastId = `export-${task.id}-${kind}`;
    toast.loading(`${EXPORT_META[kind].label} 생성 중…`, { id: toastId });
    try {
      const saveTarget = await createExportSaveTarget(normalized, kind);
      const objectIds = scope === "region" ? selectedIds : undefined;
      const stats = await executeTaskExport(task.id, kind, saveTarget, objectIds);
      showExportSuccess(kind, stats, toastId, objectIds?.length);
      onClose();
    } catch (reason) {
      if (isExportSaveCanceled(reason)) toast.dismiss(toastId);
      else toast.error(reason instanceof Error ? reason.message : "내보내기 실패", { id: toastId });
    } finally {
      setBusy(false);
    }
  };

  const regionReady = scope === "all" || (region !== null && selectedIds.length > 0);

  return (
    <Modal
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !busy) onClose();
      }}
      title="변화탐지 결과 내보내기"
      icon={<Download size={20} />}
      width={980}
      blockDismiss={busy}
      footer={
        <>
          <div className="mr-auto text-xs text-slate-500">
            {scope === "region"
              ? region
                ? `관심지역 내 ${selectedIds.length.toLocaleString("ko-KR")}건`
                : "지도에서 관심지역을 지정하세요"
              : `전체 ${detections.length.toLocaleString("ko-KR")}건`}
          </div>
          <Button variant="ghost" onClick={onClose} disabled={busy}>취소</Button>
          <Button
            variant="primary"
            onClick={() => void submit()}
            disabled={busy || loading || Boolean(loadError) || !regionReady}
            leftIcon={busy ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
          >
            다운로드
          </Button>
        </>
      }
    >
      <ModalDescription>
        지도에서 관심지역을 지정하고 해당 영역에 포함되는 변화탐지 결과만 내보냅니다.
      </ModalDescription>

      <div className="space-y-4">
        <section>
          <div className="mb-2 text-xs font-bold text-slate-600">1. 파일 형식</div>
          <div className="grid grid-cols-4 gap-2">
            {(Object.keys(EXPORT_META) as ExportKind[]).map((value) => {
              const meta = EXPORT_META[value];
              return (
                <button
                  key={value}
                  type="button"
                  onClick={() => setKind(value)}
                  disabled={busy}
                  className={cn(
                    "rounded-lg border px-3 py-2 text-left transition-colors",
                    kind === value
                      ? "border-blue-500 bg-blue-50 text-blue-700"
                      : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50",
                  )}
                >
                  <span className="flex items-center gap-1.5 text-xs font-bold">
                    {meta.icon}{meta.label}
                  </span>
                  <span className="mt-0.5 block text-[10px] opacity-70">{meta.sub}</span>
                </button>
              );
            })}
          </div>
        </section>

        <section>
          <div className="mb-2 flex items-center justify-between gap-3">
            <div className="text-xs font-bold text-slate-600">2. 내보내기 범위</div>
            <div className="inline-flex rounded-md border border-slate-200 bg-slate-50 p-0.5">
              <ScopeButton active={scope === "region"} onClick={() => setScope("region")}>
                관심지역
              </ScopeButton>
              <ScopeButton
                active={scope === "all"}
                onClick={() => {
                  setScope("all");
                  setDrawMode(null);
                  setRegion(null);
                }}
              >
                전체 결과
              </ScopeButton>
            </div>
          </div>

          <div className="overflow-hidden rounded-lg border border-slate-200 bg-slate-100">
            <div className="flex min-h-10 items-center gap-1.5 border-b border-slate-200 bg-white px-3 py-1.5">
              <span className="mr-1 text-[11px] font-bold text-slate-500">영역 모양</span>
              {DRAW_TOOLS.map((tool) => (
                <button
                  key={tool.mode}
                  type="button"
                  disabled={scope !== "region" || busy || loading}
                  onClick={() => {
                    setRegion(null);
                    setDrawMode(tool.mode);
                    setError(null);
                  }}
                  className={cn(
                    "inline-flex h-7 items-center gap-1 rounded px-2 text-[11px] font-bold transition-colors disabled:opacity-35",
                    drawMode === tool.mode
                      ? "bg-violet-600 text-white"
                      : "text-slate-600 hover:bg-violet-50 hover:text-violet-700",
                  )}
                >
                  {tool.icon}{tool.label}
                </button>
              ))}
              {region ? (
                <button
                  type="button"
                  onClick={() => {
                    setRegion(null);
                    setDrawMode(null);
                  }}
                  className="ml-auto inline-flex h-7 items-center gap-1 rounded px-2 text-[11px] text-slate-500 hover:bg-slate-100"
                >
                  <X size={12} /> 영역 지우기
                </button>
              ) : null}
              <span className={cn(
                "ml-auto text-[11px] font-bold tabular-nums",
                region ? "text-violet-700" : "text-slate-400",
              )}>
                {scope === "all"
                  ? `전체 ${detections.length.toLocaleString("ko-KR")}건`
                    : region
                    ? `${selectedIds.length.toLocaleString("ko-KR")}건 선택`
                    : drawMode
                      ? `${DRAW_TOOLS.find((tool) => tool.mode === drawMode)?.label} 그리는 중`
                      : "영역을 그려주세요"}
              </span>
            </div>

            <div className="relative h-[390px]">
              <ExportSelectionMap
                task={task}
                detections={detections}
                region={region}
                drawMode={scope === "region" ? drawMode : null}
                selectedIds={scope === "region" ? selectedIds : detections.map((item) => item.id)}
                standardDatasets={standardDatasets}
                compareDatasets={compareDatasets}
                imagerySide={imagerySide}
                onFinish={finishDrawing}
              />
              <div className="absolute left-3 top-3 z-[500] flex items-center gap-1 rounded-lg border border-slate-200 bg-white/95 p-1 shadow-sm">
                <span className="px-1.5 text-[11px] font-bold text-slate-500">정사영상</span>
                <ImageryButton
                  active={imagerySide === "standard"}
                  disabled={standardDatasets.length === 0}
                  onClick={() => setImagerySide("standard")}
                  title={datasetGroupLabel("과년도", standardDatasets)}
                >
                  과년도
                </ImageryButton>
                <ImageryButton
                  active={imagerySide === "compare"}
                  disabled={compareDatasets.length === 0}
                  onClick={() => setImagerySide("compare")}
                  title={datasetGroupLabel("당해년도", compareDatasets)}
                >
                  당해년도
                </ImageryButton>
              </div>
              {drawMode === "polygon" ? (
                <div className="pointer-events-none absolute left-1/2 top-3 z-[500] -translate-x-1/2 rounded-md border border-violet-200 bg-white/95 px-3 py-1.5 text-[11px] font-bold text-violet-700 shadow-sm">
                  점을 클릭해 모양 지정 · 첫 점 클릭 또는 더블클릭으로 완료
                </div>
              ) : null}
              <MapBoundaryLegend />
              {loading ? (
                <div className="absolute inset-0 z-[500] flex items-center justify-center bg-white/75 text-xs font-bold text-slate-600">
                  <Loader2 size={16} className="mr-2 animate-spin" /> 변화탐지 결과 불러오는 중…
                </div>
              ) : null}
              {loadError ? (
                <div className="absolute inset-x-3 top-3 z-[500] rounded-md border border-red-200 bg-white px-3 py-2 text-xs text-red-700 shadow">
                  {loadError}
                </div>
              ) : null}
              {!loading && !loadError && imageryError ? (
                <div className="absolute inset-x-3 bottom-10 z-[500] rounded-md border border-amber-200 bg-white/95 px-3 py-2 text-[11px] text-amber-700 shadow">
                  {imageryError}
                </div>
              ) : null}
            </div>
          </div>
        </section>

        <section className="grid grid-cols-[100px_minmax(0,1fr)] items-center gap-3">
          <label className="text-xs font-bold text-slate-600" htmlFor={`export-filename-${task.id}`}>
            3. 파일명
          </label>
          <Input
            id={`export-filename-${task.id}`}
            value={filename}
            onChange={(event) => {
              setFilename(event.target.value);
              setError(null);
            }}
            disabled={busy}
            invalid={Boolean(error)}
            className="font-mono"
          />
        </section>

        {error ? (
          <div className="rounded-md border border-red-100 bg-red-50 px-3 py-2 text-xs text-red-700">
            {error}
          </div>
        ) : null}
      </div>
    </Modal>
  );
}

function ScopeButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "h-7 rounded px-3 text-[11px] font-bold transition-colors",
        active ? "bg-white text-blue-700 shadow-sm" : "text-slate-500 hover:text-slate-700",
      )}
    >
      {children}
    </button>
  );
}

function ImageryButton({
  active,
  disabled,
  onClick,
  title,
  children,
}: {
  active: boolean;
  disabled: boolean;
  onClick: () => void;
  title: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      title={title}
      className={cn(
        "h-7 rounded px-2.5 text-[11px] font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-35",
        active ? "bg-slate-800 text-white" : "text-slate-600 hover:bg-slate-100",
      )}
    >
      {children}
    </button>
  );
}

function MapBoundaryLegend() {
  return (
    <div className="pointer-events-none absolute bottom-3 left-3 z-[500] flex items-center gap-3 rounded-md border border-slate-200 bg-white/95 px-2.5 py-1.5 text-[10px] font-bold text-slate-600 shadow-sm">
      <LegendItem color="#0066ff" label="과년도 영역" />
      <LegendItem color="#00c853" label="당해년도 영역" />
      <LegendItem color="#f59e0b" label="변화탐지 처리영역" />
    </div>
  );
}

function LegendItem({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="block w-5 border-t-2 border-dashed" style={{ borderColor: color }} />
      {label}
    </span>
  );
}

function ExportSelectionMap({
  task,
  detections,
  region,
  drawMode,
  selectedIds,
  standardDatasets,
  compareDatasets,
  imagerySide,
  onFinish,
}: {
  task: Task;
  detections: DetectionObject[];
  region: Polygon | null;
  drawMode: DrawMode | null;
  selectedIds: string[];
  standardDatasets: Dataset[];
  compareDatasets: Dataset[];
  imagerySide: ImagerySide;
  onFinish: (polygon: Polygon) => void;
}) {
  const bounds = useMemo(() => mapBounds(task.processing_geometry ?? null, detections), [detections, task.processing_geometry]);
  const selected = useMemo(() => new Set(selectedIds), [selectedIds]);
  const collection = useMemo<FeatureCollection<Polygon>>(() => ({
    type: "FeatureCollection",
    features: detections.map((detection) => ({
      type: "Feature",
      properties: { id: detection.id, change_type: detection.change_type },
      geometry: detection.geometry,
    })),
  }), [detections]);

  return (
    <MapContainer
      bounds={bounds}
      maxZoom={21}
      className="h-full w-full"
      zoomControl={false}
      preferCanvas
    >
      <ZoomControl position="topright" />
      <TileLayer
        url="/vworld/{z}/{x}/{y}.jpg"
        attribution='&copy; <a href="https://www.vworld.kr/">VWorld</a>'
        minZoom={5}
        maxZoom={21}
        maxNativeZoom={16}
      />
      <DatasetTileLayers datasets={imagerySide === "standard" ? standardDatasets : compareDatasets} />
      <GeoJSON
        key={`${task.id}-${detections.length}`}
        data={collection}
        interactive={false}
        style={(feature) => {
          const id = String(feature?.properties?.id ?? "");
          const type = String(feature?.properties?.change_type ?? "");
          const color = CHANGE_TYPE_BY_CODE[type as keyof typeof CHANGE_TYPE_BY_CODE]?.color ?? "#3b82f6";
          const isSelected = selected.has(id);
          return {
            color,
            weight: isSelected ? 4 : 2,
            opacity: region && !isSelected ? 0.25 : 0.95,
            fillColor: color,
            fillOpacity: isSelected ? 0.28 : region ? 0.025 : 0.1,
          };
        }}
      />
      <DatasetBoundaryLayer datasets={standardDatasets} side="standard" />
      <DatasetBoundaryLayer datasets={compareDatasets} side="compare" />
      <ProcessingBoundaryLayer geometry={task.processing_geometry ?? null} />
      {region ? (
        <GeoJSON
          data={region}
          interactive={false}
          style={{
            color: "#7c3aed",
            weight: 3,
            opacity: 1,
            fillColor: "#8b5cf6",
            fillOpacity: 0.1,
            dashArray: "8 5",
          }}
        />
      ) : null}
      <RegionDrawController mode={drawMode} onFinish={onFinish} />
      <FitMapBounds bounds={bounds} />
    </MapContainer>
  );
}

function DatasetTileLayers({ datasets }: { datasets: Dataset[] }) {
  return (
    <>
      {datasets.map((dataset, index) => dataset.tile_path ? (
        <TileLayer
          key={dataset.id}
          url={`/titiler/cog/tiles/WebMercatorQuad/{z}/{x}/{y}.png?url=${encodeURIComponent(`file://${dataset.tile_path}`)}`}
          tileSize={256}
          minZoom={0}
          maxZoom={21}
          maxNativeZoom={20}
          zIndex={50 + index}
          keepBuffer={4}
          updateWhenZooming={false}
          updateWhenIdle
        />
      ) : null)}
    </>
  );
}

function DatasetBoundaryLayer({
  datasets,
  side,
}: {
  datasets: Dataset[];
  side: ImagerySide;
}) {
  const collection = useMemo<FeatureCollection<Polygon>>(() => ({
    type: "FeatureCollection",
    features: datasets
      .filter((dataset) => dataset.bbox.coordinates[0]?.length > 0)
      .map((dataset) => ({
        type: "Feature",
        properties: { id: dataset.id, side },
        geometry: dataset.bbox,
      })),
  }), [datasets, side]);
  if (collection.features.length === 0) return null;
  return (
    <GeoJSON
      key={`${side}-${datasets.map((dataset) => dataset.id).join("-")}`}
      data={collection}
      interactive={false}
      style={{
        color: side === "standard" ? "#0066ff" : "#00c853",
        weight: 3.5,
        opacity: 1,
        fill: false,
        fillOpacity: 0,
        dashArray: "8 5",
      }}
    />
  );
}

function ProcessingBoundaryLayer({
  geometry,
}: {
  geometry: Polygon | MultiPolygon | null;
}) {
  if (!geometry) return null;
  return (
    <GeoJSON
      data={geometry}
      interactive={false}
      style={{
        color: "#f59e0b",
        weight: 3,
        opacity: 1,
        fill: false,
        fillOpacity: 0,
        dashArray: "7 4",
      }}
    />
  );
}

function FitMapBounds({ bounds }: { bounds: L.LatLngBoundsExpression }) {
  const map = useMap();
  useEffect(() => {
    const fit = () => {
      map.invalidateSize();
      map.fitBounds(bounds, { padding: [18, 18], maxZoom: 18 });
    };
    const frame = window.requestAnimationFrame(fit);
    const timer = window.setTimeout(fit, 120);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timer);
    };
  }, [bounds, map]);
  return null;
}

function RegionDrawController({
  mode,
  onFinish,
}: {
  mode: DrawMode | null;
  onFinish: (polygon: Polygon) => void;
}) {
  const map = useMap();

  useEffect(() => {
    if (!mode) return;
    const container = map.getContainer();
    const previousCursor = container.style.cursor;
    container.style.cursor = "crosshair";
    const draggingWasEnabled = map.dragging.enabled();
    const doubleClickZoomWasEnabled = map.doubleClickZoom.enabled();
    if (draggingWasEnabled) map.dragging.disable();
    if (doubleClickZoomWasEnabled) map.doubleClickZoom.disable();
    L.DomUtil.disableImageDrag();
    L.DomUtil.disableTextSelection();

    let drawing = false;
    let start: L.LatLng | null = null;
    let points: L.LatLng[] = [];
    let preview: L.Layer | null = null;
    let polygonGuideLine: L.Polyline | null = null;
    let polygonGuideFill: L.Polygon | null = null;
    let startMarker: L.CircleMarker | null = null;
    let vertexMarkers: L.CircleMarker[] = [];

    const toLatLng = (event: MouseEvent) => {
      const rect = container.getBoundingClientRect();
      const x = Math.max(0, Math.min(rect.width, event.clientX - rect.left));
      const y = Math.max(0, Math.min(rect.height, event.clientY - rect.top));
      return map.containerPointToLatLng(L.point(x, y));
    };

    const stopPreview = () => {
      if (preview) preview.removeFrom(map);
      if (polygonGuideLine) polygonGuideLine.removeFrom(map);
      if (polygonGuideFill) polygonGuideFill.removeFrom(map);
      for (const marker of vertexMarkers) marker.removeFrom(map);
      preview = null;
      polygonGuideLine = null;
      polygonGuideFill = null;
      startMarker = null;
      vertexMarkers = [];
    };

    const onMouseDown = (event: MouseEvent) => {
      if (mode === "polygon") return;
      if (event.button !== 0 || !container.contains(event.target as Node)) return;
      event.preventDefault();
      event.stopPropagation();
      drawing = true;
      start = toLatLng(event);
      points = [start];
      if (mode === "rectangle") {
        preview = L.rectangle(L.latLngBounds(start, start), {
          color: "#7c3aed",
          weight: 3,
          fillOpacity: 0.12,
        }).addTo(map);
      } else if (mode === "circle") {
        preview = L.circle(start, {
          radius: 0,
          color: "#7c3aed",
          weight: 3,
          fillOpacity: 0.12,
        }).addTo(map);
      } else {
        preview = L.polyline(points, { color: "#7c3aed", weight: 3 }).addTo(map);
      }
    };

    const onMouseMove = (event: MouseEvent) => {
      if (mode === "polygon") {
        if (points.length === 0 || !container.contains(event.target as Node)) return;
        const next = toLatLng(event);
        const last = points.at(-1)!;
        const canClose = points.length >= 3
          && map.latLngToContainerPoint(points[0]!).distanceTo(map.latLngToContainerPoint(next)) <= 16;
        startMarker?.setStyle({
          color: canClose ? "#ffffff" : "#7c3aed",
          fillColor: canClose ? "#7c3aed" : "#ffffff",
        });
        const guidePoints = [...points, next];
        if (!polygonGuideLine) {
          polygonGuideLine = L.polyline([last, next], {
            color: "#7c3aed",
            weight: 3,
            dashArray: "6 5",
            interactive: false,
          }).addTo(map);
        } else {
          polygonGuideLine.setLatLngs([last, next]);
        }
        if (!polygonGuideFill) {
          polygonGuideFill = L.polygon(guidePoints, {
            color: "#a78bfa",
            weight: 1.5,
            dashArray: "5 5",
            fillColor: "#8b5cf6",
            fillOpacity: 0.14,
            interactive: false,
          }).addTo(map);
        } else {
          polygonGuideFill.setLatLngs(guidePoints);
        }
        return;
      }
      if (!drawing || !preview || !start) return;
      const next = toLatLng(event);
      if (mode === "rectangle") {
        (preview as L.Rectangle).setBounds(L.latLngBounds(start, next));
      } else if (mode === "circle") {
        (preview as L.Circle).setRadius(start.distanceTo(next));
      } else {
        const last = points.at(-1)!;
        if (map.latLngToContainerPoint(last).distanceTo(map.latLngToContainerPoint(next)) < 4) return;
        points.push(next);
        (preview as L.Polyline).setLatLngs(points);
      }
    };

    const onMouseUp = (event: MouseEvent) => {
      if (!drawing || !start) return;
      event.preventDefault();
      event.stopPropagation();
      drawing = false;
      const end = toLatLng(event);
      stopPreview();
      if (mode === "rectangle") {
        onFinish(rectangleToPolygon(L.latLngBounds(start, end)));
      } else if (mode === "circle") {
        const radius = start.distanceTo(end);
        if (radius > 0) onFinish(circleToPolygon(start, radius));
      } else if (points.length >= 3) {
        onFinish(latLngsToPolygon(points));
      }
    };

    const onClick = (event: MouseEvent) => {
      if (mode !== "polygon" || !container.contains(event.target as Node)) return;
      event.preventDefault();
      event.stopPropagation();
      const next = toLatLng(event);
      const first = points[0];
      if (first && points.length >= 3
        && map.latLngToContainerPoint(first).distanceTo(map.latLngToContainerPoint(next)) <= 16) {
        stopPreview();
        onFinish(latLngsToPolygon(points));
        return;
      }
      const last = points.at(-1);
      if (last && map.latLngToContainerPoint(last).distanceTo(map.latLngToContainerPoint(next)) < 3) return;
      points.push(next);
      if (!preview) {
        preview = L.polyline(points, { color: "#7c3aed", weight: 3 }).addTo(map);
      } else {
        (preview as L.Polyline).setLatLngs(points);
      }
      const marker = L.circleMarker(next, {
        radius: points.length === 1 ? 7 : 4,
        color: "#7c3aed",
        weight: points.length === 1 ? 3 : 2,
        fillColor: "#ffffff",
        fillOpacity: 1,
        interactive: false,
      }).addTo(map);
      vertexMarkers.push(marker);
      if (points.length === 1) {
        startMarker = marker;
        marker.bindTooltip("시작점", {
          permanent: true,
          direction: "top",
          offset: L.point(0, -8),
          opacity: 0.95,
        });
      }
    };

    const onDoubleClick = (event: MouseEvent) => {
      if (mode !== "polygon" || !container.contains(event.target as Node)) return;
      event.preventDefault();
      event.stopPropagation();
      if (points.length < 3) return;
      stopPreview();
      onFinish(latLngsToPolygon(points));
    };

    window.addEventListener("mousedown", onMouseDown, true);
    window.addEventListener("mousemove", onMouseMove, true);
    window.addEventListener("mouseup", onMouseUp, true);
    window.addEventListener("click", onClick, true);
    window.addEventListener("dblclick", onDoubleClick, true);
    return () => {
      window.removeEventListener("mousedown", onMouseDown, true);
      window.removeEventListener("mousemove", onMouseMove, true);
      window.removeEventListener("mouseup", onMouseUp, true);
      window.removeEventListener("click", onClick, true);
      window.removeEventListener("dblclick", onDoubleClick, true);
      stopPreview();
      if (draggingWasEnabled && !map.dragging.enabled()) map.dragging.enable();
      if (doubleClickZoomWasEnabled && !map.doubleClickZoom.enabled()) map.doubleClickZoom.enable();
      L.DomUtil.enableImageDrag();
      L.DomUtil.enableTextSelection();
      container.style.cursor = previousCursor;
    };
  }, [map, mode, onFinish]);

  return null;
}

function taskResourceIds(task: Task, side: ImagerySide): number[] {
  const many = side === "standard" ? task.standard_resource_ids : task.compare_resource_ids;
  const single = side === "standard" ? task.standard_resource_id : task.compare_resource_id;
  return many.length > 0 ? many : single == null ? [] : [single];
}

function fulfilledDatasets(results: PromiseSettledResult<Dataset>[]): Dataset[] {
  return results.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
}

function rejectedCount(results: PromiseSettledResult<Dataset>[]): number {
  return results.filter((result) => result.status === "rejected").length;
}

function datasetGroupLabel(label: string, datasets: Dataset[]): string {
  if (datasets.length === 0) return `${label} 정사영상 없음`;
  return `${label}: ${datasets.map((dataset) => dataset.display_name).join(" · ")}`;
}

function latLngsToPolygon(latLngs: L.LatLng[]): Polygon {
  const coordinates = latLngs.map((point) => [point.lng, point.lat] as [number, number]);
  coordinates.push(coordinates[0]!);
  return { type: "Polygon", coordinates: [coordinates] };
}

function rectangleToPolygon(bounds: L.LatLngBounds): Polygon {
  const west = bounds.getWest();
  const east = bounds.getEast();
  const south = bounds.getSouth();
  const north = bounds.getNorth();
  return {
    type: "Polygon",
    coordinates: [[
      [west, south],
      [east, south],
      [east, north],
      [west, north],
      [west, south],
    ]],
  };
}

function circleToPolygon(center: L.LatLng, radiusM: number): Polygon {
  const earthRadiusM = 6_378_137;
  const angularDistance = radiusM / earthRadiusM;
  const latitude = center.lat * Math.PI / 180;
  const longitude = center.lng * Math.PI / 180;
  const coordinates: [number, number][] = [];
  for (let index = 0; index < 64; index += 1) {
    const bearing = (index / 64) * Math.PI * 2;
    const lat = Math.asin(
      Math.sin(latitude) * Math.cos(angularDistance)
      + Math.cos(latitude) * Math.sin(angularDistance) * Math.cos(bearing),
    );
    const lng = longitude + Math.atan2(
      Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(latitude),
      Math.cos(angularDistance) - Math.sin(latitude) * Math.sin(lat),
    );
    coordinates.push([lng * 180 / Math.PI, lat * 180 / Math.PI]);
  }
  coordinates.push(coordinates[0]!);
  return { type: "Polygon", coordinates: [coordinates] };
}

function mapBounds(
  geometry: Polygon | MultiPolygon | null,
  detections: DetectionObject[],
): L.LatLngBoundsExpression {
  const points: Array<[number, number]> = [];
  if (geometry) {
    const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
    for (const polygon of polygons) {
      for (const ring of polygon) {
        for (const [lng, lat] of ring) points.push([lat, lng]);
      }
    }
  }
  if (points.length === 0) {
    for (const detection of detections) {
      for (const ring of detection.geometry.coordinates) {
        for (const [lng, lat] of ring) points.push([lat, lng]);
      }
    }
  }
  return points.length > 0 ? L.latLngBounds(points) : [[33, 124], [39, 132]];
}

interface Export3dStats {
  total_objects: number;
  sheets_used: string[];
  missing_sheets: string[];
  objects_with_nodata: string[];
}

async function executeTaskExport(
  taskId: string,
  kind: ExportKind,
  saveTarget: ExportSaveTarget,
  objectIds?: string[],
): Promise<Export3dStats | null> {
  const mod = await import("@/services/exporters");
  if (kind === "shp") {
    await mod.exportTaskAsShp(taskId, saveTarget, objectIds);
    return null;
  }
  if (kind === "dxf") {
    await mod.exportTaskAsDxf(taskId, saveTarget, objectIds);
    return null;
  }
  if (kind === "pdf") {
    await mod.exportTaskAsPdf(taskId, undefined, saveTarget, objectIds);
    return null;
  }
  return await mod.exportTaskAs3dDxf(taskId, "CHANGE_DETECTION", saveTarget, objectIds);
}

function showExportSuccess(
  kind: ExportKind,
  stats: Export3dStats | null,
  toastId: string,
  selectedCount?: number,
): void {
  const countNote = selectedCount == null ? "" : ` · 관심지역 ${selectedCount}건`;
  if (kind !== "dxf3d" || !stats) {
    toast.success(`${EXPORT_META[kind].label} 저장 요청 완료${countNote}`, { id: toastId });
    return;
  }
  const nodataNote = stats.objects_with_nodata.length > 0
    ? ` — ${stats.objects_with_nodata.length}개 객체에 NoData vertex 포함`
    : "";
  const missingNote = stats.missing_sheets.length > 0
    ? ` (DEM 누락 도엽 ${stats.missing_sheets.length}건)`
    : "";
  toast.success(
    `3D DXF 저장 요청 완료 — ${stats.total_objects}객체 / ${stats.sheets_used.length}도엽${missingNote}${nodataNote}`,
    { id: toastId, duration: 6000 },
  );
}

function normalizeExportFilename(value: string, kind: ExportKind): string | null {
  const clean = value.trim().replace(/[\\/:*?"<>|]/g, "_");
  if (!clean) return null;
  const ext = EXPORT_META[kind].ext;
  if (clean.toLowerCase().endsWith(ext)) return clean;
  return `${clean.replace(/\.[^.]*$/, "")}${ext}`;
}

function getExportFilename(task: Task, kind: ExportKind, region: boolean): string {
  const filename = getDefaultTaskExportFilename(task, kind);
  if (!region) return filename;
  const extensionIndex = filename.lastIndexOf(".");
  return extensionIndex < 0
    ? `${filename}_roi`
    : `${filename.slice(0, extensionIndex)}_roi${filename.slice(extensionIndex)}`;
}
