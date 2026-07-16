import { useState } from "react";
import { AlertTriangle, Loader2, MapPin, Pencil, Trash2 } from "lucide-react";
import toast from "react-hot-toast";
import {
  useDetectionById,
  useSheetDetailStore,
} from "@/stores/sheetDetailStore";
import {
  CHANGE_TYPE_BY_CODE,
  OBJECT_CATEGORY_LABEL,
  REVIEWER_MEMO_MAX_LENGTH,
} from "@/utils/constants";
import { Badge, Button, Modal, ModalDescription } from "@/components/Common";
import { formatArea, formatDateTime, formatPercent } from "@/utils/formatters";
import { auth } from "@/utils/auth";
import type { ChangeType, ObjectCategory } from "@/types";

// edit 모드 시 변경 가능한 model / change_type 옵션 (model 에 따라 분기).
const MODEL_OPTIONS: { value: ObjectCategory; label: string }[] = [
  { value: "building", label: "건물" },
  { value: "road", label: "도로" },
];
const CHANGE_OPTIONS_BY_MODEL: Record<ObjectCategory, { value: ChangeType; label: string }[]> = {
  building: [
    { value: "building_new", label: "신축" },
    { value: "building_updated", label: "갱신" },
    { value: "building_removed", label: "소멸" },
  ],
  road: [
    { value: "road_new", label: "신설" },
    { value: "road_removed", label: "소멸" },
  ],
};

/**
 * 우 패널 — 객체 정보 모드.
 *
 * 단건 선택 시: 메타 + 처리 의견 + 폴리곤 편집/삭제 액션.
 * 다중 선택 시: 선택 개수 안내.
 * 무선택 시: 안내 텍스트.
 */
export function DetectionInfoPanel() {
  const selectedIds = useSheetDetailStore((s) => s.selectedIds);
  const single = selectedIds.length === 1 ? selectedIds[0]! : null;
  const det = useDetectionById(single);
  const applyHardDelete = useSheetDetailStore((s) => s.applyHardDelete);
  const applyHardDeleteMany = useSheetDetailStore((s) => s.applyHardDeleteMany);
  const applyEditMeta = useSheetDetailStore((s) => s.applyEditMeta);
  const applyEditDetails = useSheetDetailStore((s) => s.applyEditDetails);
  const editTool = useSheetDetailStore((s) => s.editTool);
  const setEditTool = useSheetDetailStore((s) => s.setEditTool);
  const [editingMemo, setEditingMemo] = useState(false);
  const [memoDraft, setMemoDraft] = useState("");
  const [bulkBusy, setBulkBusy] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<
    null | { mode: "single"; id: string } | { mode: "bulk"; ids: string[] }
  >(null);
  const isEditMode = editTool === "edit";

  const onConfirmDelete = async () => {
    if (!deleteConfirm || bulkBusy) return;
    setBulkBusy(true);
    const tid = `del-${Date.now()}`;
    try {
      if (deleteConfirm.mode === "single") {
        toast.loading("객체 영구 삭제 중…", { id: tid });
        await applyHardDelete(deleteConfirm.id);
        toast.success("영구 삭제 완료", { id: tid });
      } else {
        const n = deleteConfirm.ids.length;
        toast.loading(`${n}건 영구 삭제 중…`, { id: tid });
        await applyHardDeleteMany(deleteConfirm.ids);
        toast.success(`${n}건 영구 삭제 완료`, { id: tid });
      }
      setDeleteConfirm(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "삭제 실패", { id: tid });
    } finally {
      setBulkBusy(false);
    }
  };

  const deleteCount =
    deleteConfirm?.mode === "bulk" ? deleteConfirm.ids.length : 1;

  if (selectedIds.length === 0) {
    return (
      <EmptyHint>
        지도에서 폴리곤을 클릭하면 객체 정보가 표시됩니다.
      </EmptyHint>
    );
  }

  if (selectedIds.length > 1) {
    return (
      <>
        <div className="p-5 space-y-4">
          <div className="flex items-center gap-2 text-sm text-slate-700">
            <Badge tone="blue">{selectedIds.length}건 선택</Badge>
            <span className="text-xs text-slate-500">다중 선택</span>
          </div>
          <p className="text-[11px] text-slate-500">
            선택한 폴리곤을 한 번에 영구 삭제할 수 있습니다. 삭제된 각 객체는 처리
            히스토리에 감사용 스냅샷이 남지만 <span className="font-bold text-red-600">되돌릴 수 없습니다</span>.
          </p>
          {auth.canDeleteDetection() ? (
            <Button
              size="sm"
              variant="danger"
              leftIcon={<Trash2 size={14} />}
              disabled={bulkBusy}
              onClick={() =>
                setDeleteConfirm({ mode: "bulk", ids: selectedIds })
              }
              fullWidth
            >
              {`선택한 ${selectedIds.length}건 영구 삭제`}
            </Button>
          ) : null}
        </div>
        <DeleteConfirmModal
          open={deleteConfirm !== null}
          count={deleteCount}
          busy={bulkBusy}
          onCancel={() => setDeleteConfirm(null)}
          onConfirm={() => void onConfirmDelete()}
        />
      </>
    );
  }

  if (!det) {
    return <EmptyHint>객체를 찾을 수 없습니다 (필터로 가려졌을 수 있음).</EmptyHint>;
  }

  const change = CHANGE_TYPE_BY_CODE[det.change_type];

  const startEditMemo = () => {
    setMemoDraft(det.reviewer_memo);
    setEditingMemo(true);
  };
  const submitMemo = async () => {
    await applyEditMeta(det.id, memoDraft);
    setEditingMemo(false);
  };

  const onChangeModel = async (newModel: ObjectCategory) => {
    // model 바뀌면 기존 change_type 이 호환 안 될 수 있음 → 같은 동작계열의 첫 옵션으로 자동 매핑.
    const action = det.change_type.split("_")[1] ?? "new"; // e.g. "new", "removed", "updated"
    const candidates = CHANGE_OPTIONS_BY_MODEL[newModel];
    const sameAction = candidates.find((c) => c.value.endsWith(`_${action}`));
    const newChangeType = sameAction?.value ?? candidates[0]!.value;
    await applyEditDetails(det.id, { model: newModel, change_type: newChangeType });
  };
  const onChangeType = async (newType: ChangeType) => {
    await applyEditDetails(det.id, { change_type: newType });
  };

  return (
    <div className="p-5 space-y-5">
      {/* 헤더 */}
      <div>
        <div className="flex items-center gap-2 mb-1.5">
          <span
            className="inline-block w-3 h-3 rounded-sm"
            style={{ backgroundColor: change.color }}
          />
          <span className="text-sm font-bold text-slate-800">
            {OBJECT_CATEGORY_LABEL[det.model]} · {change.label}
          </span>
        </div>
        <div className="text-[11px] text-slate-400 truncate">{det.id}</div>
      </div>

      {/* 편집 모드: 객체 카테고리 / 변화 유형 변경 dropdown */}
      {isEditMode ? (
        <div className="space-y-3 border border-blue-200 bg-blue-50/60 rounded-md p-3">
          <div className="text-[11px] font-bold text-blue-700 inline-flex items-center gap-1.5">
            <Pencil size={11} /> 편집 모드 — 폴리곤 형태 + 분류 변경
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-[11px] font-bold text-slate-500 mb-1">
                객체 카테고리
              </label>
              <select
                value={det.model}
                onChange={(e) => void onChangeModel(e.target.value as ObjectCategory)}
                className="w-full h-8 px-2 py-1 text-xs border border-slate-200 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {MODEL_OPTIONS.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-bold text-slate-500 mb-1">
                변화 유형
              </label>
              <select
                value={det.change_type}
                onChange={(e) => void onChangeType(e.target.value as ChangeType)}
                className="w-full h-8 px-2 py-1 text-xs border border-slate-200 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {CHANGE_OPTIONS_BY_MODEL[det.model].map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <p className="text-[11px] text-slate-500">
            지도에서 꼭짓점을 드래그해 형태도 수정 가능. 다른 모드로 전환 시 자동 저장.
          </p>
        </div>
      ) : null}

      {/* 메타 그리드 */}
      <dl className="grid grid-cols-2 gap-x-3 gap-y-2.5 text-xs">
        <Field label="확신도" value={formatPercent(det.confidence)} />
        <Field label="면적" value={formatArea(det.area_m2)} />
        <Field label="주소" value={det.address} colSpan />
        <Field label="처리자" value={det.reviewed_by ?? "-"} />
        <Field label="처리 시각" value={formatDateTime(det.reviewed_at)} />
      </dl>

      {/* 처리 의견 */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[11px] font-bold text-slate-500">처리 의견</span>
          {auth.canClassify() && !editingMemo ? (
            <button
              type="button"
              onClick={startEditMemo}
              className="text-[11px] text-blue-600 hover:text-blue-700 inline-flex items-center gap-1"
            >
              <Pencil size={11} /> 수정
            </button>
          ) : null}
        </div>
        {editingMemo ? (
          <div className="space-y-2">
            <textarea
              value={memoDraft}
              onChange={(e) =>
                setMemoDraft(e.target.value.slice(0, REVIEWER_MEMO_MAX_LENGTH))
              }
              maxLength={REVIEWER_MEMO_MAX_LENGTH}
              rows={3}
              className="w-full text-xs px-2 py-1.5 border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="처리 의견 (100자 이내)"
            />
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-slate-400 tabular-nums">
                {memoDraft.length} / {REVIEWER_MEMO_MAX_LENGTH}
              </span>
              <div className="flex gap-1.5">
                <Button size="sm" variant="ghost" onClick={() => setEditingMemo(false)}>
                  취소
                </Button>
                <Button size="sm" variant="primary" onClick={submitMemo}>
                  저장
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <p className="text-xs text-slate-700 whitespace-pre-line min-h-[1.5em]">
            {det.reviewer_memo || (
              <span className="text-slate-400">의견 없음</span>
            )}
          </p>
        )}
      </div>

      {/* 푸터 — 폴리곤 편집 / 영구 삭제 */}
      <div className="border-t border-slate-100 pt-3 flex flex-wrap gap-2">
        {auth.canEditGeometry() ? (
          <Button
            size="sm"
            variant="secondary"
            leftIcon={<MapPin size={14} />}
            onClick={() => {
              setEditTool("edit");
            }}
          >
            폴리곤 편집
          </Button>
        ) : null}
        {auth.canDeleteDetection() ? (
          <Button
            size="sm"
            variant="danger"
            leftIcon={<Trash2 size={14} />}
            onClick={() => setDeleteConfirm({ mode: "single", id: det.id })}
          >
            영구 삭제
          </Button>
        ) : null}
      </div>

      <DeleteConfirmModal
        open={deleteConfirm !== null}
        count={deleteCount}
        busy={bulkBusy}
        onCancel={() => setDeleteConfirm(null)}
        onConfirm={() => void onConfirmDelete()}
      />
    </div>
  );
}

function DeleteConfirmModal({
  open,
  count,
  busy,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  count: number;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Modal
      open={open}
      onOpenChange={(o) => (!o ? onCancel() : null)}
      title={count > 1 ? `${count}건 영구 삭제` : "객체 영구 삭제"}
      icon={<AlertTriangle size={20} className="text-red-600" />}
      footer={
        <>
          <Button variant="ghost" onClick={onCancel} disabled={busy}>
            취소
          </Button>
          <Button
            variant="danger"
            onClick={onConfirm}
            disabled={busy}
            leftIcon={
              busy ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Trash2 size={14} />
              )
            }
          >
            {busy ? "삭제 중…" : "영구 삭제"}
          </Button>
        </>
      }
    >
      <ModalDescription>객체 영구 삭제 확인</ModalDescription>
      <div className="space-y-3">
        <div className="flex items-start gap-3 p-3 rounded-md bg-red-50 border border-red-200">
          <AlertTriangle size={18} className="text-red-600 shrink-0 mt-0.5" />
          <div className="text-sm text-red-900">
            <div className="font-bold mb-1">
              {count > 1
                ? `선택한 ${count}건의 객체를 영구 삭제합니다.`
                : "선택한 객체를 영구 삭제합니다."}
            </div>
            <div className="text-xs text-red-700">
              · DB row 가 완전히 제거되며 <span className="font-bold">Undo 로 되돌릴 수 없습니다</span>.
              <br />· 처리 히스토리에는 감사용 스냅샷이 남지만 객체 복원은 불가합니다.
            </div>
          </div>
        </div>
        <p className="text-xs text-slate-500">
          단순 검토 목적이면 "취소" 후 다른 작업 방식을 고려하세요.
        </p>
      </div>
    </Modal>
  );
}

function Field({
  label,
  value,
  colSpan,
}: {
  label: string;
  value: React.ReactNode;
  colSpan?: boolean;
}) {
  return (
    <div className={colSpan ? "col-span-2" : ""}>
      <dt className="text-[11px] font-bold text-slate-400 mb-0.5">{label}</dt>
      <dd className="text-xs text-slate-700">{value}</dd>
    </div>
  );
}

function EmptyHint({ children }: { children: React.ReactNode }) {
  return (
    <div className="h-full flex items-center justify-center px-8 text-center text-xs text-slate-400">
      {children}
    </div>
  );
}
