import { useEffect, useState } from "react";
import type { Task } from "@/types";
import { getTaskStatus } from "@/api/client";

/**
 * 작업 진행률 폴링 훅.
 *
 * task_id 가 있으면 backend 의 /tasks/{id}/status 를 1.5초 간격으로 호출.
 * status 가 succeeded/failed/canceled 가 되면 자동 정지.
 *
 * @param taskId 폴링 대상 (null 이면 비활성)
 * @param onComplete 완료 콜백 (succeeded 만)
 */
export function useTaskPolling(
  taskId: string | null,
  onComplete?: (task: Task) => void,
  onUpdate?: (task: Task) => void,
): { task: Task | null; error: string | null } {
  const [task, setTask] = useState<Task | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!taskId) {
      setTask(null);
      return;
    }
    let stopped = false;
    let timer: number | null = null;
    const completedNotified = { value: false };

    const tick = async () => {
      try {
        const next = await getTaskStatus(taskId);
        if (stopped) return;
        setTask(next);
        onUpdate?.(next);
        if (
          (next.status === "succeeded" ||
            next.status === "failed" ||
            next.status === "canceled") &&
          !completedNotified.value
        ) {
          completedNotified.value = true;
          if (next.status === "succeeded") onComplete?.(next);
          return; // 폴링 중단
        }
        timer = window.setTimeout(tick, 1500);
      } catch (err) {
        if (stopped) return;
        setError(err instanceof Error ? err.message : String(err));
        // 에러여도 짧게 retry
        timer = window.setTimeout(tick, 3000);
      }
    };
    void tick();

    return () => {
      stopped = true;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [taskId, onComplete, onUpdate]);

  return { task, error };
}
