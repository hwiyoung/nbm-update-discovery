import { useEffect, useState } from "react";
import { Pencil } from "lucide-react";
import toast from "react-hot-toast";
import {
  Button,
  Input,
  Modal,
  ModalDescription,
} from "@/components/Common";
import { useTasksStore } from "@/stores/tasksStore";
import { useDatasetsStore } from "@/stores/datasetsStore";
import type { Task } from "@/types";

/**
 * 프로젝트(=task) 수정 모달.
 *
 *  - 작업명 / 설명 편집
 *  - 과년도 / 당해년도 자원 데이터셋 연결 — TaskDetail 에서 TiTiler 로 영상 가시화
 */
export interface EditTaskModalProps {
  task: Task | null;
  open: boolean;
  onClose: () => void;
}

export function EditTaskModal({ task, open, onClose }: EditTaskModalProps) {
  const patchTask = useTasksStore((s) => s.patchTask);
  const datasets = useDatasetsStore((s) => s.datasets);
  const loadDatasets = useDatasetsStore((s) => s.loadDatasets);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [standardId, setStandardId] = useState<number | null>(null);
  const [compareId, setCompareId] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) void loadDatasets();
  }, [open, loadDatasets]);

  useEffect(() => {
    if (!task) return;
    setName(task.name);
    setDescription(task.description ?? "");
    setStandardId(task.standard_resource_id);
    setCompareId(task.compare_resource_id);
  }, [task]);

  if (!task) return null;

  const ready = datasets.filter((d) => d.status === "ready");

  const onSubmit = async () => {
    if (!name.trim()) {
      toast.error("작업명을 입력하세요");
      return;
    }
    setSubmitting(true);
    try {
      await patchTask(task.id, {
        name: name.trim(),
        description: description.trim(),
        standard_resource_id: standardId,
        compare_resource_id: compareId,
      });
      toast.success("프로젝트 수정 완료");
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "수정 실패");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      onOpenChange={(o) => (!o ? onClose() : null)}
      title="프로젝트 수정"
      icon={<Pencil size={20} />}
      width={520}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            취소
          </Button>
          <Button variant="primary" onClick={onSubmit} disabled={submitting}>
            {submitting ? "저장 중…" : "저장"}
          </Button>
        </>
      }
    >
      <ModalDescription>작업명·설명·연결된 영상 자원 변경</ModalDescription>

      <div className="space-y-4">
        <div>
          <label className="block text-xs font-bold text-slate-500 mb-1.5">
            작업명
          </label>
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </div>

        <div>
          <label className="block text-xs font-bold text-slate-500 mb-1.5">
            설명
          </label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            className="w-full text-sm px-3 py-2 border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            placeholder="(선택) 매칭 도엽 코드, 비고 등"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-bold text-slate-500 mb-1.5">
              과년도
            </label>
            <DatasetSelect
              value={standardId}
              onChange={setStandardId}
              candidates={ready}
              excludeId={compareId}
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-500 mb-1.5">
              당해년도
            </label>
            <DatasetSelect
              value={compareId}
              onChange={setCompareId}
              candidates={ready}
              excludeId={standardId}
            />
          </div>
        </div>

        <p className="text-[11px] text-slate-500 bg-slate-50 border border-slate-100 rounded-md p-2">
          영상을 연결하면 프로젝트 상세 페이지에서 해당 영상이 지도에 표시됩니다.
        </p>

        {task.sheet_codes.length > 0 ? (
          <div className="text-[11px] text-slate-500">
            <span className="font-bold text-slate-400">매칭 도엽 {task.sheet_codes.length}매:</span>{" "}
            <span className="break-all">{task.sheet_codes.join(", ")}</span>
          </div>
        ) : null}
      </div>
    </Modal>
  );
}

function DatasetSelect({
  value,
  onChange,
  candidates,
  excludeId,
}: {
  value: number | null;
  onChange: (id: number | null) => void;
  candidates: Array<{ id: number; display_name: string }>;
  excludeId: number | null;
}) {
  return (
    <select
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}
      className="w-full h-9 px-2 py-1.5 border border-slate-200 rounded-md text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
    >
      <option value="">— 미연결 —</option>
      {candidates
        .filter((d) => d.id !== excludeId)
        .map((d) => (
          <option key={d.id} value={d.id}>
            #{d.id} · {d.display_name}
          </option>
        ))}
    </select>
  );
}
