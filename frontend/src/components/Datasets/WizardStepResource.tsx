import { useEffect, useState } from "react";
import { CheckCircle2, FolderOpen, HardDrive, Loader2, MapPin, X } from "lucide-react";
import { Input } from "@/components/Common";
import { useDatasetsStore } from "@/stores/datasetsStore";
import type { PendingDataset } from "@/stores/datasetsStore";
import { DATASET_SOURCE_LABEL, DEFAULT_DATASET_PLATFORM } from "@/utils/constants";
import {
  getDatasetCaptureYearLabel,
  getDatasetRegionLabel,
  getDatasetRegionsTitle,
} from "@/utils/datasetMeta";
import { cn } from "@/utils/cn";
import { previewCaptureRegion, type RegionPreview } from "@/api/client";
import { ServerFileBrowser } from "./ServerFileBrowser";

export interface WizardStepResourceProps {
  side: "standard" | "compare";
  label: string;
  hint: string;
  selectedId: number | null;
  onSelectExisting: (id: number) => void;
  /** ServerFileBrowser 로 선택한 신규 파일 (제출 시 backend 등록). */
  pending: PendingDataset | null;
  onPending: (p: PendingDataset | null) => void;
  excludeId?: number | null;
}

/**
 * 위저드 자원 선택 단계 (기준/비교) — 한쪽 패널.
 *
 * 두 모드:
 *   1) 기존 자원에서 선택 (status='ready')
 *   2) 서버 파일 탐색기로 신규 영상 선택 (제출 시 backend 가 path 그대로 등록)
 *
 * 둘 중 하나만 활성. 신규 파일 선택 시 기존 선택 자동 해제.
 */
export function WizardStepResource({
  side,
  label,
  hint,
  selectedId,
  onSelectExisting,
  pending,
  onPending,
  excludeId,
}: WizardStepResourceProps) {
  const datasets = useDatasetsStore((s) => s.datasets);
  const candidates = datasets.filter(
    (d) => d.status === "ready" && d.id !== excludeId,
  );
  const [browserOpen, setBrowserOpen] = useState(false);

  const sideColor =
    side === "standard"
      ? { ring: "ring-blue-200", bg: "bg-blue-50", text: "text-blue-700", dot: "bg-blue-500" }
      : { ring: "ring-emerald-200", bg: "bg-emerald-50", text: "text-emerald-700", dot: "bg-emerald-500" };

  const onPendingChange = (partial: Partial<PendingDataset>) => {
    if (!pending) return;
    onPending({ ...pending, ...partial });
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 pb-2 mb-2 border-b border-slate-100">
        <span className={cn("w-1.5 h-1.5 rounded-full", sideColor.dot)} />
        <h4 className="text-sm font-bold text-slate-800">{label}</h4>
      </div>
      <p className="text-[11px] text-slate-500 mb-3">{hint}</p>

      {!pending ? (
        <button
          type="button"
          onClick={() => setBrowserOpen(true)}
          className={cn(
            "w-full flex items-center justify-center gap-2 h-11 rounded-md border-2 border-dashed border-slate-200 hover:border-blue-400 hover:bg-blue-50/30 text-sm font-bold text-slate-600 hover:text-blue-600 transition-colors",
          )}
        >
          <HardDrive size={15} />
          서버에서 영상 선택
        </button>
      ) : (
        <PendingFileCard
          pending={pending}
          color={sideColor}
          onChange={onPendingChange}
          onRemove={() => onPending(null)}
          onReplace={() => setBrowserOpen(true)}
        />
      )}

      {!pending ? (
        <>
          <div className="flex items-center gap-2 text-[11px] text-slate-400 my-3">
            <div className="flex-1 h-px bg-slate-100" />
            <span>또는 기존 자원에서 선택</span>
            <div className="flex-1 h-px bg-slate-100" />
          </div>
          {candidates.length === 0 ? (
            <div className="text-xs text-slate-400 text-center py-4">
              선택 가능한 자원이 없습니다.
            </div>
          ) : (
            <div className="border border-slate-100 rounded-md flex-1 min-h-0 overflow-y-auto custom-scrollbar">
              {candidates.map((d) => {
                const active = selectedId === d.id;
                return (
                  <button
                    key={d.id}
                    type="button"
                    aria-pressed={active}
                    onClick={() => onSelectExisting(d.id)}
                    className={cn(
                      "w-full flex items-center justify-between gap-2 px-2.5 py-2 text-left border-b border-slate-100 last:border-0 transition-colors",
                      active ? "bg-blue-50" : "hover:bg-slate-50",
                    )}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="text-[10px] font-bold text-slate-400">
                        #{d.id} · {DATASET_SOURCE_LABEL[d.source]}
                      </div>
                      <div className="text-xs font-bold text-slate-800 truncate">
                        {d.display_name}
                      </div>
                      <div
                        className="text-[11px] text-slate-500 truncate"
                        title={getDatasetRegionsTitle(d)}
                      >
                        {getDatasetRegionLabel(d)} · {getDatasetCaptureYearLabel(d)} · 도엽{" "}
                        {d.sheet_codes.length.toLocaleString("ko-KR")}매
                      </div>
                    </div>
                    {active ? (
                      <CheckCircle2 size={16} className="text-blue-600 shrink-0" />
                    ) : null}
                  </button>
                );
              })}
            </div>
          )}
        </>
      ) : null}

      <ServerFileBrowser
        open={browserOpen}
        onClose={() => setBrowserOpen(false)}
        title={side === "standard" ? "과년도 선택" : "당해년도 선택"}
        onSelect={(file) => {
          const baseName = file.name.replace(/\.(tif|tiff|jpg|jpeg|png)$/i, "");
          onPending({
            server_path: file.path,
            source_name: file.name,
            size_bytes: file.size ?? 0,
            display_name: baseName,
            platform: DEFAULT_DATASET_PLATFORM,
            taken_year: String(new Date().getFullYear()),
          });
        }}
      />
    </div>
  );
}

interface SideColor {
  ring: string;
  bg: string;
  text: string;
  dot: string;
}

function PendingFileCard({
  pending,
  color,
  onChange,
  onRemove,
  onReplace,
}: {
  pending: PendingDataset;
  color: SideColor;
  onChange: (partial: Partial<PendingDataset>) => void;
  onRemove: () => void;
  onReplace: () => void;
}) {
  const sizeMB =
    pending.size_bytes > 0
      ? (pending.size_bytes / 1024 / 1024).toFixed(1) + " MB"
      : "";

  // 파일 선택 시 backend 에 bbox + 매칭 권역 미리보기 요청. server_path 변경마다 재로드.
  const [preview, setPreview] = useState<RegionPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    setPreview(null);
    setPreviewError(null);
    setPreviewLoading(true);
    previewCaptureRegion(pending.server_path)
      .then((r) => {
        if (cancelled) return;
        setPreview(r);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setPreviewError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setPreviewLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [pending.server_path]);

  return (
    <div
      className={cn(
        "rounded-md p-3 space-y-2.5 border",
        color.bg,
        color.ring.replace("ring-", "border-"),
      )}
    >
      <div className="flex items-start gap-2">
        <FolderOpen size={15} className={cn("shrink-0 mt-0.5", color.text)} />
        <div className="flex-1 min-w-0">
          <div className="text-xs font-bold text-slate-800 truncate">
            {pending.source_name}
          </div>
          <div className="text-[10px] text-slate-500 font-mono truncate">
            {pending.server_path}
          </div>
          {sizeMB ? (
            <div className="text-[10px] text-slate-400 mt-0.5">{sizeMB}</div>
          ) : null}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            aria-label="다른 파일 선택"
            onClick={onReplace}
            className="text-[10px] font-bold text-slate-500 hover:text-blue-600 px-1.5 py-0.5 rounded hover:bg-white/60"
          >
            변경
          </button>
          <button
            type="button"
            aria-label="파일 제거"
            onClick={onRemove}
            className="p-1 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
          >
            <X size={12} />
          </button>
        </div>
      </div>

      {/* 촬영권역 — backend 가 bbox 읽어 매칭. 미리보기 시점. */}
      <div className="rounded-md border border-white/60 bg-white/50 px-2 py-1.5 flex items-start gap-1.5">
        <MapPin size={11} className="text-slate-500 shrink-0 mt-0.5" />
        {previewLoading ? (
          <div className="flex items-center gap-1 text-[10px] text-slate-500">
            <Loader2 size={10} className="animate-spin" /> 촬영권역 분석 중…
          </div>
        ) : previewError ? (
          <div className="text-[10px] text-red-600 leading-tight">
            <span className="font-bold">촬영권역 분석 실패</span>
            <br />
            {previewError}
          </div>
        ) : preview && preview.error ? (
          <div className="text-[10px] text-amber-700 leading-tight">
            <span className="font-bold">분석 불가</span>
            <br />
            {preview.error}
          </div>
        ) : preview && preview.regions.length > 0 ? (
          <div className="text-[10px] text-slate-700 leading-tight">
            <span className="font-bold text-slate-800">촬영권역</span>
            <br />
            <span className="text-slate-700">
              {preview.regions.join(", ")}
            </span>
          </div>
        ) : (
          <div className="text-[10px] text-slate-400">
            한반도 격자와 교집합 없음
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="col-span-2">
          <label className="block text-[10px] font-bold text-slate-500 mb-1">
            표시 이름
          </label>
          <Input
            value={pending.display_name}
            onChange={(e) => onChange({ display_name: e.target.value })}
          />
        </div>
        <div className="col-span-2">
          <label className="block text-[10px] font-bold text-slate-500 mb-1">
            촬영 연도
          </label>
          <Input
            type="number"
            min={1990}
            max={2100}
            placeholder="YYYY"
            value={pending.taken_year}
            onChange={(e) => onChange({ taken_year: e.target.value })}
          />
        </div>
      </div>
    </div>
  );
}
