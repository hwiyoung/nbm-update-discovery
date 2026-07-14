import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronLeft, ChevronRight, MapPin } from "lucide-react";
import toast from "react-hot-toast";
import { Button, Modal, ModalDescription } from "@/components/Common";
import { useDatasetsStore, type WizardStep } from "@/stores/datasetsStore";
import { useSheetsStore } from "@/stores/sheetsStore";
import { useTasksStore } from "@/stores/tasksStore";
import { createTask } from "@/api/client";
import {
  buildOrthoGroupsFromDatasets,
  selectedOrthoComposite,
  summarizeOrthoGroups,
} from "@/utils/mapProject";
import { MapProjectStepper } from "./mapwizard/Stepper";
import { OrthoMap } from "./mapwizard/OrthoMap";
import { StepDraw } from "./mapwizard/StepDraw";
import { StepReview } from "./mapwizard/StepReview";
import { StepMeta } from "./mapwizard/StepMeta";

const STEP_ORDER: WizardStep[] = ["draw", "review", "meta"];

/**
 * 지도 기반 신규 변화탐지 작업 위저드.
 *
 * 흐름:
 *   1. 지도에서 bbox 지정
 *   2. bbox 와 교차하는 기존 정사영상 중 과년도/당해년도 입력 선택
 *   3. 작업명·객체·자동실행 설정 후 선택 묶음 기준 task 등록
 */
export function NewTaskWizard() {
  const open = useDatasetsStore((state) => state.wizardOpen);
  const close = useDatasetsStore((state) => state.closeWizard);
  const step = useDatasetsStore((state) => state.wizardStep);
  const setStep = useDatasetsStore((state) => state.setWizardStep);
  const selection = useDatasetsStore((state) => state.wizardSelection);
  const setSelection = useDatasetsStore((state) => state.setWizardSelection);
  const setDrawnBBox = useDatasetsStore((state) => state.setWizardDrawnBBox);
  const setGroups = useDatasetsStore((state) => state.setWizardGroups);
  const setHovered = useDatasetsStore((state) => state.setWizardHoveredOrtho);
  const togglePast = useDatasetsStore((state) => state.toggleWizardPast);
  const toggleCurrent = useDatasetsStore((state) => state.toggleWizardCurrent);
  const clearSelections = useDatasetsStore((state) => state.clearWizardSelections);
  const datasets = useDatasetsStore((state) => state.datasets);
  const datasetsLoading = useDatasetsStore((state) => state.loading);
  const loadDatasets = useDatasetsStore((state) => state.loadDatasets);
  const appendTask = useTasksStore((state) => state.appendTask);
  const setPendingTaskId = useDatasetsStore((state) => state.setPendingTaskId);
  const regions = useSheetsStore((state) => state.regions);
  const regionsLoading = useSheetsStore((state) => state.regionsLoading);
  const loadRegions = useSheetsStore((state) => state.loadRegions);
  const navigate = useNavigate();

  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (datasets.length === 0 && !datasetsLoading) void loadDatasets();
    if (!regions && !regionsLoading) void loadRegions();
  }, [
    datasets.length,
    datasetsLoading,
    loadDatasets,
    loadRegions,
    open,
    regions,
    regionsLoading,
  ]);

  useEffect(() => {
    if (!open || !selection.drawnBBox) return;
    const groups = buildOrthoGroupsFromDatasets(datasets, selection.drawnBBox);
    setGroups(groups);
  }, [datasets, open, selection.drawnBBox, setGroups]);

  const summary = useMemo(
    () => summarizeOrthoGroups(selection.groups),
    [selection.groups],
  );
  const composite = useMemo(
    () => selectedOrthoComposite(selection.groups),
    [selection.groups],
  );
  const readyDatasetCount = useMemo(
    () => datasets.filter((dataset) => dataset.status === "ready").length,
    [datasets],
  );

  const canNext = (() => {
    if (step === "draw") return Boolean(selection.drawnBBox) && summary.matchedCount > 0;
    if (step === "review") {
      return (
        composite.pasts.length > 0 &&
        composite.currents.length > 0 &&
        composite.commonSheets.length > 0
      );
    }
    return (
      selection.name.trim().length > 0 &&
      selection.models.length > 0 &&
      composite.pasts.length > 0 &&
      composite.currents.length > 0 &&
      composite.commonSheets.length > 0
    );
  })();

  const currentIndex = STEP_ORDER.indexOf(step);
  const isFinal = step === "meta";
  const primaryLabel = isFinal
    ? selection.autoRun
      ? "등록 + 추론 시작"
      : "등록"
    : "다음";

  const onPrev = () => {
    if (currentIndex <= 0) return;
    setStep(STEP_ORDER[currentIndex - 1]!);
  };

  const onNext = async () => {
    if (isFinal) {
      await submitTasks();
      return;
    }
    setStep(STEP_ORDER[currentIndex + 1]!);
  };

  const clearArea = () => {
    setDrawnBBox(null);
    setStep("draw");
  };

  const submitTasks = async () => {
    if (
      composite.pasts.length === 0 ||
      composite.currents.length === 0 ||
      composite.commonSheets.length === 0
    ) {
      toast.error("공통 도엽이 있는 과년도·당해년도 영상 선택이 필요합니다");
      return;
    }

    setSubmitting(true);
    try {
      const standardIds = composite.pasts.map((image) => image.datasetId);
      const compareIds = composite.currents.map((image) => image.datasetId);
      const task = await createTask({
        name: selection.name.trim(),
        description: selection.description,
        models: selection.models,
        compare_type: "image-image",
        standard_resource_id: standardIds[0]!,
        compare_resource_id: compareIds[0]!,
        standard_resource_ids: standardIds,
        compare_resource_ids: compareIds,
        auto_run: selection.autoRun,
      });
      appendTask(task);
      if (selection.autoRun) setPendingTaskId(task.id);
      close();
      toast.success("프로젝트가 등록되었습니다");
      navigate(`/tasks/${task.id}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !submitting) close();
      }}
      title={
        <div className="flex items-center gap-2">
          <span>변화탐지 프로젝트 생성</span>
          <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[11px] font-black text-slate-500">
            정사영상 범위 선택
          </span>
        </div>
      }
      icon={<MapPin size={20} />}
      width="min(1280px, calc(100vw - 32px))"
      blockDismiss={submitting}
      footer={
        <div className="flex w-full items-center justify-between gap-4">
          <FooterSummary step={step} summaryText={footerSummaryText(step, summary)} />
          <div className="flex items-center justify-end gap-3">
            <Button variant="ghost" onClick={close} disabled={submitting}>
              취소
            </Button>
            {currentIndex > 0 ? (
              <Button
                variant="secondary"
                onClick={onPrev}
                disabled={submitting}
                leftIcon={<ChevronLeft size={15} />}
              >
                이전
              </Button>
            ) : null}
            <Button
              variant="primary"
              onClick={onNext}
              disabled={!canNext || submitting}
              rightIcon={!isFinal ? <ChevronRight size={15} /> : undefined}
            >
              {submitting ? "등록 중..." : primaryLabel}
            </Button>
          </div>
        </div>
      }
    >
      <ModalDescription>
        지도에서 분석 범위를 지정하고 과년도·당해년도 정사영상을 선택해 프로젝트를 등록합니다.
      </ModalDescription>

      <div className="-m-6 flex h-[min(720px,calc(88vh-136px))] min-h-[620px] flex-col">
        <MapProjectStepper step={step} />
        <div className="flex min-h-0 flex-1">
          <div className="min-w-0 basis-[62%] bg-slate-100">
            <OrthoMap
              step={step}
              datasets={datasets}
              regionData={regions}
              drawnBBox={selection.drawnBBox}
              groups={selection.groups}
              hoveredId={selection.hoveredOrthoId}
              onDrawn={(bbox) => {
                setDrawnBBox(bbox);
                setStep("draw");
              }}
              onClear={clearArea}
              onHover={setHovered}
              onTogglePast={togglePast}
              onToggleCurrent={toggleCurrent}
            />
          </div>

          <aside className="min-w-[380px] basis-[38%] border-l border-slate-200 bg-white overflow-y-auto custom-scrollbar">
            {step === "draw" ? (
              <StepDraw
                drawnBBox={selection.drawnBBox}
                summary={summary}
                readyDatasetCount={readyDatasetCount}
                groups={selection.groups}
                hoveredId={selection.hoveredOrthoId}
                onHover={setHovered}
              />
            ) : null}
            {step === "review" ? (
              <StepReview
                groups={selection.groups}
                summary={summary}
                composite={composite}
                hoveredId={selection.hoveredOrthoId}
                onHover={setHovered}
                onTogglePast={togglePast}
                onToggleCurrent={toggleCurrent}
                onClearSelection={clearSelections}
              />
            ) : null}
            {step === "meta" ? (
              <StepMeta
                selection={selection}
                summary={summary}
                composite={composite}
                onChange={setSelection}
              />
            ) : null}
          </aside>
        </div>
      </div>
    </Modal>
  );
}

function FooterSummary({
  step,
  summaryText,
}: {
  step: WizardStep;
  summaryText: string | null;
}) {
  if (step === "draw" || !summaryText) {
    return <div className="min-w-0 flex-1" />;
  }
  return (
    <div className="min-w-0 flex-1 truncate text-left text-xs font-black text-slate-600">
      {summaryText}
    </div>
  );
}

function footerSummaryText(
  step: WizardStep,
  summary: ReturnType<typeof summarizeOrthoGroups>,
): string | null {
  if (step === "draw" || summary.matchedCount === 0) return null;
  return [
    `정사영상 ${summary.matchedCount.toLocaleString("ko-KR")}장`,
    `과년도 ${summary.pastCount.toLocaleString("ko-KR")}`,
    summary.region,
    `${summary.areaKm2.toFixed(2)}㎢`,
    `중첩 ${Math.round(summary.overlap * 100)}%`,
  ].join(" · ");
}
