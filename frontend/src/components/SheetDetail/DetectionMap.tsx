import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  GeoJSON,
  MapContainer,
  TileLayer,
  ZoomControl,
  useMap,
  useMapEvent,
} from "react-leaflet";
import type {
  GeoJSON as LeafletGeoJSON,
  PathOptions,
  FeatureGroup as LeafletFeatureGroup,
} from "leaflet";
import L from "leaflet";
import "leaflet-draw";
import type { Feature, FeatureCollection, MultiPolygon, Polygon } from "geojson";
import {
  useFilteredDetections,
  useSheetDetailStore,
  type RightPanelMode,
} from "@/stores/sheetDetailStore";
import { CHANGE_TYPE_BY_CODE } from "@/utils/constants";
import { bboxToLeafletBounds } from "@/utils/geoUtils";
import type { Dataset, DetectionObject } from "@/types";
import { ViewerModeToolbar } from "./ViewerModeToolbar";
import { MapToolbar } from "./MapToolbar";
import { cn } from "@/utils/cn";

/**
 * /sheets/:sheetCode 의 핵심 지도.
 *
 * 4종 뷰어 모드:
 *   - single:   단일 지도
 *   - split:    좌·우 분할 (각 MapContainer, view 동기화)
 *   - swipe-x:  가로 스와이프 셔터 (시각 분할)
 *   - swipe-y:  세로 스와이프 셔터 (시각 분할)
 *
 * mock 단계: 양쪽 지도/셔터 모두 OSM 동일 타일. 좌="과년도 (2022)" / 우="당해년도 (2024)"
 * 라벨로 구분만 표시. 이정표 5에서 실 영상 TileLayer 로 swap.
 *
 * 편집 도구 (MapToolbar) 와 연동하여 leaflet-draw 활성화.
 */
/** Map view state — 모든 모드(single/split/swipe) 공유. 모드 전환 시에도 유지. */
export interface ViewState {
  center: [number, number];
  zoom: number;
}

// RightPanel.tsx 의 폭과 맞춘다. 리포트 패널은 더 넓어 지도/줌 컨트롤이
// 패널 아래로 들어가지 않도록 mode 별 inset 을 계산한다.
const INFO_PANEL_WIDTH = 440;
const REPORT_PANEL_WIDTH = 600;

function rightPanelInset(mode: RightPanelMode): number {
  if (mode === "report") return REPORT_PANEL_WIDTH;
  if (mode === "info") return INFO_PANEL_WIDTH;
  return 0;
}

export function DetectionMap() {
  const sheet = useSheetDetailStore((s) => s.sheet)!;
  const processingGeometry = useSheetDetailStore(
    (s) => s.task?.processing_geometry ?? null,
  );
  const mode = useSheetDetailStore((s) => s.viewerMode);
  const rightPanel = useSheetDetailStore((s) => s.rightPanel);
  const panelInset = rightPanelInset(rightPanel);
  // view state 를 DetectionMap 에서 보유 → 모드 컴포넌트가 unmount 돼도 보존.
  // 모드 전환 시 새 컴포넌트가 같은 view 로 mount.
  const [view, setView] = useState<ViewState | null>(null);
  const processingExtent = useMemo(
    () => processingGeometryExtent(processingGeometry),
    [processingGeometry],
  );
  const initialBbox = processingExtent ?? sheet.bbox;

  return (
    <div
      className="absolute top-0 bottom-0 left-0 transition-[right] duration-200 ease-out"
      style={{ right: panelInset }}
    >
      {mode === "single" ? (
        <SingleMap
          initialBbox={initialBbox}
          resultBoundary={processingGeometry}
          view={view}
          setView={setView}
        />
      ) : mode === "split" ? (
        <SplitMap
          initialBbox={initialBbox}
          resultBoundary={processingGeometry}
          view={view}
          setView={setView}
        />
      ) : mode === "swipe-x" ? (
        <SwipeMap
          initialBbox={initialBbox}
          resultBoundary={processingGeometry}
          axis="x"
          view={view}
          setView={setView}
        />
      ) : (
        <SwipeMap
          initialBbox={initialBbox}
          resultBoundary={processingGeometry}
          axis="y"
          view={view}
          setView={setView}
        />
      )}
      <ViewerModeToolbar />
      <MapToolbar />
    </div>
  );
}

interface MapModeProps {
  view: ViewState | null;
  setView: (v: ViewState) => void;
  resultBoundary: Polygon | MultiPolygon | null;
}

// ============================================================
// 모드 1: single — 당해년도 기본 표시. 당해년도가 없으면 과년도, 둘 다 없으면 OSM.
// ============================================================
function SingleMap({
  initialBbox,
  resultBoundary,
  view,
  setView,
}: { initialBbox: [number, number, number, number] } & MapModeProps) {
  const initialBounds = useMemo(
    () => bboxToLeafletBounds(initialBbox),
    [initialBbox],
  );
  const stdDatasets = useSheetDetailStore((s) => s.standardDatasets);
  const cmpDatasets = useSheetDetailStore((s) => s.compareDatasets);
  const topDatasets = cmpDatasets.length > 0 ? cmpDatasets : stdDatasets;
  const topSide = cmpDatasets.length > 0 ? "compare" : "standard";
  const label = datasetGroupLabel(
    topSide === "compare" ? "당해년도" : "과년도",
    topDatasets,
  );

  return (
    <MapContainer
      bounds={view ? undefined : initialBounds}
      center={view?.center}
      zoom={view?.zoom}
      maxZoom={21}
      className="h-full w-full"
      zoomControl={false}
      preferCanvas
    >
      <ZoomControl position="topright" />
      <BaseTile />
      <DatasetTileLayers datasets={topDatasets} />
      <DatasetFootprintBoundaryLayer datasets={topDatasets} side={topSide} />
      <ProcessingIntersectionBoundaryLayer geometry={resultBoundary} />
      <ResourceLabel position="bottom-left" text={label} />
      <DetectionsLayer />
      <DrawController />
      <EditController />
      <LassoBoxController />
      <EmptyClickClearController />
      <DeletionMarkersLayer />
      <ViewSync onView={setView} view={view} />
      <SelectionFlyController />
    </MapContainer>
  );
}

// ============================================================
// MapRegister + useSyncedWheelZoom — split/swipe 모드에서 양 map 동시 줌.
//
// 각 MapContainer 의 leaflet 내장 scrollWheelZoom 비활성화 후, wrapper div 가
// wheel event 가로채서 등록된 모든 map 에 동시에 setZoomAround(latlng, newZoom)
// 호출. ViewSync 의 pan 동기화는 그대로 유지.
// ============================================================
// 같은 SplitMap/SwipeMap 안의 모든 leaflet map 인스턴스를 자식 controller 에 노출.
// EditController 가 다른 panel 의 polygon 에 setLatLngs 미러링하는 데 사용.
const MapsContext = createContext<L.Map[]>([]);

function MapRegister({ register }: { register: (m: L.Map) => () => void }) {
  const map = useMap();
  useEffect(() => {
    return register(map);
  }, [map, register]);
  return null;
}

function useSyncedWheelZoom() {
  // state 사용 — maps 변경 시 context 도 갱신되어 자식들이 새 list 받음.
  const [maps, setMaps] = useState<L.Map[]>([]);
  const register = useCallback((m: L.Map) => {
    setMaps((prev) => (prev.includes(m) ? prev : [...prev, m]));
    return () => {
      setMaps((prev) => prev.filter((x) => x !== m));
    };
  }, []);
  // wheel handler 내부에서도 maps 사용 가능하도록 ref mirror 유지.
  const mapsRef = useRef<L.Map[]>([]);
  useEffect(() => {
    mapsRef.current = maps;
  }, [maps]);

  // ref callback — 반환된 ref 를 wrapper div 에 부착. React onWheel 은 passive
  // listener 라 preventDefault 가 안 먹힘 → native addEventListener(passive:false).
  const attachRef = useCallback((node: HTMLElement | null) => {
    if (!node) return;
    const handler = (e: WheelEvent) => {
      if (mapsRef.current.length === 0) return;
      e.preventDefault(); // 브라우저 기본 scroll·pan 차단
      e.stopPropagation();
      // 휠 위 (deltaY < 0) = 줌인, 휠 아래 = 줌아웃. leaflet 기본과 동일하게 1 step.
      const delta = e.deltaY < 0 ? 1 : -1;

      // 마우스 포인터가 실제로 어느 map 컨테이너 위에 있는지 hit-test.
      // 첫 map 의 rect 만 쓰면 split/swipe 모드에서 당해년도 위 휠이 잘못된 좌표로
      // 잡혀 엉뚱한 위치를 기준으로 줌됨.
      let hitMap: L.Map = mapsRef.current[0]!;
      for (const m of mapsRef.current) {
        const r = m.getContainer().getBoundingClientRect();
        if (
          e.clientX >= r.left &&
          e.clientX <= r.right &&
          e.clientY >= r.top &&
          e.clientY <= r.bottom
        ) {
          hitMap = m;
          break;
        }
      }
      const rect = hitMap.getContainer().getBoundingClientRect();
      const containerPoint = L.point(
        e.clientX - rect.left,
        e.clientY - rect.top,
      );
      const targetLatLng = hitMap.containerPointToLatLng(containerPoint);
      const currentZoom = hitMap.getZoom();
      const newZoom = Math.max(
        hitMap.getMinZoom(),
        Math.min(hitMap.getMaxZoom(), currentZoom + delta),
      );
      if (newZoom === currentZoom) return;

      // 등록된 모든 map 에 동시 setZoomAround → 같은 frame 에 transition 시작.
      // 모든 map 의 view 가 ViewSync 로 동기화되어 있으므로 같은 latlng 적용.
      for (const m of mapsRef.current) {
        m.setZoomAround(targetLatLng, newZoom, { animate: true });
      }
    };
    // passive:false 로 preventDefault 가능. capture phase 로 leaflet 보다 먼저.
    node.addEventListener("wheel", handler, { passive: false, capture: true });
    // 부착된 node 자체에 cleanup 정보 저장 (re-attach 시 leak 방지)
    (
      node as HTMLElement & { __nbmWheelCleanup?: () => void }
    ).__nbmWheelCleanup = () => {
      node.removeEventListener("wheel", handler, { capture: true });
    };
  }, []);

  return { register, wrapperRef: attachRef, maps };
}

// ============================================================
// 모드 2: split (좌우 두 MapContainer + view 동기화)
// ============================================================
function SplitMap({
  initialBbox,
  resultBoundary,
  view,
  setView,
}: { initialBbox: [number, number, number, number] } & MapModeProps) {
  const initialBounds = useMemo(
    () => bboxToLeafletBounds(initialBbox),
    [initialBbox],
  );
  const stdDatasets = useSheetDetailStore((s) => s.standardDatasets);
  const cmpDatasets = useSheetDetailStore((s) => s.compareDatasets);

  const stdLabel = datasetGroupLabel("과년도", stdDatasets);
  const cmpLabel = datasetGroupLabel("당해년도", cmpDatasets);

  // 양 map 의 wheel-zoom 동시 처리 + maps context 제공
  const { register, wrapperRef, maps } = useSyncedWheelZoom();

  return (
    <MapsContext.Provider value={maps}>
      <div ref={wrapperRef} className="h-full w-full flex relative">
        {/* 좌측: 과년도. SelectionFlyController 는 한쪽 panel 에서만 — 다른 쪽은 ViewSync 로 따라옴. */}
        <div className="basis-1/2 min-w-0 relative">
          <MapContainer
            bounds={view ? undefined : initialBounds}
            center={view?.center}
            zoom={view?.zoom}
            maxZoom={21}
            className="h-full w-full"
            zoomControl={false}
            scrollWheelZoom={false}
            preferCanvas
          >
            <MapRegister register={register} />
            <BaseTile />
            <DatasetTileLayers datasets={stdDatasets} />
            <DatasetFootprintBoundaryLayer
              datasets={stdDatasets}
              side="standard"
            />
            <ProcessingIntersectionBoundaryLayer geometry={resultBoundary} />
            <DetectionsLayer />
            <DrawController />
            <EditController />
            <LassoBoxController />
            <EmptyClickClearController />
            <DeletionMarkersLayer />
            <ViewSync onView={setView} view={view} />
            <SelectionFlyController />
          </MapContainer>
          <PanelLabel text={stdLabel} />
        </div>
        {/* 우측: 당해년도. ZoomControl 은 화면 오른쪽 끝에 두기. */}
        <div className="basis-1/2 min-w-0 relative">
          <MapContainer
            bounds={view ? undefined : initialBounds}
            center={view?.center}
            zoom={view?.zoom}
            maxZoom={21}
            className="h-full w-full"
            zoomControl={false}
            scrollWheelZoom={false}
            preferCanvas
          >
            <MapRegister register={register} />
            <ZoomControl position="topright" />
            <BaseTile />
            <DatasetTileLayers datasets={cmpDatasets} />
            <DatasetFootprintBoundaryLayer
              datasets={cmpDatasets}
              side="compare"
            />
            <ProcessingIntersectionBoundaryLayer geometry={resultBoundary} />
            <DetectionsLayer />
            <DrawController />
            <EditController />
            <LassoBoxController />
            <EmptyClickClearController />
            <DeletionMarkersLayer />
            <ViewSync onView={setView} view={view} />
          </MapContainer>
          <PanelLabel text={cmpLabel} />
        </div>
        <SplitCenterDivider />
      </div>
    </MapsContext.Provider>
  );
}

function SplitCenterDivider() {
  return (
    <div
      aria-hidden
      className="absolute inset-y-0 left-1/2 z-[460] w-[4px] -translate-x-1/2 pointer-events-none bg-white shadow-[0_0_0_1px_rgba(15,23,42,0.2)]"
    />
  );
}

function ViewSync({
  view,
  onView,
}: {
  view: { center: [number, number]; zoom: number } | null;
  onView: (v: { center: [number, number]; zoom: number }) => void;
}) {
  const map = useMap();
  const maps = useContext(MapsContext); // 같은 SplitMap/SwipeMap 안의 다른 panel map(s)
  // 자기가 외부에서 setView 받았는지 표시 — feedback loop 방지.
  const externalRef = useRef(false);

  // 외부 view 변경 → 본 map 적용 (외부 fly 등 React 경유 update 만)
  useEffect(() => {
    if (!view) return;
    const cur = map.getCenter();
    if (
      Math.abs(cur.lat - view.center[0]) > 1e-6 ||
      Math.abs(cur.lng - view.center[1]) > 1e-6 ||
      map.getZoom() !== view.zoom
    ) {
      externalRef.current = true;
      map.setView(view.center, view.zoom, { animate: false });
      setTimeout(() => {
        externalRef.current = false;
      }, 0);
    }
  }, [view, map]);

  // ----- 빠른 cross-panel 동기화 (drag/zoom 중 React state 우회) -----
  // 이전 구조: map move → onView(React state) → 다른 panel useEffect → setView.
  //   문제: React re-render 가 매 픽셀마다 발생 → 다른 panel 의 sync 가 한
  //   frame 정도 늦음. 큰 영상에서 더 도드라짐.
  // 변경: move 이벤트 시 같은 SplitMap/SwipeMap 안의 다른 map(s) 에 직접
  //   setView(animate:false) 호출. React state 는 안 거치고 frame 안에 sync 완료.
  //   externalRef 가드로 무한 loop 방지.
  const syncSiblings = useCallback(() => {
    if (externalRef.current) return;
    const c = map.getCenter();
    const z = map.getZoom();
    for (const m of maps) {
      if (m === map) continue;
      const mc = m.getCenter();
      // 이미 거의 같으면 setView 호출 안 함 (불필요한 redraw 방지).
      if (
        Math.abs(mc.lat - c.lat) < 1e-7 &&
        Math.abs(mc.lng - c.lng) < 1e-7 &&
        m.getZoom() === z
      ) {
        continue;
      }
      // 다른 panel 의 ViewSync 가 다시 syncSiblings 호출하지 않도록 flag set.
      const otherSync = (
        m as L.Map & { __nbmExternalRef?: { current: boolean } }
      ).__nbmExternalRef;
      if (otherSync) otherSync.current = true;
      m.setView([c.lat, c.lng], z, { animate: false });
      if (otherSync) {
        setTimeout(() => {
          otherSync.current = false;
        }, 0);
      }
    }
  }, [map, maps]);

  // 본 map 의 externalRef 를 maps 객체에 노출 — 다른 panel 이 sync 호출 시
  // 본 panel 의 move handler 를 잠시 무력화하는 데 사용.
  useEffect(() => {
    (
      map as L.Map & { __nbmExternalRef?: { current: boolean } }
    ).__nbmExternalRef = externalRef;
    return () => {
      delete (map as L.Map & { __nbmExternalRef?: { current: boolean } })
        .__nbmExternalRef;
    };
  }, [map]);

  useMapEvent("move", syncSiblings);
  useMapEvent("zoom", syncSiblings);
  // moveend 에서만 React state 업데이트 — fly controller 등이 안정 좌표를 받음.
  useMapEvent("moveend", () => {
    if (externalRef.current) return;
    const c = map.getCenter();
    onView({ center: [c.lat, c.lng], zoom: map.getZoom() });
  });
  useMapEvent("zoomend", () => {
    if (externalRef.current) return;
    const c = map.getCenter();
    onView({ center: [c.lat, c.lng], zoom: map.getZoom() });
  });

  return null;
}

// ============================================================
// 모드 3·4: swipe (X 또는 Y 축 셔터)
//
// 2 MapContainer + ViewSync (split 모드와 동일 구조) + wrapper div 에 clip-path.
// 단일 MapContainer + leaflet pane clip 방식은 pane 생성 타이밍·zIndex 등 함정이
// 많아 안정성 떨어짐. 두 지도가 같은 view 를 공유하면서 wrapper 만 잘라 보여주는
// 방식이 가장 견고함. 타일은 브라우저 캐시로 거의 무비용 재사용.
//
// 레이아웃 (X axis):
//   당해년도: top:0  left:0    right:auto width: position%
//   과년도: top:0  left:position%  right:0    width: 100-position%
// (Y axis 는 top/bottom 으로 동일 구조)
// ============================================================
function SwipeMap({
  initialBbox,
  resultBoundary,
  axis,
  view,
  setView,
}: {
  initialBbox: [number, number, number, number];
  axis: "x" | "y";
} & MapModeProps) {
  const initialBounds = useMemo(
    () => bboxToLeafletBounds(initialBbox),
    [initialBbox],
  );
  const stdDatasets = useSheetDetailStore((s) => s.standardDatasets);
  const cmpDatasets = useSheetDetailStore((s) => s.compareDatasets);
  const stdLabel = datasetGroupLabel("과년도", stdDatasets);
  const cmpLabel = datasetGroupLabel("당해년도", cmpDatasets);

  // 셔터 위치 — React state 미사용. drag 중 매 mousemove 마다 re-render 하면
  // MapContainer props 가 변해 시각이 끊김. ref 로 직접 DOM mutation 만.
  const containerRef = useRef<HTMLDivElement | null>(null);
  const t2WrapRef = useRef<HTMLDivElement>(null);
  const t1WrapRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<HTMLDivElement>(null);
  const positionRef = useRef(50); // %

  // 양 map 동시 줌 + maps context
  const { register, wrapperRef, maps } = useSyncedWheelZoom();

  // containerRef (셔터 드래그용) + wrapperRef (wheel listener 부착) 합치기
  const setRefs = useCallback(
    (node: HTMLDivElement | null) => {
      containerRef.current = node;
      wrapperRef(node);
    },
    [wrapperRef],
  );

  // 초기 위치 적용 + 모드(axis) 변경 시 재적용
  // 과년도 영상은 LEFT/TOP, 당해년도 영상은 RIGHT/BOTTOM 영역에 위치.
  const applyPosition = (pct: number) => {
    positionRef.current = pct;
    const t1 = t1WrapRef.current;
    const t2 = t2WrapRef.current;
    const h = handleRef.current;
    if (!t2 || !t1 || !h) return;
    if (axis === "x") {
      const leftClip = `inset(0 ${100 - pct}% 0 0)`;
      const rightClip = `inset(0 0 0 ${pct}%)`;
      t1.style.clipPath = leftClip;
      (
        t1.style as CSSStyleDeclaration & { webkitClipPath?: string }
      ).webkitClipPath = leftClip;
      t2.style.clipPath = rightClip;
      (
        t2.style as CSSStyleDeclaration & { webkitClipPath?: string }
      ).webkitClipPath = rightClip;
      h.style.left = `calc(${pct}% - 2px)`;
    } else {
      const topClip = `inset(0 0 ${100 - pct}% 0)`;
      const bottomClip = `inset(${pct}% 0 0 0)`;
      t1.style.clipPath = topClip;
      (
        t1.style as CSSStyleDeclaration & { webkitClipPath?: string }
      ).webkitClipPath = topClip;
      t2.style.clipPath = bottomClip;
      (
        t2.style as CSSStyleDeclaration & { webkitClipPath?: string }
      ).webkitClipPath = bottomClip;
      h.style.top = `calc(${pct}% - 2px)`;
    }
  };

  useEffect(() => {
    applyPosition(50);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [axis]);

  const onDrag = (e: React.MouseEvent | React.TouchEvent) => {
    const container = containerRef.current;
    if (!container) return;
    // 텍스트 selection·기본 동작 차단 — drag 중 라벨 텍스트가 끌리는 현상 방지
    e.preventDefault();
    const prevUserSelect = document.body.style.userSelect;
    const prevCursor = document.body.style.cursor;
    document.body.style.userSelect = "none";
    document.body.style.cursor = axis === "x" ? "col-resize" : "row-resize";

    const rect = container.getBoundingClientRect();
    let rafId: number | null = null;
    let nextPct = positionRef.current;
    const flush = () => {
      rafId = null;
      applyPosition(nextPct);
    };
    const handleMove = (ev: MouseEvent | TouchEvent) => {
      ev.preventDefault();
      const point = "touches" in ev ? ev.touches[0]! : (ev as MouseEvent);
      const px =
        axis === "x" ? point.clientX - rect.left : point.clientY - rect.top;
      const total = axis === "x" ? rect.width : rect.height;
      nextPct = Math.max(5, Math.min(95, (px / total) * 100));
      // rAF 로 throttle — 60Hz 이상 mousemove 도 frame 당 1회 DOM 갱신.
      if (rafId === null) rafId = requestAnimationFrame(flush);
    };
    const handleUp = () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      document.body.style.userSelect = prevUserSelect;
      document.body.style.cursor = prevCursor;
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
      window.removeEventListener("touchmove", handleMove);
      window.removeEventListener("touchend", handleUp);
    };
    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
    // touchmove 는 passive: false 로 등록해 preventDefault 가능 (scroll 차단)
    window.addEventListener("touchmove", handleMove, { passive: false });
    window.addEventListener("touchend", handleUp);
  };

  return (
    <MapsContext.Provider value={maps}>
      <div ref={setRefs} className="h-full w-full relative overflow-hidden">
        {/* 과년도 — 셔터 기준 LEFT/TOP 영역. clip-path 로 가려진 부분은
          브라우저가 pointer-events 도 자르므로, 보이는 영역에서만 폴리곤 클릭됨. */}
        <div
          ref={t1WrapRef}
          className="absolute inset-0"
          style={
            axis === "x"
              ? {
                  clipPath: "inset(0 50% 0 0)",
                  WebkitClipPath: "inset(0 50% 0 0)",
                }
              : {
                  clipPath: "inset(0 0 50% 0)",
                  WebkitClipPath: "inset(0 0 50% 0)",
                }
          }
        >
          <MapContainer
            bounds={view ? undefined : initialBounds}
            center={view?.center}
            zoom={view?.zoom}
            maxZoom={21}
            className="h-full w-full"
            zoomControl={false}
            scrollWheelZoom={false}
            preferCanvas
          >
            <MapRegister register={register} />
            <BaseTile />
            <DatasetTileLayers datasets={stdDatasets} />
            <DatasetFootprintBoundaryLayer
              datasets={stdDatasets}
              side="standard"
            />
            <ProcessingIntersectionBoundaryLayer geometry={resultBoundary} />
            <DetectionsLayer />
            <DrawController />
            <EditController />
            <LassoBoxController />
            <EmptyClickClearController />
            <DeletionMarkersLayer />
            <ViewSync onView={setView} view={view} />
          </MapContainer>
        </div>

        {/* 당해년도 — 모든 편집 controller. 셔터 기준 RIGHT/BOTTOM 영역.
          preferCanvas=true — 폴리곤 canvas 렌더링으로 성능 우선. */}
        <div
          ref={t2WrapRef}
          className="absolute inset-0"
          style={
            axis === "x"
              ? {
                  clipPath: "inset(0 0 0 50%)",
                  WebkitClipPath: "inset(0 0 0 50%)",
                }
              : {
                  clipPath: "inset(50% 0 0 0)",
                  WebkitClipPath: "inset(50% 0 0 0)",
                }
          }
        >
          <MapContainer
            bounds={view ? undefined : initialBounds}
            center={view?.center}
            zoom={view?.zoom}
            maxZoom={21}
            className="h-full w-full"
            zoomControl={false}
            scrollWheelZoom={false}
            preferCanvas
          >
            <MapRegister register={register} />
            <ZoomControl position="topright" />
            <BaseTile />
            <DatasetTileLayers datasets={cmpDatasets} />
            <DatasetFootprintBoundaryLayer
              datasets={cmpDatasets}
              side="compare"
            />
            <ProcessingIntersectionBoundaryLayer geometry={resultBoundary} />
            <DetectionsLayer />
            <DrawController />
            <EditController />
            <LassoBoxController />
            <EmptyClickClearController />
            <DeletionMarkersLayer />
            <SelectionFlyController />
            <ViewSync onView={setView} view={view} />
          </MapContainer>
        </div>

        {/* 라벨 — X 스와이프는 각 영역 상단 중앙, Y 스와이프는 각 영상 우상단. */}
        <div
          className="absolute pointer-events-none z-[400] max-w-[45%] whitespace-normal break-words text-center text-sm leading-5 font-bold px-3 py-1.5 rounded-md bg-white/95 border-2 border-red-500 shadow-sm text-slate-700"
          style={
            axis === "x"
              ? { top: 12, left: "25%", transform: "translateX(-50%)" }
              : { top: 12, right: 12 }
          }
        >
          {stdLabel}
        </div>
        <div
          className="absolute pointer-events-none z-[400] max-w-[45%] whitespace-normal break-words text-center text-sm leading-5 font-bold px-3 py-1.5 rounded-md bg-white/95 border-2 border-red-500 shadow-sm text-slate-700"
          style={
            axis === "x"
              ? { top: 12, left: "75%", transform: "translateX(-50%)" }
              : { top: "calc(50% + 12px)", right: 12 }
          }
        >
          {cmpLabel}
        </div>

        {/* 셔터 (drag handle) */}
        <div
          ref={handleRef}
          role="separator"
          aria-orientation={axis === "x" ? "vertical" : "horizontal"}
          onMouseDown={onDrag}
          onTouchStart={onDrag}
          className={cn(
            "absolute z-[450] bg-blue-600/90 hover:bg-blue-700 transition-colors",
            axis === "x"
              ? "top-0 bottom-0 w-1 cursor-col-resize"
              : "left-0 right-0 h-1 cursor-row-resize",
          )}
          style={
            axis === "x"
              ? { left: "calc(50% - 2px)" }
              : { top: "calc(50% - 2px)" }
          }
        >
          <div
            className={cn(
              "absolute bg-blue-600 rounded-full shadow-lg flex items-center justify-center ring-2 ring-white",
              axis === "x"
                ? "top-1/2 -translate-y-1/2 -left-4 w-9 h-14"
                : "left-1/2 -translate-x-1/2 -top-4 h-9 w-14",
            )}
          >
            <span className="text-white text-sm font-bold select-none">
              {axis === "x" ? "↔" : "↕"}
            </span>
          </div>
        </div>
      </div>
    </MapsContext.Provider>
  );
}

// ============================================================
// 공용 — 베이스 타일 + 라벨 + 폴리곤 + 마커 + draw
// ============================================================

/** 과년도/당해년도 원본 정사영상 각각의 footprint 점선 외곽선. */
function DatasetFootprintBoundaryLayer({
  datasets,
  side,
}: {
  datasets: Dataset[];
  side: "standard" | "compare";
}) {
  const featureCollection = useMemo<FeatureCollection<Polygon>>(
    () => ({
      type: "FeatureCollection",
      features: datasets
        .filter((dataset) => dataset.bbox.coordinates[0]?.length > 0)
        .map((dataset) => ({
          type: "Feature",
          properties: {
            datasetId: dataset.id,
            displayName: dataset.display_name,
            side,
          },
          geometry: dataset.bbox,
        })),
    }),
    [datasets, side],
  );

  if (featureCollection.features.length === 0) return null;
  const color = side === "standard" ? "#0066ff" : "#00c853";
  const boundaryKey = `${side}-${datasets.map((dataset) => dataset.id).join("-")}`;

  return (
    <GeoJSON
      key={boundaryKey}
      data={featureCollection}
      style={{
        color,
        weight: 3.5,
        opacity: 1,
        fill: false,
        fillOpacity: 0,
        dashArray: "8,5",
        interactive: false,
      }}
      eventHandlers={{}}
      pane="overlayPane"
    />
  );
}

/** 과년도·당해년도 영상 묶음이 실제로 교차하는 처리영역 외곽선. */
function ProcessingIntersectionBoundaryLayer({
  geometry,
}: {
  geometry: Polygon | MultiPolygon | null;
}) {
  const feature = useMemo<Feature<Polygon | MultiPolygon> | null>(
    () =>
      geometry
        ? {
            type: "Feature",
            properties: { kind: "detection-result-boundary" },
            geometry,
          }
        : null,
    [geometry],
  );

  if (!feature) return null;
  const boundaryKey = JSON.stringify(feature.geometry.coordinates);
  return (
    <GeoJSON
      key={boundaryKey}
      data={feature}
      style={{
        color: "#f59e0b",
        weight: 3,
        opacity: 1,
        fill: false,
        fillOpacity: 0,
        dashArray: "7,4",
        interactive: false,
      }}
      // 결과 외곽선은 클릭을 받지 않아 detection 선택을 가로채지 않는다.
      eventHandlers={{}}
      pane="overlayPane"
    />
  );
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
      for (const position of ring) {
        const [lng, lat] = position;
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

function BaseTile() {
  // VWorld 오프라인 베이스맵 (호스트 vworld_tiles, EPSG:3857, z=5~16).
  // 정사영상 위에 겹쳐 보이도록 maxNativeZoom=16 으로 고정하고, z>16 은 leaflet 이
  // upscale 표시. 정사영상이 없는 영역의 배경 가독성 확보용.
  return (
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
  );
}

function DatasetTileLayers({ datasets }: { datasets: Dataset[] }) {
  return (
    <>
      {datasets.map((dataset, index) =>
        dataset.tile_path ? (
          <TitilerLayer
            key={dataset.id}
            tilePath={dataset.tile_path}
            zIndex={50 + index}
          />
        ) : null,
      )}
    </>
  );
}

function datasetGroupLabel(label: string, datasets: Dataset[]): string {
  if (datasets.length === 0) return label;
  return `${label}: ${datasets.map((dataset) => dataset.display_name).join(" · ")}`;
}

/**
 * TiTiler 가 서빙하는 COG 타일 — 업로드된 정사영상을 지도 위에 겹쳐 표시.
 *
 *  tilePath 는 dataset.tile_path (예: /data/orthomosaic/xxx.tif)
 *  TiTiler URL 패턴: /titiler/cog/tiles/WebMercatorQuad/{z}/{x}/{y}.png?url=file://{tilePath}
 *
 * 형식: PNG (RGBA). nodata/외곽 영역이 알파로 투명 처리되어 검은 여백 X.
 *   JPG 가 더 작지만 알파 미지원이라 가장자리에 검은 박스가 노출됨 → PNG 사용.
 *
 * 성능 옵션:
 *   - keepBuffer=4 — 화면 밖 4 줄 타일을 캐시 유지해 드래그 시 재요청 ↓.
 *   - updateWhenZooming=false — 줌 진행 중 타일 갱신 보류 (CPU/네트워크 폭주 방지).
 *   - updateWhenIdle=true — pan/zoom 끝난 뒤에만 새 타일 요청.
 *   - TiTiler 응답에 Cache-Control max-age=3600 → 브라우저 1시간 캐시.
 */
function TitilerLayer({
  tilePath,
  opacity = 1,
  zIndex = 50,
}: {
  tilePath: string;
  opacity?: number;
  zIndex?: number;
}) {
  const url = `/titiler/cog/tiles/WebMercatorQuad/{z}/{x}/{y}.png?url=${encodeURIComponent(`file://${tilePath}`)}`;
  return (
    <TileLayer
      url={url}
      tileSize={256}
      maxZoom={21}
      maxNativeZoom={20}
      minZoom={0}
      opacity={opacity}
      zIndex={zIndex}
      // pan 시 인접 4줄 미리 fetch + 캐시 — drag 중 빈 영역 노출 최소화
      keepBuffer={4}
      updateWhenZooming={false}
      updateWhenIdle={true}
    />
  );
}

/** 패널 wrapper 의 상단 중앙에 표시되는 라벨 (split 모드용). */
function PanelLabel({ text }: { text: string }) {
  return (
    <div className="absolute top-3 left-1/2 -translate-x-1/2 z-[450] pointer-events-none w-max max-w-[90%] whitespace-normal break-words text-center text-sm leading-5 font-bold px-3 py-1.5 rounded-md bg-white/95 border-2 border-red-500 shadow-sm text-slate-700">
      {text}
    </div>
  );
}

type ResourceLabelPosition =
  | "top-right"
  | "top-left"
  | "bottom-left"
  | "bottom-right";
const LEAFLET_POSITION: Record<ResourceLabelPosition, string> = {
  "top-right": "topright",
  "top-left": "topleft",
  "bottom-left": "bottomleft",
  "bottom-right": "bottomright",
};

function ResourceLabel({
  text,
  position,
}: {
  text: string;
  position: ResourceLabelPosition;
}) {
  const map = useMap();
  useEffect(() => {
    const ctrl = new L.Control({
      position: LEAFLET_POSITION[position] as L.ControlPosition,
    });
    ctrl.onAdd = () => {
      const div = L.DomUtil.create("div");
      div.className = "leaflet-bar";
      div.style.cssText =
        "background:rgba(255,255,255,0.92);border:1px solid #e2e8f0;padding:4px 8px;max-width:420px;white-space:normal;overflow-wrap:anywhere;line-height:1.35;font-size:11px;font-weight:700;color:#475569;border-radius:6px;";
      div.textContent = text;
      return div;
    };
    ctrl.addTo(map);
    return () => {
      ctrl.remove();
    };
  }, [map, text, position]);
  return null;
}

// ============================================================
// 폴리곤 레이어
// ============================================================
/**
 * 폴리곤 레이어.
 *
 * readOnly: true 면 click/mouseover/mouseout 핸들러를 부착하지 않음.
 *   swipe 모드에서 당해년도 wrapper 쪽은 시각만 표시, 인터랙션은 과년도 측에서만 처리해
 *   1825 폴리곤의 hit-test 부담을 절반으로 줄임. style 은 동일 store 를 구독해
 *   양쪽이 hover/selection 표시가 일관되게 동기화됨.
 */
function DetectionsLayer({ readOnly = false }: { readOnly?: boolean } = {}) {
  const filtered = useFilteredDetections();
  const selectedIds = useSheetDetailStore((s) => s.selectedIds);
  const hoveredId = useSheetDetailStore((s) => s.hoveredId);
  const setHovered = useSheetDetailStore((s) => s.setHovered);

  const fc = useMemo<FeatureCollection<Polygon>>(
    () => ({
      type: "FeatureCollection",
      features: filtered.map((d) => ({
        type: "Feature",
        properties: {
          id: d.id,
          model: d.model,
          change_type: d.change_type,
          confidence: d.confidence,
        },
        geometry: d.geometry,
      })),
    }),
    [filtered],
  );

  const detectionById = useMemo(() => {
    const m = new Map<string, DetectionObject>();
    for (const d of filtered) m.set(d.id, d);
    return m;
  }, [filtered]);

  const layerRef = useRef<LeafletGeoJSON | null>(null);
  // id → leaflet sub-layer 매핑 — eachLayer 전체 순회 회피용.
  const layerById = useRef<Map<string, L.Layer>>(new Map());

  // GeoJSON 데이터 변경 시 layerById 인덱스 재구축
  useEffect(() => {
    const layer = layerRef.current;
    if (!layer) return;
    const m = new Map<string, L.Layer>();
    layer.eachLayer((sub) => {
      const f = (sub as { feature?: Feature }).feature;
      const id = String(f?.properties?.id ?? "");
      if (id) m.set(id, sub);
    });
    layerById.current = m;
  }, [fc]);

  // hover 변경 — 이전 hovered + 새 hovered 2 개만 setStyle (선택 상태 보존).
  const prevHoveredRef = useRef<string | null>(null);
  useEffect(() => {
    const prev = prevHoveredRef.current;
    const apply = (id: string | null) => {
      if (!id) return;
      const sub = layerById.current.get(id);
      const det = detectionById.get(id);
      if (!sub || !det) return;
      (sub as unknown as { setStyle: (s: PathOptions) => void }).setStyle(
        polygonStyle(det, selectedIds.includes(id), id === hoveredId),
      );
    };
    if (prev && prev !== hoveredId) apply(prev);
    if (hoveredId) apply(hoveredId);
    prevHoveredRef.current = hoveredId;
    // selectedIds 는 의존성에서 제외 — 선택 변경은 별도 effect 가 처리.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hoveredId]);

  // 선택 변경 — 이전 선택 ∪ 새 선택 차집합만 setStyle.
  const prevSelectedRef = useRef<string[]>([]);
  useEffect(() => {
    const prev = prevSelectedRef.current;
    const next = selectedIds;
    const changed = new Set<string>([...prev, ...next]);
    for (const id of changed) {
      const sub = layerById.current.get(id);
      const det = detectionById.get(id);
      if (!sub || !det) continue;
      (sub as unknown as { setStyle: (s: PathOptions) => void }).setStyle(
        polygonStyle(det, next.includes(id), id === hoveredId),
      );
    }
    prevSelectedRef.current = next;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedIds]);

  return (
    <GeoJSON
      key={`detections-${filtered.length}`}
      ref={(layer) => {
        layerRef.current = layer ?? null;
      }}
      data={fc}
      style={(feature) => {
        const id = String(feature?.properties?.id ?? "");
        const det = detectionById.get(id);
        if (!det) return { opacity: 0, fillOpacity: 0 };
        return polygonStyle(det, selectedIds.includes(id), hoveredId === id);
      }}
      onEachFeature={(feature, sub) => {
        if (readOnly) return; // 당해년도 측 — 인터랙션 X, 시각만.
        const id = String(feature.properties?.id ?? "");
        sub.on({
          click: (e) => {
            // 매 클릭마다 store 에서 직접 읽음 (클로저 stale 방지).
            const {
              editTool: tool,
              selectedIds: cur,
              selectObject,
              selectMany,
            } = useSheetDetailStore.getState();
            // draw 모드: 클릭을 map 으로 전파해 leaflet-draw 가 vertex 를 받게 함.
            // edit 모드: 추후 vertex 편집 통합 시 동일 처리.
            // draw 모드: 클릭을 map 으로 전파해 leaflet-draw 가 vertex 받음.
            // edit 모드: 폴리곤 클릭 = 단일 선택 (EditController 가 이를 보고 vertex 편집 활성).
            if (tool === "draw") return;
            if (tool === "lasso") {
              const next = cur.includes(id)
                ? cur.filter((x) => x !== id)
                : [...cur, id];
              selectMany(next);
            } else {
              selectObject(id);
            }
            L.DomEvent.stopPropagation(e);
          },
          mouseover: () => setHovered(id),
          mouseout: () => setHovered(null),
        });
      }}
    />
  );
}

/**
 * 변화탐지 색상 — 건물·도로 통일 매핑.
 *   신축/신설 #ef4444 red, 갱신 #3b82f6 blue, 소멸 #10b981 emerald.
 */
const STROKE_BY_TYPE: Record<string, string> = {
  building_new: "#ef4444",
  building_updated: "#3b82f6",
  building_removed: "#10b981",
  road_new: "#ef4444",
  road_updated: "#3b82f6",
  road_removed: "#10b981",
};
const FILL_BY_TYPE: Record<string, string> = {
  building_new: "#ef4444",
  building_updated: "#3b82f6",
  building_removed: "#10b981",
  road_new: "#ef4444",
  road_updated: "#3b82f6",
  road_removed: "#10b981",
};

/** 다중 선택 highlight — 시안(cyan) outline. */
const SELECTED_STROKE = "#06b6d4"; // cyan-500
const SELECTED_FILL = "#fde047"; // yellow-300

function polygonStyle(
  det: DetectionObject,
  isSelected: boolean,
  isHovered: boolean,
): PathOptions {
  const change = CHANGE_TYPE_BY_CODE[det.change_type];

  // 변화 유형별 STROKE/FILL_BY_TYPE 색 — fallback 으로 CHANGE_TYPE_BY_CODE 색.
  const stroke = isSelected
    ? SELECTED_STROKE
    : (STROKE_BY_TYPE[det.change_type] ?? change.color);
  const fillColor = isSelected
    ? SELECTED_FILL
    : (FILL_BY_TYPE[det.change_type] ?? change.color);

  // 굵은 outline + 매우 낮은 fill — 정사영상은 그대로 보이고 폴리곤 경계만 또렷.
  const baseWeight = isSelected ? 8 : isHovered ? 6 : 5;
  const fillOpacity = isHovered || isSelected ? 0.18 : 0.08;
  return {
    color: stroke,
    weight: baseWeight,
    opacity: 1,
    fillColor,
    fillOpacity: isSelected ? 0.4 : fillOpacity,
    dashArray: undefined,
  };
}

// ============================================================
// leaflet-draw 통합
// ============================================================
function DrawController() {
  const map = useMap();
  const editTool = useSheetDetailStore((s) => s.editTool);
  const sheet = useSheetDetailStore((s) => s.sheet);
  const applyCreate = useSheetDetailStore((s) => s.applyCreate);
  const setEditTool = useSheetDetailStore((s) => s.setEditTool);
  const featureGroupRef = useRef<LeafletFeatureGroup | null>(null);

  // 편집 그룹은 한 번만 만들어 map 에 부착
  useEffect(() => {
    if (featureGroupRef.current) return;
    const fg = new L.FeatureGroup();
    fg.addTo(map);
    featureGroupRef.current = fg;
    return () => {
      fg.removeFrom(map);
      featureGroupRef.current = null;
    };
  }, [map]);

  // draw 모드 활성화: 폴리곤 그리기 핸들러
  useEffect(() => {
    if (editTool !== "draw") return;
    console.log("[DrawController] enable on map", map);

    if (!(L as unknown as { Draw?: unknown }).Draw) {
      console.error(
        "[DrawController] L.Draw not loaded — leaflet-draw import 누락?",
      );
      return;
    }

    // allowIntersection: true — 4점+ 추가 시 새 edge 가 기존과 교차해도 허용
    // (false 면 silently 거부하여 사용자가 "왜 안 됨?" 혼란).
    const drawer = new L.Draw.Polygon(map, {
      shapeOptions: { color: "#3b82f6", weight: 2 },
      allowIntersection: true,
      showArea: true,
    });
    drawer.enable();
    console.log("[DrawController] drawer enabled");

    const onCreated = async (e: L.LeafletEvent) => {
      console.log("[DrawController] CREATED event fired", e);
      const layer = (e as unknown as { layer: L.Polygon }).layer;
      const latlngs = (layer.getLatLngs()[0] as L.LatLng[]).map(
        (ll) => [ll.lng, ll.lat] as [number, number],
      );
      latlngs.push(latlngs[0]!); // 닫기
      const polygon: Polygon = { type: "Polygon", coordinates: [latlngs] };

      // FN 신규 추가 — model/change_type 기본값 (사용자가 추후 수정 가능)
      if (!sheet) return;
      await applyCreate({
        model: "building",
        change_type: "building_new",
        confidence: 100,
        area_m2: 0, // 백엔드 통합 시 정확 계산
        geometry: polygon,
        region_code: "",
        address: "",
        reviewer_memo: "",
        reviewed_by: null,
        reviewed_at: null,
        is_user_added: true,
        is_deleted: false,
      });
      setEditTool("select");
    };

    map.on(L.Draw.Event.CREATED, onCreated);
    return () => {
      drawer.disable();
      map.off(L.Draw.Event.CREATED, onCreated);
    };
  }, [editTool, map, sheet, applyCreate, setEditTool]);

  return null;
}

// ============================================================
// edit 모드 — 선택 폴리곤 vertex 편집
//
// editTool === 'edit' + selectedIds.length === 1 일 때 활성.
// 폴리곤 layer 의 editing 핸들러를 enable. 모드 종료 시 좌표 읽어 store 에 반영.
// ============================================================
/** map 안에서 feature id 와 매칭되는 polygon sub-layer 찾기. */
function findPolygonById(m: L.Map, id: string): L.Polygon | null {
  let found: L.Polygon | null = null;
  m.eachLayer((layer) => {
    if (found) return;
    const sub = layer as L.Polygon & {
      feature?: Feature;
      eachLayer?: (cb: (l: L.Layer) => void) => void;
    };
    if (typeof sub.eachLayer === "function") {
      sub.eachLayer((inner) => {
        if (found) return;
        const f = (inner as { feature?: Feature }).feature;
        if (String(f?.properties?.id ?? "") === id) {
          found = inner as L.Polygon;
        }
      });
    }
  });
  return found;
}

function EditController() {
  const map = useMap();
  const allMaps = useContext(MapsContext);
  const editTool = useSheetDetailStore((s) => s.editTool);
  const selectedIds = useSheetDetailStore((s) => s.selectedIds);
  const applyEditGeometry = useSheetDetailStore((s) => s.applyEditGeometry);

  useEffect(() => {
    if (editTool !== "edit") return;
    if (selectedIds.length !== 1) return;
    const id = selectedIds[0]!;
    const polygon = findPolygonById(map, id);
    if (!polygon) return;
    const editable = (
      polygon as unknown as {
        editing?: { enable: () => void; disable: () => void };
      }
    ).editing;
    if (!editable) return;
    editable.enable();

    // 다른 panel 의 같은 id polygon 들 (미러링 대상)
    const others = allMaps
      .filter((m) => m !== map)
      .map((m) => findPolygonById(m, id))
      .filter((p): p is L.Polygon => p !== null);

    let edited = false;
    // vertex 드래그 중 + 완료 둘 다 listen → 다른 polygon 실시간 미러링
    const mirrorAndMark = () => {
      edited = true;
      const ll = polygon.getLatLngs();
      for (const other of others) {
        try {
          other.setLatLngs(ll as L.LatLng[][]);
        } catch {
          /* ignore — race during unmount */
        }
      }
    };
    // editdrag: vertex 드래그 중 매 frame. edit: drag 완료 시.
    polygon.on("edit", mirrorAndMark);
    polygon.on("editdrag", mirrorAndMark);

    return () => {
      polygon.off("edit", mirrorAndMark);
      polygon.off("editdrag", mirrorAndMark);
      if (edited) {
        try {
          const latlngs = (polygon.getLatLngs()[0] as L.LatLng[]).map(
            (ll) => [ll.lng, ll.lat] as [number, number],
          );
          if (latlngs.length >= 3) {
            latlngs.push(latlngs[0]!); // 닫기
            const geom: Polygon = { type: "Polygon", coordinates: [latlngs] };
            void applyEditGeometry(id, geom, "vertex 편집");
          }
        } catch {
          /* ignore */
        }
      }
      editable.disable();
    };
  }, [editTool, selectedIds, map, allMaps, applyEditGeometry]);

  return null;
}

// ============================================================
// 빈 영역 클릭 — 선택 해제
// select / lasso 모드에서 map 빈 곳 클릭 시 selectMany([]).
// 폴리곤 click 핸들러가 stopPropagation 하므로 폴리곤 클릭 시에는 발생 안 함.
// draw / edit 모드에서는 비활성 (vertex 추가/편집을 방해하지 않도록).
// ============================================================
function EmptyClickClearController() {
  const map = useMap();

  useEffect(() => {
    const onClick = () => {
      const { editTool, selectedIds, selectMany } =
        useSheetDetailStore.getState();
      if (editTool === "draw" || editTool === "edit") return;
      if (selectedIds.length === 0) return;
      selectMany([]);
    };
    map.on("click", onClick);
    return () => {
      map.off("click", onClick);
    };
  }, [map]);

  return null;
}

// ============================================================
// Lasso 드래그-박스 — 사각형 안 폴리곤 일괄 선택
// editTool === 'lasso' 일 때만 활성.
//
// 가장 견고한 구현:
//   - mousedown 은 window 의 capture phase 로 잡아 어떤 layer/handler 가 가로채기
//     전에 처리. 이벤트 좌표가 map 컨테이너 안인지 직접 검사해 외부 클릭은 무시.
//   - move/up 은 document bubble phase 로 충분 (드래그 시작 후엔 cursor 가
//     컨테이너 밖으로 나가도 추적).
//   - 박스는 Leaflet Rectangle 이 아니라 absolute-positioned DIV 로 그림 — Leaflet
//     의 layer pane / 이벤트 시스템과 완전 분리되어 어떤 환경에서도 보임.
//   - text selection / image drag / map drag / box-zoom / doubleClickZoom 모두
//     일시 비활성.
// ============================================================
function LassoBoxController() {
  const map = useMap();
  const editTool = useSheetDetailStore((s) => s.editTool);

  useEffect(() => {
    if (editTool !== "lasso") return;

    const container = map.getContainer();
    let startScreen: { x: number; y: number } | null = null;
    let boxDiv: HTMLDivElement | null = null;
    let dragMoved = false;
    let suppressNextClick = false;
    const DRAG_THRESHOLD_PX = 4;

    // map 의 모든 인터랙션 비활성 (lasso 동안)
    const restorers: (() => void)[] = [];
    if (map.dragging.enabled()) {
      map.dragging.disable();
      restorers.push(() => map.dragging.enable());
    }
    if (map.boxZoom?.enabled()) {
      map.boxZoom.disable();
      restorers.push(() => map.boxZoom.enable());
    }
    if (map.doubleClickZoom.enabled()) {
      map.doubleClickZoom.disable();
      restorers.push(() => map.doubleClickZoom.enable());
    }
    container.style.cursor = "crosshair";
    L.DomUtil.disableImageDrag();
    L.DomUtil.disableTextSelection();

    const removeBox = () => {
      if (boxDiv && boxDiv.parentNode) boxDiv.parentNode.removeChild(boxDiv);
      boxDiv = null;
    };

    const drawBox = (x1: number, y1: number, x2: number, y2: number) => {
      if (!boxDiv) {
        boxDiv = document.createElement("div");
        boxDiv.style.cssText = [
          "position:absolute",
          "border:2px dashed #3b82f6",
          "background:rgba(59,130,246,0.12)",
          "pointer-events:none",
          "z-index:500",
        ].join(";");
        container.appendChild(boxDiv);
      }
      const rect = container.getBoundingClientRect();
      const left = Math.min(x1, x2) - rect.left;
      const top = Math.min(y1, y2) - rect.top;
      const w = Math.abs(x2 - x1);
      const h = Math.abs(y2 - y1);
      boxDiv.style.left = `${left}px`;
      boxDiv.style.top = `${top}px`;
      boxDiv.style.width = `${w}px`;
      boxDiv.style.height = `${h}px`;
    };

    // 휠 클릭(middle button) drag → map pan. lasso 동안 좌클릭은 박스 선택용이라
    // 지도 이동이 막혀있으므로, 휠 드래그를 보조 pan 통로로 제공.
    let panFrom: { x: number; y: number } | null = null;

    const onMouseDown = (e: MouseEvent) => {
      if (!container.contains(e.target as Node)) return;
      if (e.button === 1) {
        // 휠 클릭 — 기본 동작(스크롤 모드) 차단 + pan 시작.
        e.preventDefault();
        panFrom = { x: e.clientX, y: e.clientY };
        container.style.cursor = "grabbing";
        return;
      }
      if (e.button !== 0) return;
      startScreen = { x: e.clientX, y: e.clientY };
      dragMoved = false;
    };

    const onMouseMove = (e: MouseEvent) => {
      // 휠 드래그 pan
      if (panFrom) {
        const dx = e.clientX - panFrom.x;
        const dy = e.clientY - panFrom.y;
        if (dx !== 0 || dy !== 0) {
          map.panBy([-dx, -dy], { animate: false });
          panFrom = { x: e.clientX, y: e.clientY };
        }
        return;
      }
      if (!startScreen) return;
      const dx = e.clientX - startScreen.x;
      const dy = e.clientY - startScreen.y;
      if (!dragMoved && Math.abs(dx) + Math.abs(dy) < DRAG_THRESHOLD_PX) return;
      dragMoved = true;
      drawBox(startScreen.x, startScreen.y, e.clientX, e.clientY);
    };

    const onMouseUp = (e: MouseEvent) => {
      if (panFrom) {
        panFrom = null;
        container.style.cursor = "crosshair";
        return;
      }
      if (!startScreen) return;
      const start = startScreen;
      const moved = dragMoved;
      startScreen = null;
      dragMoved = false;
      removeBox();

      if (!moved) return;
      // 드래그가 있었으면 그 직후 fire 될 click 이벤트 1개를 억제
      // (폴리곤 위에서 시작/종료된 드래그가 토글 클릭으로 오해되는 것 방지).
      suppressNextClick = true;

      const rect = container.getBoundingClientRect();
      const startContainer = L.point(start.x - rect.left, start.y - rect.top);
      const endContainer = L.point(e.clientX - rect.left, e.clientY - rect.top);
      const bounds = L.latLngBounds(
        map.containerPointToLatLng(startContainer),
        map.containerPointToLatLng(endContainer),
      );
      const { detections, selectMany } = useSheetDetailStore.getState();
      const hits: string[] = [];
      for (const d of detections) {
        if (d.is_deleted) continue;
        const ring = d.geometry.coordinates[0] ?? [];
        if (ring.length < 2) continue;
        let lng = 0;
        let lat = 0;
        const n = ring.length - 1;
        for (let i = 0; i < n; i += 1) {
          const [x, y] = ring[i] as [number, number];
          lng += x;
          lat += y;
        }
        const center = L.latLng(lat / n, lng / n);
        if (bounds.contains(center)) hits.push(d.id);
      }
      selectMany(hits);
    };

    const onClickCapture = (e: MouseEvent) => {
      if (!suppressNextClick) return;
      suppressNextClick = false;
      e.stopPropagation();
      e.preventDefault();
    };

    // capture phase — 다른 누구보다 먼저 mousedown 을 잡는다.
    window.addEventListener("mousedown", onMouseDown, true);
    window.addEventListener("mousemove", onMouseMove, true);
    window.addEventListener("mouseup", onMouseUp, true);
    window.addEventListener("click", onClickCapture, true);

    return () => {
      window.removeEventListener("mousedown", onMouseDown, true);
      window.removeEventListener("mousemove", onMouseMove, true);
      window.removeEventListener("mouseup", onMouseUp, true);
      window.removeEventListener("click", onClickCapture, true);
      removeBox();
      container.style.cursor = "";
      L.DomUtil.enableImageDrag();
      L.DomUtil.enableTextSelection();
      for (const r of restorers) r();
    };
  }, [editTool, map]);

  return null;
}

// ============================================================
// 삭제 이력 임시 마커 (5초 자동 해제)
// ============================================================
function DeletionMarkersLayer() {
  const markers = useSheetDetailStore((s) => s.deletionMarkers);
  const prune = useSheetDetailStore((s) => s.pruneDeletionMarkers);
  const map = useMap();

  useEffect(() => {
    if (markers.length === 0) return;
    const t = window.setInterval(prune, 1000);
    return () => window.clearInterval(t);
  }, [markers.length, prune]);

  useEffect(() => {
    const layers: L.Layer[] = [];
    for (const m of markers) {
      const icon = L.divIcon({
        className: "",
        iconSize: [24, 24],
        html: `<div style="width:24px;height:24px;border-radius:9999px;background:#ef4444;opacity:0.6;box-shadow:0 0 0 4px rgba(239,68,68,0.25);"></div>`,
      });
      const layer = L.marker([m.lat, m.lng], { icon, interactive: false });
      layer.addTo(map);
      layers.push(layer);
    }
    return () => {
      for (const layer of layers) map.removeLayer(layer);
    };
  }, [markers, map]);

  return null;
}

// ============================================================
// 단건 선택 변경 시 fitBounds + center
// ============================================================
function SelectionFlyController() {
  // selectFlyTick 변경 시에만 fly (명시적 fly 요청). 지도 폴리곤 직접 클릭은
  // selectObject (tick 변경 X) — 사용자가 보고 있는 위치 그대로 유지.
  const flyTick = useSheetDetailStore((s) => s.selectFlyTick);
  const selectedIds = useSheetDetailStore((s) => s.selectedIds);
  const detections = useSheetDetailStore((s) => s.detections);
  const rightPanel = useSheetDetailStore((s) => s.rightPanel);
  // 처리 히스토리에서 삭제된 폴리곤 위치로 panTo 할 때 사용.
  const geomFlyTick = useSheetDetailStore((s) => s.geometryFlyTick);
  const pendingGeom = useSheetDetailStore((s) => s.pendingFlyGeometry);
  const map = useMap();
  const siblingMaps = useContext(MapsContext);
  const allMaps = siblingMaps.length > 0 ? siblingMaps : [map];

  const flyToRing = (ring: [number, number][]) => {
    if (ring.length === 0) return;
    const lats = ring.map(([, y]) => y);
    const lngs = ring.map(([x]) => x);
    map.flyToBounds(
      [
        [Math.min(...lats), Math.min(...lngs)],
        [Math.max(...lats), Math.max(...lngs)],
      ],
      { duration: 0.4, maxZoom: 20, padding: [60, 60] },
    );
  };

  const invalidateMaps = () => {
    for (const m of allMaps) {
      m.invalidateSize({ animate: false });
    }
  };

  useEffect(() => {
    if (flyTick === 0) return; // 초기값 — 자동 fly 안 함
    if (selectedIds.length !== 1) return;
    const id = selectedIds[0]!;
    const det = detections.find((d) => d.id === id);
    if (!det) return;
    flyToRing((det.geometry.coordinates[0] ?? []) as [number, number][]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flyTick]);

  // 우측 정보/리포트 패널 폭이 바뀌면 Leaflet 이 컨테이너 크기 변화를
  // 즉시 모르기 때문에 invalidateSize 후 선택 객체를 새 지도 영역 중심에 맞춘다.
  useEffect(() => {
    invalidateMaps();
    const later = window.setTimeout(() => {
      invalidateMaps();
      if (rightPanel === "closed") return;
      if (selectedIds.length !== 1) return;
      const id = selectedIds[0]!;
      const det = detections.find((d) => d.id === id);
      if (!det) return;
      flyToRing((det.geometry.coordinates[0] ?? []) as [number, number][]);
    }, 230);
    return () => window.clearTimeout(later);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rightPanel]);

  // history 의 삭제된 폴리곤 위치 panTo — selection 변경 없이 위치만.
  useEffect(() => {
    if (geomFlyTick === 0) return;
    if (!pendingGeom) return;
    flyToRing((pendingGeom.coordinates[0] ?? []) as [number, number][]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geomFlyTick]);

  return null;
}
