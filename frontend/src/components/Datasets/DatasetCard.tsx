import { useState } from "react";
import { CalendarDays, HardDrive, Image, MapPin, Trash2 } from "lucide-react";
import toast from "react-hot-toast";
import { Badge, Button, Card, Modal, ModalDescription } from "@/components/Common";
import type { Dataset } from "@/types";
import { DATASET_SOURCE_LABEL, DATASET_STATUS_LABEL } from "@/utils/constants";
import {
  formatDatasetFileSize,
  getDatasetCaptureYearLabel,
  getDatasetRegionLabel,
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

export interface DatasetCardProps {
  dataset: Dataset;
  selected?: boolean;
  onClick?: (dataset: Dataset) => void;
}

export function DatasetCard({ dataset, selected, onClick }: DatasetCardProps) {
  const tone = STATUS_TONE[dataset.status];
  const statusLabel = DATASET_STATUS_LABEL[dataset.status];
  const sourceLabel = DATASET_SOURCE_LABEL[dataset.source];
  const deleteDataset = useDatasetsStore((s) => s.deleteDataset);

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

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
      <Card
        padding={4}
        clickable={Boolean(onClick)}
        onClick={() => onClick?.(dataset)}
        tabIndex={onClick ? 0 : undefined}
        className={cn(
          "group relative",
          selected && "ring-2 ring-blue-500 shadow-md",
        )}
      >
        {/* 휴지통 — hover 시에만 노출 */}
        {auth.canUploadDataset() ? (
          <button
            type="button"
            aria-label="데이터셋 삭제"
            onClick={(e) => {
              e.stopPropagation();
              setConfirmOpen(true);
            }}
            className="absolute top-2 left-2 z-10 p-1.5 rounded-md bg-white/95 text-slate-400 hover:text-red-600 hover:bg-red-50 border border-slate-200 shadow-sm opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"
          >
            <Trash2 size={14} />
          </button>
        ) : null}

        {/* 썸네일 placeholder */}
        <div className="relative aspect-[16/10] -mx-4 -mt-4 mb-3 bg-slate-100 rounded-t-xl flex items-center justify-center text-slate-300">
          <Image size={36} />
          <Badge tone={tone} className="absolute top-2 right-2">
            {statusLabel}
          </Badge>
        </div>

        <div className="space-y-2">
          <div>
            <div className="text-[11px] font-bold text-slate-400 mb-0.5">
              {sourceLabel} · #{dataset.id}
            </div>
            <h3 className="text-sm font-bold text-slate-800 truncate">
              {dataset.display_name}
            </h3>
          </div>

          <div className="grid grid-cols-2 gap-x-2 gap-y-1.5 text-[11px] text-slate-500">
            <CardField icon={<MapPin size={12} />} label={getDatasetRegionLabel(dataset)} />
            <CardField
              icon={<HardDrive size={12} />}
              label={formatDatasetFileSize(dataset.size_bytes)}
            />
            <CardField
              icon={<CalendarDays size={12} />}
              label={getDatasetCaptureYearLabel(dataset)}
              colSpan
            />
          </div>

          <div className="text-[11px] text-slate-500 pt-1 border-t border-slate-100">
            커버 도엽{" "}
            <span className="font-bold text-slate-700">
              {dataset.sheet_codes.length.toLocaleString("ko-KR")}매
            </span>
          </div>
        </div>
      </Card>

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

function CardField({
  icon,
  label,
  colSpan,
}: {
  icon: React.ReactNode;
  label: string;
  colSpan?: boolean;
}) {
  return (
    <div className={`flex items-center gap-1 truncate ${colSpan ? "col-span-2" : ""}`}>
      <span className="text-slate-400 shrink-0">{icon}</span>
      <span className="truncate">{label}</span>
    </div>
  );
}
