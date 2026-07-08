import { useState } from "react";
import {
  CalendarDays,
  FolderOpen,
  HardDrive,
  Layers,
  MapPin,
  Sparkles,
  Trash2,
} from "lucide-react";
import toast from "react-hot-toast";
import { Badge, Button, Modal, ModalDescription } from "@/components/Common";
import type { Dataset } from "@/types";
import { DATASET_SOURCE_LABEL, DATASET_STATUS_LABEL } from "@/utils/constants";
import {
  formatDatasetFileSize,
  getDatasetCaptureYearLabel,
  getDatasetRegionLabel,
  getDatasetRegionsTitle,
} from "@/utils/datasetMeta";
import { useDatasetsStore } from "@/stores/datasetsStore";
import { auth } from "@/utils/auth";
import { cn } from "@/utils/cn";

const STATUS_TONE: Record<Dataset["status"], "slate" | "blue" | "emerald" | "amber" | "red"> = {
  pending: "slate",
  processing: "blue",
  ready: "emerald",
  failed: "red",
};

/** 데이터셋 한 줄 — 우측 패널 리스트용. 클릭 시 베이스맵에 bbox 표시 + fly. */
export function DatasetRow({ dataset }: { dataset: Dataset }) {
  const tone = STATUS_TONE[dataset.status];
  const statusLabel = DATASET_STATUS_LABEL[dataset.status];
  const sourceLabel = getDatasetSourceLabel(dataset);
  const deleteDataset = useDatasetsStore((s) => s.deleteDataset);
  const isRecent = useDatasetsStore((s) =>
    s.recentlyAddedDatasetIds.includes(dataset.id),
  );
  const isSelected = useDatasetsStore((s) => s.selectedDatasetId === dataset.id);
  const selectDataset = useDatasetsStore((s) => s.selectDataset);

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const regionLabel = getDatasetRegionLabel(dataset);
  const regionTitle = getDatasetRegionsTitle(dataset);
  const captureYearLabel = getDatasetCaptureYearLabel(dataset);
  const sizeLabel = formatDatasetFileSize(dataset.size_bytes);

  const onConfirmDelete = async () => {
    setSubmitting(true);
    try {
      await deleteDataset(dataset.id);
      toast.success(`삭제 — ${dataset.display_name}`);
      setConfirmOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <div
        role="button"
        tabIndex={0}
        onClick={() => selectDataset(dataset.id)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            selectDataset(dataset.id);
          }
        }}
        className={cn(
          "group bg-white border rounded-md px-3 py-2 hover:shadow-sm transition-all cursor-pointer",
          isSelected
            ? "border-blue-400 ring-2 ring-blue-100 bg-blue-50/40"
            : isRecent
              ? "border-emerald-300 ring-2 ring-emerald-100 bg-emerald-50/30"
              : "border-slate-100 hover:border-slate-200",
        )}
      >
        <div className="flex items-center gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs font-bold text-slate-800 truncate">
                {dataset.display_name}
              </span>
              {isRecent ? (
                <span className="inline-flex items-center gap-0.5 text-[10px] font-bold text-emerald-700 bg-emerald-100 border border-emerald-200 rounded px-1.5 py-0.5 shrink-0">
                  <Sparkles size={9} />
                  방금 등록
                </span>
              ) : null}
            </div>
            <div className="flex items-center gap-1.5 flex-wrap text-[11px] text-slate-500">
              <MapPin size={11} className="text-slate-400" />
              <span title={regionTitle}>{regionLabel}</span>
              <span className="text-slate-300">|</span>
              <CalendarDays size={11} className="text-slate-400" />
              <span className="tabular-nums">{captureYearLabel}</span>
              <span className="text-slate-300">|</span>
              <Layers size={11} className="text-slate-400" />
              <span>도엽 {dataset.sheet_codes.length.toLocaleString("ko-KR")}매</span>
              <span className="text-slate-300">|</span>
              <HardDrive size={11} className="text-slate-400" />
              <span className="tabular-nums">{sizeLabel}</span>
            </div>
            <div className="flex items-center gap-1.5 flex-wrap text-[10px] text-slate-400 mt-1">
              <span className="px-1.5 py-0.5 rounded bg-slate-50 border border-slate-100 text-slate-600 font-bold">
                {sourceLabel}
              </span>
            </div>
            {dataset.status === "failed" && dataset.thumbnail_url ? (
              <div className="text-[10px] text-red-600 mt-1 truncate" title={dataset.thumbnail_url}>
                실패 사유: {dataset.thumbnail_url}
              </div>
            ) : null}
            {dataset.host_path ? (
              <div
                className="flex items-center gap-1 mt-1 text-[10px] text-slate-400 min-w-0"
                title={dataset.host_path}
              >
                <FolderOpen size={10} className="shrink-0" />
                <span className="truncate font-mono">{dataset.host_path}</span>
              </div>
            ) : null}
          </div>

          <div className="shrink-0 flex items-center gap-1">
            <Badge tone={tone}>{statusLabel}</Badge>
            {auth.canUploadDataset() ? (
              <button
                type="button"
                aria-label="데이터셋 삭제"
                onClick={(e) => {
                  e.stopPropagation();
                  setConfirmOpen(true);
                }}
                className="p-1 text-slate-300 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
              >
                <Trash2 size={12} />
              </button>
            ) : null}
          </div>
        </div>
      </div>

      <Modal
        open={confirmOpen}
        onOpenChange={(o) => (!o ? setConfirmOpen(false) : null)}
        title="데이터셋 삭제"
        icon={<Trash2 size={20} />}
        width={460}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmOpen(false)} disabled={submitting}>
              취소
            </Button>
            <Button variant="danger" onClick={onConfirmDelete} disabled={submitting}>
              {submitting ? "삭제 중…" : "영구 삭제"}
            </Button>
          </>
        }
      >
        <ModalDescription>데이터셋 영구 삭제 확인</ModalDescription>
        <p className="text-sm text-slate-700">
          <span className="font-bold">{dataset.display_name}</span>{" "}
          (#{dataset.id}) 데이터셋을 영구 삭제합니다.
        </p>
        <p className="text-xs text-red-600 mt-2 font-bold">
          복구 불가. 본 자원을 사용 중인 변화탐지 작업이 있으면 삭제가 차단됩니다.
        </p>
      </Modal>
    </>
  );
}

function getDatasetSourceLabel(dataset: Dataset): string {
  return DATASET_SOURCE_LABEL[dataset.source];
}
