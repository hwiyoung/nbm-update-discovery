import { ChevronDown } from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useId,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { cn } from "@/utils/cn";

/**
 * Accordion — 처리 상세 좌 사이드바 6개 영역(PROMPTS §3) 의 기반.
 * 자체 구현 — 개수가 적고 키보드 네비게이션은 native button 으로 충분.
 *
 * 사용 예:
 *   <AccordionGroup defaultOpen={['confidence']}>
 *     <Accordion id="data" title="분석 데이터" trailing={<Badge.../>}>...</Accordion>
 *     <Accordion id="confidence" title="확신도">...</Accordion>
 *   </AccordionGroup>
 */
interface AccordionContextValue {
  openIds: Set<string>;
  toggle: (id: string) => void;
}

const AccordionContext = createContext<AccordionContextValue | null>(null);

export interface AccordionGroupProps {
  /** 처음 펼침 상태로 둘 항목 id 목록. */
  defaultOpen?: string[];
  /** 한 번에 하나만 열리도록. */
  exclusive?: boolean;
  className?: string;
  children: ReactNode;
}

export function AccordionGroup({
  defaultOpen = [],
  exclusive = false,
  className,
  children,
}: AccordionGroupProps) {
  const [openIds, setOpenIds] = useState<Set<string>>(
    () => new Set(defaultOpen),
  );

  const toggle = useCallback(
    (id: string) => {
      setOpenIds((prev) => {
        const next = new Set(exclusive ? [] : prev);
        if (prev.has(id)) {
          next.delete(id);
        } else {
          next.add(id);
        }
        return next;
      });
    },
    [exclusive],
  );

  const ctx = useMemo<AccordionContextValue>(() => ({ openIds, toggle }), [openIds, toggle]);

  return (
    <AccordionContext.Provider value={ctx}>
      <div className={cn("divide-y divide-slate-100", className)}>{children}</div>
    </AccordionContext.Provider>
  );
}

export interface AccordionProps {
  id: string;
  title: ReactNode;
  /** 헤더 우측 (배지·카운트 등). */
  trailing?: ReactNode;
  /** 외부 제어용 — 미지정 시 그룹의 상태 따름. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string;
  children: ReactNode;
}

export function Accordion({
  id,
  title,
  trailing,
  open: openProp,
  onOpenChange,
  className,
  children,
}: AccordionProps) {
  const ctx = useContext(AccordionContext);
  const headerId = useId();
  const panelId = useId();

  const isControlled = typeof openProp === "boolean";
  const isOpen = isControlled ? Boolean(openProp) : ctx?.openIds.has(id) ?? false;

  const handleToggle = () => {
    if (isControlled) {
      onOpenChange?.(!isOpen);
      return;
    }
    if (ctx) ctx.toggle(id);
  };

  return (
    <div className={cn("py-1", className)}>
      <button
        type="button"
        id={headerId}
        aria-expanded={isOpen}
        aria-controls={panelId}
        onClick={handleToggle}
        className={cn(
          "w-full flex items-center justify-between gap-2 px-3 py-2 rounded-md",
          "text-sm font-bold text-slate-700 hover:bg-slate-50 transition-colors",
          "focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500",
        )}
      >
        <span className="flex items-center gap-2 truncate">
          <ChevronDown
            size={16}
            className={cn(
              "text-slate-400 transition-transform shrink-0",
              isOpen ? "rotate-0" : "-rotate-90",
            )}
          />
          {title}
        </span>
        {trailing ? <span className="shrink-0">{trailing}</span> : null}
      </button>
      {isOpen ? (
        <div
          id={panelId}
          role="region"
          aria-labelledby={headerId}
          className="px-3 pt-1 pb-3"
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}
