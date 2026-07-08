import type { LatLngBoundsExpression } from "leaflet";
import type { Polygon } from "geojson";

/**
 * GeoJSON / Leaflet 좌표 호환 유틸.
 * 프론트엔드 런타임은 항상 EPSG:4326 만 다룬다 (CLAUDE.md §9.1).
 */

export type Bbox = [number, number, number, number]; // [minLon, minLat, maxLon, maxLat]

export function bboxToLeafletBounds(bbox: Bbox): LatLngBoundsExpression {
  const [minLon, minLat, maxLon, maxLat] = bbox;
  return [
    [minLat, minLon],
    [maxLat, maxLon],
  ];
}

export function leafletBoundsToBbox(bounds: {
  getSouthWest(): { lng: number; lat: number };
  getNorthEast(): { lng: number; lat: number };
}): Bbox {
  const sw = bounds.getSouthWest();
  const ne = bounds.getNorthEast();
  return [sw.lng, sw.lat, ne.lng, ne.lat];
}

/**
 * Polygon 첫 ring의 면적(㎡) 근사. EPSG:4326 좌표를 평면 근사로 변환.
 * 정밀 면적은 백엔드 PostGIS 가 제공하므로 본 함수는 UI 표시용.
 */
export function polygonAreaM2(polygon: Polygon): number {
  const ring = polygon.coordinates[0];
  if (!ring || ring.length < 4) return 0;

  // 위도 평균을 기준으로 한 등면적 근사 (한국에서 충분한 정확도)
  let latSum = 0;
  for (const [, lat] of ring) latSum += lat;
  const latAvg = latSum / ring.length;
  const cosLat = Math.cos((latAvg * Math.PI) / 180);
  const mPerDegLat = 111_320;
  const mPerDegLon = 111_320 * cosLat;

  // shoelace
  let area = 0;
  for (let i = 0; i < ring.length - 1; i += 1) {
    const [x1, y1] = ring[i] as [number, number];
    const [x2, y2] = ring[i + 1] as [number, number];
    area += (x1 * mPerDegLon) * (y2 * mPerDegLat) - (x2 * mPerDegLon) * (y1 * mPerDegLat);
  }
  return Math.abs(area / 2);
}

export function centerOfPolygon(polygon: Polygon): [number, number] {
  const ring = polygon.coordinates[0];
  if (!ring || ring.length === 0) return [0, 0];
  let lon = 0;
  let lat = 0;
  // 닫힌 폴리곤이면 마지막 점이 첫 점과 같으므로 제외
  const n = ring.length - 1 > 0 ? ring.length - 1 : ring.length;
  for (let i = 0; i < n; i += 1) {
    const [x, y] = ring[i] as [number, number];
    lon += x;
    lat += y;
  }
  return [lon / n, lat / n];
}

export function bboxFromPolygon(polygon: Polygon): Bbox {
  const ring = polygon.coordinates[0] ?? [];
  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;
  for (const [x, y] of ring) {
    if (x < minLon) minLon = x;
    if (x > maxLon) maxLon = x;
    if (y < minLat) minLat = y;
    if (y > maxLat) maxLat = y;
  }
  return [minLon, minLat, maxLon, maxLat];
}
