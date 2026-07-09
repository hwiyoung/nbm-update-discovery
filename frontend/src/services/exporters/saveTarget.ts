import type { Task } from "@/types";

export type ExportKind = "shp" | "dxf" | "dxf3d" | "pdf";

export interface ExportSaveTarget {
  save(blob: Blob, fallbackFilename?: string): Promise<void>;
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

export function getTaskFilenameStem(task: Pick<Task, "id" | "name">): string {
  // 한글·공백 등은 보존하지만 path 에서 위험한 문자는 제거.
  return task.name.replace(/[\\/:*?"<>|]/g, "_") || task.id;
}

export function getDefaultTaskExportFilename(
  task: Pick<Task, "id" | "name">,
  kind: ExportKind,
): string {
  const stem = getTaskFilenameStem(task);
  if (kind === "shp") return `nbm_${stem}.zip`;
  if (kind === "dxf") return `nbm_${stem}.dxf`;
  if (kind === "dxf3d") return `nbm_${stem}_3d.dxf`;
  return `nbm_${stem}_report.pdf`;
}

export function isExportSaveCanceled(err: unknown): boolean {
  return err instanceof ExportSaveCanceledError;
}

export async function createExportSaveTarget(
  suggestedName: string,
  kind: ExportKind,
): Promise<ExportSaveTarget> {
  const picker = (window as WindowWithSavePicker).showSaveFilePicker;
  if (typeof picker === "function" && window.isSecureContext) {
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
    async save(blob: Blob, fallbackFilename?: string): Promise<void> {
      triggerDownload(blob, fallbackFilename ?? suggestedName);
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
    await saveTarget.save(blob, filename);
    return;
  }
  const target = await createExportSaveTarget(filename, kind);
  await target.save(blob, filename);
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
