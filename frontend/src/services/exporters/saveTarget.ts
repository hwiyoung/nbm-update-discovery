import type { Task } from "@/types";

export type ExportKind = "shp" | "dxf" | "dxf3d" | "pdf";

export interface ExportSaveTarget {
  save(blob: Blob): Promise<void>;
}

interface SaveFilePickerType {
  description: string;
  accept: Record<string, string[]>;
}

interface SaveFilePickerOptions {
  suggestedName: string;
  types: SaveFilePickerType[];
}

interface SaveFileWritable {
  write(data: Blob): Promise<void>;
  close(): Promise<void>;
  abort?: () => Promise<void>;
}

interface SaveFileHandle {
  createWritable(): Promise<SaveFileWritable>;
}

type WindowWithSavePicker = Window & {
  showSaveFilePicker?: (options: SaveFilePickerOptions) => Promise<SaveFileHandle>;
};

const SAVE_PICKER_TYPES: Record<ExportKind, SaveFilePickerType[]> = {
  shp: [{ description: "Shapefile ZIP", accept: { "application/zip": [".zip"] } }],
  dxf: [{ description: "DXF", accept: { "application/dxf": [".dxf"] } }],
  dxf3d: [{ description: "3D DXF", accept: { "application/dxf": [".dxf"] } }],
  pdf: [{ description: "PDF", accept: { "application/pdf": [".pdf"] } }],
};

class ExportSaveCanceledError extends Error {
  constructor() {
    super("저장이 취소되었습니다");
    this.name = "ExportSaveCanceledError";
  }
}

export function getTaskFilenameStem(task: Pick<Task, "id" | "created_at">): string {
  const createdAt = new Date(task.created_at);
  if (Number.isNaN(createdAt.getTime())) {
    return task.id.replace(/[\\/:*?"<>|]/g, "_") || "project";
  }

  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(createdAt);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "00";
  return `${value("year")}${value("month")}${value("day")}_${value("hour")}${value("minute")}${value("second")}`;
}

export function getDefaultTaskExportFilename(
  task: Pick<Task, "id" | "created_at">,
  kind: ExportKind,
): string {
  const stem = getTaskFilenameStem(task);
  if (kind === "shp") return `${stem}.zip`;
  if (kind === "dxf") return `${stem}_2d.dxf`;
  if (kind === "dxf3d") return `${stem}_3d.dxf`;
  return `${stem}_report.pdf`;
}

export function isExportSaveCanceled(err: unknown): boolean {
  return err instanceof ExportSaveCanceledError;
}

export function canUseNativeSavePicker(): boolean {
  return typeof (window as WindowWithSavePicker).showSaveFilePicker === "function"
    && window.isSecureContext;
}

export async function createExportSaveTarget(
  suggestedName: string,
  kind: ExportKind,
): Promise<ExportSaveTarget> {
  const picker = (window as WindowWithSavePicker).showSaveFilePicker;
  if (canUseNativeSavePicker() && picker) {
    try {
      const handle = await picker({
        suggestedName,
        types: SAVE_PICKER_TYPES[kind],
      });
      return {
        async save(blob: Blob): Promise<void> {
          const writable = await handle.createWritable();
          try {
            await writable.write(blob);
            await writable.close();
          } catch (err) {
            if (writable.abort) {
              await writable.abort().catch(() => undefined);
            }
            throw err;
          }
        },
      };
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        throw new ExportSaveCanceledError();
      }
      throw err;
    }
  }

  return {
    async save(blob: Blob): Promise<void> {
      // fallback modal에서 사용자가 수정한 suggestedName을 exporter의 내부 파일명보다
      // 우선한다. 그래야 입력한 파일명이 실제 브라우저 다운로드명에 그대로 반영된다.
      triggerDownload(blob, suggestedName);
    },
  };
}

export async function saveExportBlob(
  blob: Blob,
  filename: string,
  kind: ExportKind,
  saveTarget?: ExportSaveTarget,
): Promise<void> {
  if (saveTarget) {
    await saveTarget.save(blob);
    return;
  }
  const target = await createExportSaveTarget(filename, kind);
  await target.save(blob);
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
