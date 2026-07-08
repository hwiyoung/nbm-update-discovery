import type { Task } from "@/types";

const STAGE_MESSAGES: Record<string, string> = {
  queued: "큐 대기 중",
  starting: "작업 준비 중",
  preparing: "입력 준비 중",
  preflight: "영상 확인 중",
  sheet_manifest: "처리 도엽 계산 중",
  resampling: "도엽 영상 준비 중",
  algorithm_starting: "AI 분석 준비 중",
  patch: "패치 생성 중",
  inference: "추론 중",
  reconstruct: "결과 정리 중",
  vectorize: "폴리곤 변환 중",
  algorithm: "AI 분석 중",
  algorithm_done: "모델 분석 완료",
  saving: "결과 저장 중",
  done: "처리 완료",
  failed: "처리 실패",
  canceled: "처리 중단",
};

export function taskProgressMessageText(task: Task): string {
  const stage = stringValue(task.progress_stage) ?? stageFromLegacyTask(task);
  if (stage && STAGE_MESSAGES[stage]) return STAGE_MESSAGES[stage];

  switch (task.status) {
    case "pending":
      return STAGE_MESSAGES.queued;
    case "running":
      return STAGE_MESSAGES.algorithm;
    case "succeeded":
      return STAGE_MESSAGES.done;
    case "failed":
      return STAGE_MESSAGES.failed;
    case "canceled":
      return STAGE_MESSAGES.canceled;
    default:
      return "처리 중";
  }
}

function stageFromLegacyTask(task: Task): string | null {
  const raw = stringValue(task.progress_detail?.current_task);
  if (!raw) return null;
  const normalized = raw.toLowerCase();
  if (normalized.includes("preflight")) return "preflight";
  if (normalized.includes("manifest")) return "sheet_manifest";
  if (normalized.includes("resampling")) return "resampling";
  if (normalized.includes("algorithm starting")) return "algorithm_starting";
  if (normalized.includes("patch")) return "patch";
  if (normalized.includes("inference")) return "inference";
  if (normalized.includes("reconstruct")) return "reconstruct";
  if (normalized.includes("vectorize")) return "vectorize";
  if (normalized.includes("completed") || normalized === "process completed") {
    return "algorithm_done";
  }
  return "algorithm";
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}
