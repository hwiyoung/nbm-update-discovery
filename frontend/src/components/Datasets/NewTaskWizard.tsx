import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Wand2 } from "lucide-react";
import {
  Button,
  Modal,
  ModalDescription,
  Tabs,
} from "@/components/Common";
import type { TabItem } from "@/components/Common";
import { useDatasetsStore, type WizardStep } from "@/stores/datasetsStore";
import type { PendingDataset, PendingUpload } from "@/stores/datasetsStore";
import { useTasksStore } from "@/stores/tasksStore";
import {
  createTask,
  getDatasetOverlapRatio,
  getDatasetPreflightMetadata,
  registerFromServerPath,
} from "@/api/client";
import { DEFAULT_DATASET_PLATFORM } from "@/utils/constants";
import { WizardStepResource } from "./WizardStepResource";
import { WizardStepMeta } from "./WizardStepMeta";
import toast from "react-hot-toast";

const STEPS: TabItem<WizardStep>[] = [
  { value: "resource", label: "1. 과년도 · 당해년도" },
  { value: "meta", label: "2. 작업 메타 · 등록 요약" },
];

/**
 * 신규 변화탐지 작업 위저드 — 단일 흐름.
 *
 * 단계:
 *   1. 자원 선택: 과년도·당해년도 영상을 한 페이지(좌·우 분할)에서 동시 선택
 *      - 기존 데이터셋에서 선택 또는 서버 파일 탐색기로 신규 영상 선택
 *   2. 작업 메타 + 등록 요약: 좌측 메타 입력 (작업명·설명·객체·자동실행),
 *      우측 실시간 요약 (자원 카드) → "등록" → registerFromServerPath +
 *      createTask + (옵션) Celery enqueue. 실행 상태는 프로젝트 상세보기에서 확인.
 */
export function NewTaskWizard() {
  const open = useDatasetsStore((s) => s.wizardOpen);
  const close = useDatasetsStore((s) => s.closeWizard);
  const step = useDatasetsStore((s) => s.wizardStep);
  const setStep = useDatasetsStore((s) => s.setWizardStep);
  const selection = useDatasetsStore((s) => s.wizardSelection);
  const setSelection = useDatasetsStore((s) => s.setWizardSelection);
  const datasets = useDatasetsStore((s) => s.datasets);
  const appendDataset = useDatasetsStore((s) => s.appendDataset);
  const setPendingTaskId = useDatasetsStore((s) => s.setPendingTaskId);
  const addPendingUpload = useDatasetsStore((s) => s.addPendingUpload);
  const updatePendingUpload = useDatasetsStore((s) => s.updatePendingUpload);
  const removePendingUpload = useDatasetsStore((s) => s.removePendingUpload);
  const appendTask = useTasksStore((s) => s.appendTask);
  const navigate = useNavigate();

  interface PendingCreateState {
    snap: typeof selection;
    standardId: number;
    compareId: number;
  }
  const [submitting, setSubmitting] = useState(false);
  const [overlap, setOverlap] = useState<{
    key: string;
    loading: boolean;
    ratio: number | null;
    method: "metadata" | "sheets" | null;
    commonSheets: string[];
    error: string | null;
  }>({
    key: "",
    loading: false,
    ratio: null,
    method: null,
    commonSheets: [],
    error: null,
  });

  const hasStandard = Boolean(
    selection.standardId || selection.standardPending,
  );
  const hasCompare = Boolean(selection.compareId || selection.comparePending);
  const hasPendingSelection = Boolean(selection.standardPending || selection.comparePending);
  const existingPairKey =
    selection.standardId && selection.compareId
      ? `${selection.standardId}:${selection.compareId}`
      : "";

  useEffect(() => {
    if (!selection.standardId || !selection.compareId) {
      setOverlap({
        key: "",
        loading: false,
        ratio: null,
        method: null,
        commonSheets: [],
        error: null,
      });
      return;
    }

    let cancelled = false;
    const key = `${selection.standardId}:${selection.compareId}`;
    setOverlap({
      key,
      loading: true,
      ratio: null,
      method: null,
      commonSheets: [],
      error: null,
    });

    getDatasetPreflightMetadata(selection.standardId, selection.compareId)
      .then((result) => {
        if (cancelled) return;
        setOverlap({
          key,
          loading: false,
          ratio: result.overlap_ratio,
          method: "metadata",
          commonSheets: [],
          error: null,
        });
      })
      .catch(async (err: unknown) => {
        try {
          const fallback = await getDatasetOverlapRatio(selection.standardId!, selection.compareId!);
          if (cancelled) return;
          setOverlap({
            key,
            loading: false,
            ratio: fallback.ratio,
            method: "sheets",
            commonSheets: fallback.common_sheets,
            error: err instanceof Error ? err.message : String(err),
          });
        } catch (fallbackErr: unknown) {
          if (cancelled) return;
          setOverlap({
            key,
            loading: false,
            ratio: null,
            method: null,
            commonSheets: [],
            error: fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr),
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [selection.standardId, selection.compareId]);

  const canNext = (() => {
    if (step === "resource") {
      if (!hasStandard || !hasCompare) return false;
      if (existingPairKey && overlap.key === existingPairKey && !overlap.loading && overlap.ratio === 0) {
        return false;
      }
      return true;
    }
    if (step === "meta") {
      return (
        hasStandard &&
        hasCompare &&
        selection.name.trim().length > 0 &&
        selection.models.length > 0
      );
    }
    return false;
  })();

  const onPrev = () => {
    if (step === "meta") setStep("resource");
  };

  const validatePending = (
    p: PendingDataset,
    side: string,
  ): string | null => {
    if (!p.display_name.trim()) return `${side} 자원의 표시 이름을 입력하세요`;
    const y = Number(p.taken_year);
    if (!Number.isInteger(y) || y < 1990 || y > 2100)
      return `${side} 자원의 촬영 연도를 1990~2100 사이로 입력하세요`;
    return null;
  };

  const yearToRange = (year: string): { start: string; end: string } => ({
    start: new Date(`${year}-01-01T00:00:00Z`).toISOString(),
    end: new Date(`${year}-12-31T23:59:59Z`).toISOString(),
  });

  const onSubmitFinal = async () => {
    if (selection.standardPending) {
      const err = validatePending(selection.standardPending, "과년도");
      if (err) {
        toast.error(err);
        return;
      }
    }
    if (selection.comparePending) {
      const err = validatePending(selection.comparePending, "당해년도");
      if (err) {
        toast.error(err);
        return;
      }
    }

    const snapshot = selection;
    setSubmitting(true);
    close();
    void runSubmission(snapshot);
  };

  const runSubmission = async (
    snap: typeof selection,
  ): Promise<void> => {
    let stdId = snap.standardId;
    let cmpId = snap.compareId;

    const registerOne = async (
      pending: PendingDataset,
      side: "standard" | "compare",
      sideLabel: string,
    ) => {
      const uploadId = `up-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`;
      addPendingUpload({
        id: uploadId,
        display_name: pending.display_name || pending.source_name,
        side,
        phase: "analyzing",
        percent: 30,
        message: `${sideLabel}영상 좌표 분석 중…`,
      });
      try {
        const range = yearToRange(pending.taken_year);
        const ds = await registerFromServerPath({
          server_path: pending.server_path,
          display_name: pending.display_name,
          platform: DEFAULT_DATASET_PLATFORM,
          taken_start_at: range.start,
          taken_end_at: range.end,
        });
        if (ds.status === "failed") {
          updatePendingUpload(uploadId, {
            phase: "error",
            error: `${sideLabel}영상 처리 실패`,
          });
          throw new Error(`${sideLabel}영상 처리 실패: ${ds.thumbnail_url ?? "원인 미상"}`);
        }
        appendDataset(ds);
        updatePendingUpload(uploadId, { phase: "done", percent: 100 });
        window.setTimeout(() => removePendingUpload(uploadId), 8000);
        return ds.id;
      } catch (err) {
        updatePendingUpload(uploadId, {
          phase: "error",
          error: err instanceof Error ? err.message : String(err),
        } satisfies Partial<PendingUpload>);
        throw err;
      }
    };

    try {
      if (snap.standardPending) {
        stdId = await registerOne(snap.standardPending, "standard", "과년도");
      }
      if (snap.comparePending) {
        cmpId = await registerOne(snap.comparePending, "compare", "당해년도");
      }

      if (!stdId || !cmpId) {
        throw new Error("과년도·당해년도 자원이 모두 필요합니다");
      }

      await createFinalTask(
        {
          snap,
          standardId: stdId,
          compareId: cmpId,
        },
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const createFinalTask = async (pending: PendingCreateState): Promise<void> => {
    try {
      const task = await createTask({
        name: pending.snap.name,
        description: pending.snap.description,
        models: pending.snap.models,
        compare_type: "image-image",
        standard_resource_id: pending.standardId,
        compare_resource_id: pending.compareId,
        auto_run: pending.snap.autoRun,
      });

      appendTask(task);
      if (pending.snap.autoRun) {
        setPendingTaskId(task.id);
      }
      navigate(`/tasks/${task.id}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(msg);
    }
  };

  const onNext = async () => {
    if (step === "resource") setStep("meta");
    else if (step === "meta") await onSubmitFinal();
  };

  const isFinal = step === "meta";
  const primaryLabel = isFinal
    ? selection.autoRun
      ? "등록 + 추론 시작"
      : "등록"
    : "다음";

  return (
    <Modal
      open={open}
      onOpenChange={(o) => {
        if (!o) close();
      }}
      title="신규 변화탐지 작업"
      icon={<Wand2 size={20} />}
      width={1000}
      footer={
        <>
          <Button variant="ghost" onClick={close} disabled={submitting}>
            취소
          </Button>
          {step !== "resource" ? (
            <Button variant="secondary" onClick={onPrev} disabled={submitting}>
              이전
            </Button>
          ) : null}
          <Button variant="primary" onClick={onNext} disabled={!canNext || submitting}>
            {primaryLabel}
          </Button>
        </>
      }
    >
      <ModalDescription>
        서버 영상 선택 또는 기존 자원 + 작업 메타 등록을 한 흐름으로
      </ModalDescription>

      <Tabs items={STEPS} value={step} onChange={() => {}} className="mb-4" />

      {step === "resource" ? (
        <>
          <div className="grid grid-cols-2 gap-4">
            <div className="rounded-md border border-slate-100 bg-slate-50/50 p-3 min-h-[420px] flex flex-col">
              <WizardStepResource
                side="standard"
                label="과년도"
                hint="과년도 정사영상을 선택하세요."
                selectedId={selection.standardId}
                onSelectExisting={(id) =>
                  setSelection({ standardId: id, standardPending: null })
                }
                pending={selection.standardPending}
                onPending={(p) =>
                  setSelection({
                    standardPending: p,
                    standardId: p ? null : selection.standardId,
                  })
                }
                excludeId={selection.compareId}
              />
            </div>
            <div className="rounded-md border border-slate-100 bg-slate-50/50 p-3 min-h-[420px] flex flex-col">
              <WizardStepResource
                side="compare"
                label="당해년도"
                hint="당해년도 정사영상을 선택하세요."
                selectedId={selection.compareId}
                onSelectExisting={(id) =>
                  setSelection({ compareId: id, comparePending: null })
                }
                pending={selection.comparePending}
                onPending={(p) =>
                  setSelection({
                    comparePending: p,
                    compareId: p ? null : selection.compareId,
                  })
                }
                excludeId={selection.standardId}
              />
            </div>
          </div>
          <OverlapStatusCard
            loading={overlap.loading}
            ratio={overlap.ratio}
            error={overlap.error}
            hasBoth={hasStandard && hasCompare}
            hasPending={hasPendingSelection}
          />
        </>
      ) : null}

      {step === "meta" ? (
        <WizardStepMeta
          selection={selection}
          datasets={datasets}
          overlapRatio={overlap.ratio}
          overlapLoading={overlap.loading}
          hasPendingSelection={hasPendingSelection}
          onChange={(partial) => setSelection(partial)}
        />
      ) : null}
    </Modal>
  );
}

function OverlapStatusCard({
  loading,
  ratio,
  error,
  hasBoth,
  hasPending,
}: {
  loading: boolean;
  ratio: number | null;
  error: string | null;
  hasBoth: boolean;
  hasPending: boolean;
}) {
  if (!hasBoth) {
    return (
      <div className="mt-3 rounded-md border border-slate-100 bg-white px-3 py-2 text-xs text-slate-500">
        과년도·당해년도 영상을 선택하면 중첩률이 표시됩니다.
      </div>
    );
  }
  if (hasPending) {
    return (
      <div className="mt-3 rounded-md border border-amber-100 bg-amber-50 px-3 py-2 text-xs text-amber-700">
        새 서버 영상은 등록 후 중첩률을 계산합니다.
      </div>
    );
  }
  if (loading) {
    return (
      <div className="mt-3 rounded-md border border-blue-100 bg-blue-50 px-3 py-2 text-xs font-bold text-blue-700">
        중첩률 계산 중...
      </div>
    );
  }
  if (ratio == null) {
    return (
      <div className="mt-3 rounded-md border border-red-100 bg-red-50 px-3 py-2 text-xs text-red-700">
        중첩률 계산 실패{error ? `: ${error}` : ""}
      </div>
    );
  }
  return (
    <div className="mt-3 rounded-md border border-slate-100 bg-white px-3 py-2 text-xs text-slate-600">
      <div className="flex items-center justify-between gap-2">
        <span className="font-bold text-slate-700">중첩률</span>
        <span className={ratio <= 0 ? "font-black text-red-600" : "font-black text-slate-900"}>
          {(ratio * 100).toFixed(1)}%
        </span>
      </div>
    </div>
  );
}
