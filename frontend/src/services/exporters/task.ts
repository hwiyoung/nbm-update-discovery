/**
 * Task(=프로젝트) 단위 내보내기 — 매칭된 모든 sheet 의 detections 를 한 파일로.
 *
 * SHP/DXF/PDF 모두 listTaskDetections() 한 번 호출 → core 로직 재사용.
 */

import { getTaskStatus, listTaskDetections } from "@/api/client";
import type { DetectionObject, Task } from "@/types";
import {
  CHANGE_TYPE_BY_CODE,
  OBJECT_CATEGORY_LABEL,
  VISIBLE_CHANGE_TYPES,
} from "@/utils/constants";
import { convertPolygon4326to5186, PRJ_5186 } from "./proj";
import { getTaskFilenameStem, saveExportBlob } from "./saveTarget";
import type { ExportSaveTarget } from "./saveTarget";

async function fetchTaskAndDetections(
  taskId: string,
): Promise<{ task: Task; detections: DetectionObject[] }> {
  const [task, detections] = await Promise.all([
    getTaskStatus(taskId),
    listTaskDetections(taskId),
  ]);
  return { task, detections: detections.filter((d) => !d.is_deleted) };
}

// ============================================================
// SHP — shp-write
//
// shp-write 0.3.2 의 기본 download() 는 `location.href = 'data:...'` 로
// SPA 를 navigate 시켜 다운로드가 실패한다. 또한 zip 내부 PRJ 가 WGS84 로
// 하드코딩돼 좌표(EPSG:5186)와 불일치한다. 본 함수는 직접 zip 을 만들고
// PRJ 를 5186 으로 덮어써서 Blob 으로 트리거한다.
//
// 백엔드 결과물이 SHP 인 경우는 그대로 받아오고, 아닌 경우(GeoJSON 등) 본 함수가
// detections 를 클라이언트 측에서 SHP 로 변환한다 — "프로젝트 결과물에 SHP 가
// 없으면 변환해서 내보내기".
// ============================================================
export async function exportTaskAsShp(
  taskId: string,
  saveTarget?: ExportSaveTarget,
): Promise<void> {
  const { task, detections } = await fetchTaskAndDetections(taskId);

  if (detections.length === 0) {
    throw new Error("내보낼 변화탐지 객체가 없습니다");
  }

  const features = detections.map((d, index) => {
    const coords5186 = convertPolygon4326to5186(d.geometry.coordinates);
    return {
      type: "Feature" as const,
      properties: {
        NO: index + 1,
        MAP_IDX: d.sheet_code,
        CLASS: OBJECT_CATEGORY_LABEL[d.model],
        TYPE: d.change_type,
        TYPE_KO: CHANGE_TYPE_BY_CODE[d.change_type].label,
        CONF: d.confidence,
        AREA_M2: d.area_m2,
        REGION: d.region_code,
        ADDR: d.address,
        MEMO: d.reviewer_memo,
        OBJ_ID: d.id,
      },
      geometry: {
        type: "Polygon" as const,
        coordinates: coords5186,
      },
    };
  });

  const fc = {
    type: "FeatureCollection" as const,
    features,
  };

  const stem = getTaskFilenameStem(task);
  const folder = `nbm_${stem}`;
  const layerName = `nbm_${stem}_detections`;

  // shp-write 의 zip() 으로 base64 zip 생성 (zip 안에 .shp/.shx/.dbf/.prj 포함).
  // download() 을 쓰지 않는 이유: 'data:' URI 가 SPA 를 navigate 시킨다.
  const shpwrite = (await import("shp-write")).default;

  let base64Zip: string;
  try {
    base64Zip = shpwrite.zip(fc as never, {
      folder,
      types: { polygon: layerName },
    });
  } catch (err) {
    throw new Error(
      `SHP 변환 실패 — detections=${detections.length} : ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // shp-write 의 transitive dep 인 JSZip 2.5.0 (sync API) 으로 zip 을 열어
  // .prj 파일을 EPSG:5186 PRJ 로 교체한다 — generate.type='blob' 으로 트리거.
  const JSZip = (await import("jszip")).default;
  const archive = new JSZip();
  archive.load(base64Zip, { base64: true });

  for (const relPath of Object.keys(archive.files)) {
    if (relPath.toLowerCase().endsWith(".prj")) {
      archive.file(relPath, PRJ_5186);
    }
    if (relPath.toLowerCase().endsWith(".dbf")) {
      archive.file(relPath.replace(/\.dbf$/i, ".cpg"), "UTF-8");
    }
  }

  const blob = archive.generate({ type: "blob" }) as Blob;
  await saveExportBlob(blob, `${folder}.zip`, "shp", saveTarget);
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
): Promise<Export3dStatistics> {
  const base = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/$/, "") || "/api/v1";

  // 1) POST — 서버가 sheet index sindex 로 DEM 조립 + DXF 생성
  const res = await fetch(`${base}/tasks/${encodeURIComponent(taskId)}/export/dxf-3d`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ layer_name: layerName }),
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
): Promise<void> {
  const { task, detections } = await fetchTaskAndDetections(taskId);

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
    `nbm_${stem}.dxf`,
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
): Promise<void> {
  const { task, detections: rawDetections } = await fetchTaskAndDetections(taskId);
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
      `nbm_${getTaskFilenameStem(task)}_report.pdf`,
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
