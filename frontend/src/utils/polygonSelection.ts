import type { Polygon } from "geojson";

type Position = [number, number];

const EPSILON = 1e-12;

/** 단순 Polygon 외곽선 기준 교차 판정. 경계에 닿는 객체도 포함한다. */
export function polygonsIntersect(a: Polygon, b: Polygon): boolean {
  const ringA = normalizeRing(a.coordinates[0] ?? []);
  const ringB = normalizeRing(b.coordinates[0] ?? []);
  if (ringA.length < 4 || ringB.length < 4) return false;
  if (!bboxIntersects(ringA, ringB)) return false;

  for (let i = 0; i < ringA.length - 1; i += 1) {
    for (let j = 0; j < ringB.length - 1; j += 1) {
      if (segmentsIntersect(ringA[i]!, ringA[i + 1]!, ringB[j]!, ringB[j + 1]!)) {
        return true;
      }
    }
  }

  return pointInRing(ringA[0]!, ringB) || pointInRing(ringB[0]!, ringA);
}

function normalizeRing(ring: number[][]): Position[] {
  const points = ring
    .filter((point): point is Position => point.length >= 2)
    .map(([x, y]) => [x, y] as Position);
  if (points.length < 3) return points;
  const first = points[0]!;
  const last = points.at(-1)!;
  if (first[0] !== last[0] || first[1] !== last[1]) points.push([...first]);
  return points;
}

function bboxIntersects(a: Position[], b: Position[]): boolean {
  const bounds = (ring: Position[]) => {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const [x, y] of ring) {
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
    return { minX, minY, maxX, maxY };
  };
  const aa = bounds(a);
  const bb = bounds(b);
  return aa.minX <= bb.maxX && aa.maxX >= bb.minX
    && aa.minY <= bb.maxY && aa.maxY >= bb.minY;
}

function pointInRing([x, y]: Position, ring: Position[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const a = ring[i]!;
    const b = ring[j]!;
    if (pointOnSegment([x, y], a, b)) return true;
    const crosses = (a[1] > y) !== (b[1] > y)
      && x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0];
    if (crosses) inside = !inside;
  }
  return inside;
}

function segmentsIntersect(a: Position, b: Position, c: Position, d: Position): boolean {
  const o1 = orientation(a, b, c);
  const o2 = orientation(a, b, d);
  const o3 = orientation(c, d, a);
  const o4 = orientation(c, d, b);

  if (o1 !== o2 && o3 !== o4) return true;
  return (o1 === 0 && pointOnSegment(c, a, b))
    || (o2 === 0 && pointOnSegment(d, a, b))
    || (o3 === 0 && pointOnSegment(a, c, d))
    || (o4 === 0 && pointOnSegment(b, c, d));
}

function orientation(a: Position, b: Position, c: Position): -1 | 0 | 1 {
  const value = (b[1] - a[1]) * (c[0] - b[0])
    - (b[0] - a[0]) * (c[1] - b[1]);
  if (Math.abs(value) <= EPSILON) return 0;
  return value > 0 ? 1 : -1;
}

function pointOnSegment(p: Position, a: Position, b: Position): boolean {
  if (orientation(a, b, p) !== 0) return false;
  return p[0] <= Math.max(a[0], b[0]) + EPSILON
    && p[0] >= Math.min(a[0], b[0]) - EPSILON
    && p[1] <= Math.max(a[1], b[1]) + EPSILON
    && p[1] >= Math.min(a[1], b[1]) - EPSILON;
}
