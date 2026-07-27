/**
 * Task(=프로젝트) 단위 내보내기 — 매칭된 모든 sheet 의 detections 를 한 파일로.
 *
 * SHP는 백엔드 Fiona/GDAL 생성 ZIP을 사용하고, DXF/PDF는 detection API를 재사용한다.
 */

import {
  downloadTaskShapefile,
  getTaskStatus,
  listTaskDetections,
} from "@/api/client";
import type { DetectionObject, Task } from "@/types";
import {
  CHANGE_TYPE_BY_CODE,
  OBJECT_CATEGORY_LABEL,
  VISIBLE_CHANGE_TYPES,
} from "@/utils/constants";
import { convertPolygon4326to5186 } from "./proj";
import { getTaskFilenameStem, saveExportBlob } from "./saveTarget";
import type { ExportSaveTarget } from "./saveTarget";

async function fetchTaskAndDetections(
  taskId: string,
  objectIds?: string[],
): Promise<{ task: Task; detections: DetectionObject[] }> {
  const [task, detections] = await Promise.all([
    getTaskStatus(taskId),
    listTaskDetections(taskId),
  ]);
  const allowed = objectIds ? new Set(objectIds) : null;
  return {
    task,
    detections: detections.filter((d) => !d.is_deleted && (!allowed || allowed.has(d.id))),
  };
}

// ============================================================
// SHP — backend Fiona/GDAL
//
// 브라우저 shp-write의 DBF writer는 한글 문자를 1 byte로 잘라 손상시킨다.
// 백엔드가 DB의 EPSG:5186 geometry와 속성을 UTF-8 DBF로 직접 직렬화하고,
// 프론트는 완성된 ZIP Blob만 기존 저장 대상(File System Access API/다운로드)에 쓴다.
// ============================================================
export async function exportTaskAsShp(
  taskId: string,
  saveTarget?: ExportSaveTarget,
  objectIds?: string[],
): Promise<void> {
  const [task, blob] = await Promise.all([
    getTaskStatus(taskId),
    downloadTaskShapefile(taskId, objectIds),
  ]);
  const filename = `${getTaskFilenameStem(task)}.zip`;
  await saveExportBlob(blob, filename, "shp", saveTarget);
}

// ============================================================
// 3D DXF — backend 가 도엽 인덱스 + DEM 디렉토리에서 자동 조립.
// 사용자 측 DEM 선택 불필요. 응답은 JSON (download_url + statistics),
// 그 URL 을 다시 GET 으로 받아 blob 다운로드.
// ============================================================

/** backend Export3dStatistics 와 1:1 매핑. */
export interface Export3dStatistics {
  total_objects: number;
  total_vertices: number;
  sheets_used: string[];
  missing_sheets: string[];
  nodata_vertex_count: number;
  objects_with_nodata: string[];
  elapsed_seconds: number;
}

interface Export3dResponse {
  download_url: string;
  filename: string;
  statistics: Export3dStatistics;
}

interface Export3dErrorBody {
  error?: string;
  detail?: string;
}

function mapExport3dError(status: number, body: Export3dErrorBody): string {
  if (body.error === "dem_service_unavailable") {
    return "DEM 데이터가 준비되지 않았습니다. 관리자에게 문의하세요.";
  }
  if (body.error === "missing_dem") {
    return body.detail ?? "프로젝트 영역의 DEM 일부가 누락되어 export 를 진행할 수 없습니다.";
  }
  if (body.error === "no_detections") {
    return "변화탐지 객체가 없어 DXF 를 만들 수 없습니다.";
  }
  if (body.error === "crs_mismatch") {
    return body.detail ?? "좌표계 변환에 실패했습니다.";
  }
  if (typeof body.detail === "string") return body.detail;
  return `3D DXF export failed: HTTP ${status}`;
}

export async function exportTaskAs3dDxf(
  taskId: string,
  layerName: string = "CHANGE_DETECTION",
  saveTarget?: ExportSaveTarget,
  objectIds?: string[],
): Promise<Export3dStatistics> {
  const base = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/$/, "") || "/api/v1";

  // 1) POST — 서버가 sheet index sindex 로 DEM 조립 + DXF 생성
  const res = await fetch(`${base}/tasks/${encodeURIComponent(taskId)}/export/dxf-3d`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ layer_name: layerName, object_ids: objectIds }),
  });
  if (!res.ok) {
    let body: Export3dErrorBody = {};
    try { body = (await res.json()) as Export3dErrorBody; } catch {/* noop */}
    throw new Error(mapExport3dError(res.status, body));
  }
  const data = (await res.json()) as Export3dResponse;

  // 2) GET download_url — 서버 저장 경로에서 DXF 받아 즉시 다운로드 트리거
  const fileUrl = data.download_url.startsWith("http")
    ? data.download_url
    : `${window.location.origin}${data.download_url}`;
  const dl = await fetch(fileUrl);
  if (!dl.ok) {
    throw new Error(`3D DXF 파일 다운로드 실패: HTTP ${dl.status}`);
  }
  const blob = await dl.blob();
  await saveExportBlob(blob, data.filename, "dxf3d", saveTarget);

  return data.statistics;
}

// ============================================================
// DXF — dxf-writer
// ============================================================
export async function exportTaskAsDxf(
  taskId: string,
  saveTarget?: ExportSaveTarget,
  objectIds?: string[],
): Promise<void> {
  const { task, detections } = await fetchTaskAndDetections(taskId, objectIds);

  const Drawing = (await import("dxf-writer")).default as unknown as {
    new (): {
      addLayer(name: string, color: number, lineType: string): void;
      setActiveLayer(name: string): void;
      drawPolyline(points: [number, number][], closed: boolean): void;
      toDxfString(): string;
    };
  };
  const drawing = new Drawing();

  type ChangeType = DetectionObject["change_type"];
  const colorByType: Record<ChangeType, number> = {
    building_new: 1,
    building_removed: 3,
    building_updated: 5,
    road_new: 1,
    road_removed: 3,
    road_updated: 5,
  };

  const usedTypes = new Set<ChangeType>();
  for (const d of detections) usedTypes.add(d.change_type);
  for (const t of usedTypes) {
    drawing.addLayer(CHANGE_TYPE_BY_CODE[t].code, colorByType[t], "CONTINUOUS");
  }

  for (const d of detections) {
    drawing.setActiveLayer(d.change_type);
    const ring5186 = convertPolygon4326to5186(d.geometry.coordinates)[0];
    if (!ring5186 || ring5186.length < 3) continue;
    const points = ring5186.map(([x, y]) => [x, y] as [number, number]);
    drawing.drawPolyline(points, true);
  }

  const stem = getTaskFilenameStem(task);
  await saveExportBlob(
    new Blob([drawing.toDxfString()], { type: "application/dxf" }),
    `${stem}_2d.dxf`,
    "dxf",
    saveTarget,
  );
}

// ============================================================
// PDF — html2canvas + jsPDF
// ============================================================
export async function exportTaskAsPdf(
  taskId: string,
  sourceElement?: HTMLElement,
  saveTarget?: ExportSaveTarget,
  objectIds?: string[],
): Promise<void> {
  const { task, detections: rawDetections } = await fetchTaskAndDetections(taskId, objectIds);
  const visibleCodes = new Set(VISIBLE_CHANGE_TYPES.map((item) => item.code));
  const detections = rawDetections.filter((det) => visibleCodes.has(det.change_type));

  const { default: jsPDF } = await import("jspdf");
  const { default: html2canvas } = await import("html2canvas");
  const reports = sourceElement
    ? [cloneReportElement(sourceElement)]
    : buildPdfReportPages(task, detections);

  const doc = new jsPDF({ unit: "mm", format: "a4" });
  try {
    for (const [index, report] of reports.entries()) {
      document.body.appendChild(report);
      const canvas = await html2canvas(report, {
        backgroundColor: "#ffffff",
        scale: 2,
        useCORS: true,
        logging: false,
      });
      report.remove();

      if (index > 0) doc.addPage();
      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();
      let imgWidth = pageWidth;
      let imgHeight = (canvas.height * imgWidth) / canvas.width;
      if (imgHeight > pageHeight) {
        imgHeight = pageHeight;
        imgWidth = (canvas.width * imgHeight) / canvas.height;
      }
      const x = (pageWidth - imgWidth) / 2;
      doc.addImage(canvas.toDataURL("image/png"), "PNG", x, 0, imgWidth, imgHeight);
    }

    await saveExportBlob(
      doc.output("blob"),
      `${getTaskFilenameStem(task)}_report.pdf`,
      "pdf",
      saveTarget,
    );
  } finally {
    reports.forEach((report) => report.remove());
  }
}

function cloneReportElement(sourceElement: HTMLElement): HTMLElement {
  const rect = sourceElement.getBoundingClientRect();
  const wrapper = document.createElement("div");
  wrapper.style.cssText = [
    "position:absolute",
    "left:-10000px",
    "top:0",
    `width:${Math.max(760, Math.ceil(rect.width || 900))}px`,
    "box-sizing:border-box",
    "padding:0",
    "background:#fff",
    "color:#0f172a",
  ].join(";");

  const clone = sourceElement.cloneNode(true) as HTMLElement;
  clone.style.height = "auto";
  clone.style.maxHeight = "none";
  clone.style.overflow = "visible";
  clone.style.background = "#fff";
  clone.querySelectorAll<HTMLElement>("[data-pdf-exclude='true']").forEach((el) => {
    el.remove();
  });
  clone.querySelectorAll<HTMLElement>(".overflow-y-auto,.overflow-x-auto,.custom-scrollbar").forEach((el) => {
    el.style.overflow = "visible";
    el.style.maxHeight = "none";
    el.style.height = "auto";
  });
  wrapper.appendChild(clone);
  return wrapper;
}

function buildPdfReportPages(task: Task, detections: DetectionObject[]): HTMLElement[] {
  const totalArea = detections.reduce((sum, det) => sum + det.area_m2, 0);
  const memoCount = detections.filter((det) => det.reviewer_memo.trim() !== "").length;
  const models = task.models.length > 0 ? task.models : (["building", "road"] as Task["models"]);

  return models.map((model, index) => {
    const el = createPdfPageElement();

    const metricCards = [
      ["필터 결과", `${detections.length.toLocaleString("ko-KR")}건`],
      ["총 면적", formatObjectArea(totalArea)],
      ["전체 대비", "100%"],
      ["의견 입력", `${memoCount.toLocaleString("ko-KR")}건`],
    ];

    el.innerHTML = `
      ${index === 0 ? buildPdfHeaderHtml(task) : ""}
      ${index === 0 ? buildSummaryHtml(metricCards) : ""}
      ${buildModelReportHtml(model, detections)}
      <footer style="margin-top:22px;color:#94a3b8;font-size:11px;">NBM 변화탐지 검수 플랫폼</footer>
    `;
    return el;
  });
}

function createPdfPageElement(): HTMLElement {
  const el = document.createElement("div");
  el.style.cssText = [
    "position:absolute",
    "left:-10000px",
    "top:0",
    "width:794px",
    "min-height:1123px",
    "box-sizing:border-box",
    "padding:38px 46px",
    "background:#fff",
    "color:#0f172a",
    "font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI','Noto Sans KR','Malgun Gothic',sans-serif",
    "font-size:13px",
    "line-height:1.45",
  ].join(";");
  return el;
}

function buildPdfHeaderHtml(task: Task): string {
  return `
    <header style="margin-bottom:22px;">
      <div style="font-size:26px;font-weight:800;letter-spacing:0;color:#0f172a;">변화탐지 리포트</div>
      <div style="margin-top:6px;font-size:15px;font-weight:700;color:#475569;">${escapeHtml(task.name)}</div>
      <table style="margin-top:16px;width:100%;border-collapse:collapse;font-size:12px;color:#475569;">
        <tbody>
          ${[
            ["프로젝트 ID", task.id],
            ["상태", task.status],
            ["등록", formatIso(task.created_at)],
            ["처리 시작", formatIso(task.started_at ?? task.progress_updated_at)],
            ["처리 종료", formatIso(task.finished_at)],
            ["도엽", `${task.sheet_codes.length.toLocaleString("ko-KR")}매`],
            ["객체", task.models.map((m) => OBJECT_CATEGORY_LABEL[m]).join(", ") || "-"],
          ].map(([label, value]) => `
            <tr>
              <td style="width:90px;padding:3px 0;color:#94a3b8;font-weight:700;">${escapeHtml(label)}</td>
              <td style="padding:3px 0;color:#334155;">${escapeHtml(value)}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </header>
  `;
}

function buildSummaryHtml(metricCards: string[][]): string {
  return `
    <section style="margin-bottom:24px;">
      <div style="font-size:17px;font-weight:800;margin-bottom:10px;border-bottom:1px solid #e2e8f0;padding-bottom:7px;">요약</div>
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;">
        ${metricCards.map(([label, value]) => `
          <div style="border:1px solid #e2e8f0;border-radius:6px;padding:10px;background:#fff;">
            <div style="font-size:11px;font-weight:800;color:#94a3b8;">${escapeHtml(label)}</div>
            <div style="margin-top:5px;font-size:15px;font-weight:800;color:#0f172a;">${escapeHtml(value)}</div>
          </div>
        `).join("")}
      </div>
    </section>
  `;
}

function buildModelReportHtml(model: Task["models"][number], detections: DetectionObject[]): string {
  const modelRows = detections
    .filter((det) => det.model === model)
    .sort((a, b) => b.area_m2 - a.area_m2);
  const typeOptions = VISIBLE_CHANGE_TYPES.filter((item) => item.model === model);
  const modelArea = modelRows.reduce((sum, det) => sum + det.area_m2, 0);
  const bySheet = new Map<string, number>();
  for (const det of modelRows) {
    const key = det.sheet_code || "미지정";
    bySheet.set(key, (bySheet.get(key) ?? 0) + 1);
  }
  const sheetRows = [...bySheet.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  const typeRows = typeOptions.map((type) => {
    const rows = modelRows.filter((det) => det.change_type === type.code);
    return {
      label: type.label,
      color: type.color,
      count: rows.length,
      area: rows.reduce((sum, det) => sum + det.area_m2, 0),
    };
  }).filter((row) => row.count > 0);

  return `
    <section style="margin-bottom:28px;break-inside:avoid;">
      <div style="font-size:17px;font-weight:800;margin-bottom:10px;border-bottom:1px solid #e2e8f0;padding-bottom:7px;">
        ${escapeHtml(OBJECT_CATEGORY_LABEL[model])}변화
      </div>
      <div style="display:flex;justify-content:space-between;margin-bottom:12px;font-weight:800;color:#0f172a;">
        <span>총 ${modelRows.length.toLocaleString("ko-KR")}건</span>
        <span>면적 ${escapeHtml(formatObjectArea(modelArea))}</span>
      </div>
      <div style="display:grid;grid-template-columns:1fr;gap:14px;margin-bottom:14px;">
        <div style="border:1px solid #e2e8f0;border-radius:6px;padding:14px;">
          <div style="font-size:13px;font-weight:800;margin-bottom:10px;">변화 유형 분포</div>
          <div style="display:grid;grid-template-columns:240px 1fr;gap:16px;align-items:center;">
            ${buildDonutSvg(typeRows)}
            <table style="width:100%;border-collapse:collapse;font-size:12px;">
              <thead>
                <tr style="background:#f8fafc;color:#64748b;">
                  <th style="text-align:left;padding:7px 9px;border:1px solid #e2e8f0;">유형</th>
                  <th style="text-align:right;padding:7px 9px;border:1px solid #e2e8f0;">건수</th>
                  <th style="text-align:right;padding:7px 9px;border:1px solid #e2e8f0;">면적(m²)</th>
                  <th style="text-align:right;padding:7px 9px;border:1px solid #e2e8f0;">비율</th>
                </tr>
              </thead>
              <tbody>
                ${typeRows.map((row) => `
                  <tr>
                    <td style="padding:7px 9px;border:1px solid #eef2f7;">
                      <span style="display:inline-flex;align-items:center;gap:7px;">
                        <span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:${row.color};"></span>
                        ${escapeHtml(row.label)}
                      </span>
                    </td>
                    <td style="padding:7px 9px;border:1px solid #eef2f7;text-align:right;">${row.count.toLocaleString("ko-KR")}</td>
                    <td style="padding:7px 9px;border:1px solid #eef2f7;text-align:right;">${escapeHtml(formatObjectArea(row.area))}</td>
                    <td style="padding:7px 9px;border:1px solid #eef2f7;text-align:right;">${modelRows.length > 0 ? Math.round((row.count / modelRows.length) * 100) : 0}%</td>
                  </tr>
                `).join("")}
              </tbody>
            </table>
          </div>
        </div>
        <div style="border:1px solid #e2e8f0;border-radius:6px;padding:14px;">
          <div style="font-size:13px;font-weight:800;margin-bottom:10px;">도엽별 분포</div>
          ${buildBarChartSvg(sheetRows)}
        </div>
      </div>
    </section>
  `;
}

function buildDonutSvg(
  rows: Array<{ label: string; color: string; count: number; area: number }>,
): string {
  const total = rows.reduce((sum, row) => sum + row.count, 0);
  if (total <= 0) {
    return `<div style="height:190px;display:flex;align-items:center;justify-content:center;color:#94a3b8;font-size:12px;">차트 데이터 없음</div>`;
  }
  const radius = 58;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;
  const segments = rows.map((row) => {
    const length = (row.count / total) * circumference;
    const segment = `
      <circle cx="100" cy="100" r="${radius}" fill="none" stroke="${row.color}" stroke-width="34"
        stroke-dasharray="${length} ${circumference - length}" stroke-dashoffset="${-offset}"
        transform="rotate(-90 100 100)" />
    `;
    offset += length;
    return segment;
  }).join("");
  return `
    <svg width="220" height="190" viewBox="0 0 220 190" xmlns="http://www.w3.org/2000/svg">
      <circle cx="100" cy="100" r="${radius}" fill="none" stroke="#f1f5f9" stroke-width="34" />
      ${segments}
      <circle cx="100" cy="100" r="34" fill="#fff" />
    </svg>
  `;
}

function buildBarChartSvg(rows: Array<[string, number]>): string {
  if (rows.length === 0) {
    return `<div style="height:190px;display:flex;align-items:center;justify-content:center;color:#94a3b8;font-size:12px;">차트 데이터 없음</div>`;
  }
  const width = 660;
  const height = 210;
  const left = 54;
  const right = 24;
  const top = 16;
  const bottom = 42;
  const chartWidth = width - left - right;
  const chartHeight = height - top - bottom;
  const maxValue = Math.max(...rows.map(([, count]) => count), 1);
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((ratio) => Math.round(maxValue * ratio));
  const barGap = 24;
  const barWidth = Math.max(28, (chartWidth - barGap * (rows.length + 1)) / rows.length);
  return `
    <svg width="100%" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
      <line x1="${left}" y1="${top}" x2="${left}" y2="${top + chartHeight}" stroke="#94a3b8" stroke-width="1.2" />
      <line x1="${left}" y1="${top + chartHeight}" x2="${left + chartWidth}" y2="${top + chartHeight}" stroke="#94a3b8" stroke-width="1.2" />
      ${yTicks.map((tick) => {
        const y = top + chartHeight - (tick / maxValue) * chartHeight;
        return `
          <line x1="${left}" y1="${y}" x2="${left + chartWidth}" y2="${y}" stroke="#e2e8f0" stroke-dasharray="4 4" />
          <text x="${left - 10}" y="${y + 4}" text-anchor="end" font-size="11" fill="#94a3b8">${tick}</text>
        `;
      }).join("")}
      ${rows.map(([code, count], index) => {
        const x = left + barGap + index * (barWidth + barGap);
        const barHeight = (count / maxValue) * chartHeight;
        const y = top + chartHeight - barHeight;
        return `
          <rect x="${x}" y="${y}" width="${barWidth}" height="${barHeight}" rx="5" fill="#3b82f6" />
          <text x="${x + barWidth / 2}" y="${top + chartHeight + 24}" text-anchor="middle" font-size="12" fill="#64748b">${escapeHtml(code)}</text>
        `;
      }).join("")}
    </svg>
  `;
}

function formatIso(iso: string | null | undefined): string {
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

function formatObjectArea(m2: number): string {
  if (!Number.isFinite(m2)) return "-";
  return `${m2.toLocaleString("ko-KR", { maximumFractionDigits: 1 })} m²`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
