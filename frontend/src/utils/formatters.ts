/**
 * 표시용 포매터.
 * 한국어 + KST 기준. 정밀 수치는 백엔드 응답 그대로 두고 표시 단계에서만 가공.
 */

export function formatArea(m2: number): string {
  if (!Number.isFinite(m2)) return "-";
  return `${m2.toLocaleString("ko-KR", { maximumFractionDigits: 1 })} m²`;
}

export function formatSquareMeters(m2: number): string {
  if (!Number.isFinite(m2)) return "-";
  return `${m2.toLocaleString("ko-KR", { maximumFractionDigits: 1 })} m²`;
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleDateString("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleString("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatYearMonth(iso: string | null | undefined): string {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * 도엽코드 8자리 표시 — 4-4 가독성 분리.
 */
export function formatSheetCode(code: string): string {
  if (!code) return "-";
  if (code.length === 8) return `${code.slice(0, 4)}-${code.slice(4)}`;
  return code;
}

export function formatPercent(value: number, fractionDigits = 0): string {
  if (!Number.isFinite(value)) return "-";
  return `${value.toFixed(fractionDigits)}%`;
}

export function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return "-";
  return value.toLocaleString("ko-KR");
}
