import { useCallback } from "react";
import { cn } from "@/utils/cn";

/**
 * 세로 드래그 디바이더 — DOM ref 기반 직접 mutation 으로 매끄러운 드래그.
 *
 * 드래그 중에는 targetRef.current.style.width 를 직접 변경 (React 재렌더 없음).
 * mouseup 시점에 onCommit 1회만 호출 → store 영속.
 *
 * 사용 패턴:
 *   const leftRef = useRef<HTMLElement>(null);
 *   <aside ref={leftRef} style={{ width: leftW }} />
 *   <ResizableDivider
 *     targetRef={leftRef}
 *     edge="right"  // 디바이더가 패널의 오른쪽 가장자리
 *     min={240} max={600}
 *     onCommit={setLeftW}
 *   />
 *   <main className="flex-1 min-w-0" />
 *
 * edge:
 *   "right" — 디바이더가 target 의 오른쪽. 마우스를 오른쪽으로 끌면 target 폭 증가.
 *   "left"  — 디바이더가 target 의 왼쪽.  마우스를 왼쪽으로 끌면 target 폭 증가.
 */
export interface ResizableDividerProps {
  targetRef: React.RefObject<HTMLElement>;
  edge: "left" | "right";
  min: number;
  max: number;
  onCommit: (width: number) => void;
  className?: string;
  ariaLabel?: string;
}

export function ResizableDivider({
  targetRef,
  edge,
  min,
  max,
  onCommit,
  className,
  ariaLabel = "패널 크기 조정",
}: ResizableDividerProps) {
  const onMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      const target = targetRef.current;
      if (!target) return;
      e.preventDefault();

      const startX = e.clientX;
      const startW = target.getBoundingClientRect().width;
      const sign = edge === "right" ? 1 : -1;
      let lastW = startW;

      document.body.style.userSelect = "none";
      document.body.style.cursor = "col-resize";

      const onMove = (ev: MouseEvent) => {
        const delta = ev.clientX - startX;
        const next = Math.max(min, Math.min(max, startW + sign * delta));
        lastW = next;
        // 직접 DOM mutation — React 재렌더 우회
        target.style.width = `${next}px`;
        // map invalidateSize 등 필요 시 여기서 dispatch 가능
      };

      const onUp = () => {
        document.body.style.userSelect = "";
        document.body.style.cursor = "";
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        // 최종 값 1회만 store 에 commit
        onCommit(lastW);
        // Leaflet 등 컨테이너 크기 의존 UI 가 redraw 하도록 hint
        window.dispatchEvent(new Event("resize"));
      };

      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    [targetRef, edge, min, max, onCommit],
  );

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={ariaLabel}
      onMouseDown={onMouseDown}
      className={cn(
        "shrink-0 w-1.5 cursor-col-resize bg-slate-100 hover:bg-blue-500 active:bg-blue-600 transition-colors",
        className,
      )}
    />
  );
}
