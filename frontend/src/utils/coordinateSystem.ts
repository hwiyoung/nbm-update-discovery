const COORDINATE_SYSTEM_LABELS: Readonly<Record<string, string>> = {
  "5185": "TM 서부",
  "5186": "TM 중부",
  "5187": "TM 동부",
  "5188": "TM 동해",
  "5179": "UTM-K",
  "4326": "WGS84",
};

/**
 * Rasterio/GDAL이 반환하는 짧은 EPSG 문자열과 긴 WKT를 같은 방식으로 표시한다.
 * WKT에는 datum/ellipsoid 등 하위 EPSG ID도 포함되므로 항상 마지막 ID를 사용한다.
 */
export function extractEpsgCode(crs: string): string | null {
  const text = crs.trim();
  if (!text) return null;

  const direct = text.match(/^EPSG\s*:\s*(\d+)$/i);
  if (direct?.[1]) return direct[1];

  const matches = [
    ...text.matchAll(/AUTHORITY\s*\[\s*["']EPSG["']\s*,\s*["']?(\d+)["']?\s*\]/gi),
    ...text.matchAll(/ID\s*\[\s*["']EPSG["']\s*,\s*["']?(\d+)["']?\s*\]/gi),
  ];
  return matches.at(-1)?.[1] ?? null;
}

export function formatCoordinateSystem(crs: string): string {
  const code = extractEpsgCode(crs);
  const text = crs.trim();
  if (!code) {
    const wktName = text.match(/^(?:PROJCS|PROJCRS|GEOGCS|GEOGCRS)\s*\[\s*["']([^"']+)["']/i)?.[1];
    if (wktName) return wktName;
    return text.length > 64 ? `${text.slice(0, 61)}…` : (text || "-");
  }
  const label = COORDINATE_SYSTEM_LABELS[code];
  return label ? `${label} (EPSG:${code})` : `EPSG:${code}`;
}
