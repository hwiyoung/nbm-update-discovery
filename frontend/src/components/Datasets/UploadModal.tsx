import { useState } from "react";
import { FileImage, HardDrive, Upload, X } from "lucide-react";
import { Button, Input, Modal, ModalDescription } from "@/components/Common";
import { useDatasetsStore, type PendingUpload } from "@/stores/datasetsStore";
import { uploadDatasetFromServer } from "@/services/upload";
import type { FsEntry } from "@/api/client";
import type { UploadProgress } from "@/types";
import { DEFAULT_DATASET_PLATFORM } from "@/utils/constants";
import { ServerFileBrowser } from "./ServerFileBrowser";
import toast from "react-hot-toast";

type UploadSnapshot = {
  serverFile: FsEntry;
  display_name: string;
  year: number;
};

/**
 * 정사영상 업로드 모달.
 * 1차 mock: setTimeout 시뮬레이션 (services/upload.ts).
 * 이정표 5: tus-js-client 통합으로 실 업로드.
 */
export function UploadModal() {
  const open = useDatasetsStore((s) => s.uploadOpen);
  const close = useDatasetsStore((s) => s.closeUpload);
  const appendDataset = useDatasetsStore((s) => s.appendDataset);
  const addPendingUpload = useDatasetsStore((s) => s.addPendingUpload);
  const updatePendingUpload = useDatasetsStore((s) => s.updatePendingUpload);
  const removePendingUpload = useDatasetsStore((s) => s.removePendingUpload);

  const [serverFile, setServerFile] = useState<FsEntry | null>(null);
  const [browserOpen, setBrowserOpen] = useState(false);
  const [meta, setMeta] = useState({
    display_name: "",
    taken_year: String(new Date().getFullYear()),
  });

  const reset = () => {
    setServerFile(null);
    setBrowserOpen(false);
    setMeta({
      display_name: "",
      taken_year: String(new Date().getFullYear()),
    });
  };

  const onServerSelect = (selected: FsEntry) => {
    const baseName = selected.name.replace(/\.(tif|tiff|jpg|jpeg|png)$/i, "");
    setServerFile(selected);
    if (!meta.display_name) {
      setMeta((m) => ({ ...m, display_name: baseName }));
    }
  };

  const onSubmit = () => {
    if (!serverFile) {
      toast.error("파일을 선택하세요");
      return;
    }
    if (!meta.display_name) {
      toast.error("표시 이름을 입력하세요");
      return;
    }
    const year = Number(meta.taken_year);
    if (!Number.isInteger(year) || year < 1990 || year > 2100) {
      toast.error("촬영 연도를 1990~2100 사이로 입력하세요");
      return;
    }

    // 모달 즉시 닫고 백그라운드 업로드. 진행률은 데이터셋 패널·헤더 종이 표시.
    const snapshot = { serverFile, ...meta, year };
    reset();
    close();
    void runUpload(snapshot);
  };

  const runUpload = async (snap: UploadSnapshot) => {
    const uploadId = `up-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`;
    addPendingUpload({
      id: uploadId,
      display_name: snap.display_name || snap.serverFile.name,
      side: "standalone",
      phase: "analyzing",
      percent: 20,
      message: "파일 등록 시작…",
    });
    const tid = `upload-${uploadId}`;
    toast.loading(`${snap.display_name} 등록 중…`, { id: tid });
    try {
      const uploadMeta = {
        display_name: snap.display_name,
        platform: DEFAULT_DATASET_PLATFORM,
        taken_start_at: new Date(`${snap.year}-01-01T00:00:00Z`).toISOString(),
        taken_end_at: new Date(`${snap.year}-12-31T23:59:59Z`).toISOString(),
      };
      const handleProgress = (p: UploadProgress) => {
        const phase: PendingUpload["phase"] =
          p.stage === "uploading"
            ? "uploading"
            : p.stage === "processing"
              ? "analyzing"
              : p.stage === "done"
                ? "done"
                : p.stage === "error"
                  ? "error"
                  : "analyzing";
        updatePendingUpload(uploadId, {
          phase,
          percent: p.percent,
          message: p.message,
        });
      };
      const dataset = await uploadDatasetFromServer({
        serverPath: snap.serverFile.path,
        sourceName: snap.serverFile.name,
        meta: uploadMeta,
        onProgress: handleProgress,
      });
      appendDataset(dataset);
      updatePendingUpload(uploadId, { phase: "done", percent: 100 });
      window.setTimeout(() => removePendingUpload(uploadId), 5000);
      toast.success(`${snap.display_name} 등록 완료`, { id: tid });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      updatePendingUpload(uploadId, { phase: "error", error: msg });
      toast.error(msg, { id: tid });
    }
  };

  const onClose = () => {
    reset();
    close();
  };

  return (
    <Modal
      open={open}
      onOpenChange={(o) => (!o ? onClose() : null)}
      title="외부 정사영상 등록"
      icon={<Upload size={20} />}
      width={520}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            취소
          </Button>
          <Button variant="primary" onClick={onSubmit}>
            등록
          </Button>
        </>
      }
    >
      <ModalDescription>외부 정사영상 파일 등록</ModalDescription>

      <div className="space-y-4">
        <div>
          <label className="block text-xs font-bold text-slate-500 mb-1.5">
            파일
          </label>
          {serverFile ? (
            <div className="flex items-center justify-between gap-3 p-3 bg-slate-50 border border-slate-200 rounded-md">
              <FileImage size={16} className="text-slate-500 shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-bold text-slate-800 truncate">
                  {serverFile.name}
                </div>
                <div className="text-[11px] text-slate-500 font-mono truncate">
                  {serverFile.path}
                </div>
                {serverFile.size != null ? (
                  <div className="text-[11px] text-slate-400">
                    {formatSize(serverFile.size)}
                  </div>
                ) : null}
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  type="button"
                  onClick={() => setBrowserOpen(true)}
                  className="text-xs font-bold text-slate-500 hover:text-blue-600 px-2 py-1 rounded hover:bg-white"
                >
                  변경
                </button>
                <button
                  type="button"
                  aria-label="서버 영상 제거"
                  onClick={() => setServerFile(null)}
                  className="p-1 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded"
                >
                  <X size={14} />
                </button>
              </div>
            </div>
          ) : (
            <Button
              variant="secondary"
              fullWidth
              leftIcon={<HardDrive size={15} />}
              onClick={() => setBrowserOpen(true)}
            >
              파일 선택
            </Button>
          )}
        </div>

        {/* 메타 입력 */}
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <label className="block text-xs font-bold text-slate-500 mb-1.5">
              표시 이름
            </label>
            <Input
              value={meta.display_name}
              onChange={(e) =>
                setMeta({ ...meta, display_name: e.target.value })
              }
            />
          </div>
          <div className="col-span-2">
            <label className="block text-xs font-bold text-slate-500 mb-1.5">
              촬영 연도
            </label>
            <Input
              type="number"
              min={1990}
              max={2100}
              placeholder="YYYY"
              value={meta.taken_year}
              onChange={(e) => setMeta({ ...meta, taken_year: e.target.value })}
            />
          </div>
        </div>
      </div>

      <ServerFileBrowser
        open={browserOpen}
        onClose={() => setBrowserOpen(false)}
        title="파일 선택"
        onSelect={onServerSelect}
      />
    </Modal>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
