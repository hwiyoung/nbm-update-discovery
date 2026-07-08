import * as AlertDialog from "@radix-ui/react-alert-dialog";
import { X } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/utils/cn";

/**
 * Modal — DESIGN_SYSTEM §5.4 단일 공식.
 *  오버레이: fixed inset-0 z-[1000] bg-black/60 backdrop-blur-sm
 *  컨테이너: bg-white rounded-xl shadow-2xl
 *  헤더 h-14, 푸터 h-16 (bg-slate-50 + border-slate-200)
 *  푸터 버튼 우측 정렬.
 *
 * Radix alert-dialog 기반 — backdrop 클릭/ESC 비차단(차단이 필요한 경우는 prop).
 */
export interface ModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  /** 헤더 좌측 강조 아이콘. */
  icon?: ReactNode;
  /** 푸터 (보통 취소/확인 버튼들 — 우측 정렬됨). */
  footer?: ReactNode;
  /** 커스텀 width. 기본 500px. */
  width?: number | string;
  /** ESC / 백드롭 클릭으로 닫지 않도록. (폴리곤 편집 모달 등) */
  blockDismiss?: boolean;
  children?: ReactNode;
}

export function Modal({
  open,
  onOpenChange,
  title,
  icon,
  footer,
  width = 500,
  blockDismiss = false,
  children,
}: ModalProps) {
  return (
    <AlertDialog.Root open={open} onOpenChange={onOpenChange}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay
          className="fixed inset-0 z-[1000] bg-black/60 backdrop-blur-sm"
          onClick={(e) => {
            if (blockDismiss) e.preventDefault();
          }}
        />
        <AlertDialog.Content
          className={cn(
            "fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-[1000]",
            "bg-white rounded-xl shadow-2xl overflow-hidden flex flex-col",
            "max-h-[88vh]",
          )}
          style={{ width }}
          onEscapeKeyDown={(e) => {
            if (blockDismiss) e.preventDefault();
          }}
        >
          <div className="h-14 shrink-0 border-b border-slate-200 bg-slate-50 flex items-center justify-between px-6">
            <AlertDialog.Title className="font-bold text-slate-800 flex items-center gap-2">
              {icon ? <span className="text-blue-600">{icon}</span> : null}
              {title}
            </AlertDialog.Title>
            {!blockDismiss && (
              <button
                type="button"
                aria-label="닫기"
                onClick={() => onOpenChange(false)}
                className="p-1 text-slate-400 hover:text-slate-600 transition-colors rounded"
              >
                <X size={20} />
              </button>
            )}
          </div>

          <div className="flex-1 overflow-y-auto custom-scrollbar p-6">
            {children}
          </div>

          {footer ? (
            <div className="h-16 shrink-0 border-t border-slate-200 bg-slate-50 px-6 flex items-center justify-end gap-3">
              {footer}
            </div>
          ) : null}
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}

// Radix의 AlertDialog는 description이 없을 때 경고를 띄움 — 시각적으로 노출되지 않는 보조용
export function ModalDescription({ children }: { children: ReactNode }) {
  return <AlertDialog.Description className="sr-only">{children}</AlertDialog.Description>;
}
