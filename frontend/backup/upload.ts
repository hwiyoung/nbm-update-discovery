/**
 * services/upload.ts — 데이터셋 업로드 서비스
 *
 * Mock 모드: setTimeout 시뮬레이션 + registerUploadedDataset (메타만).
 * Backend 모드: multipart POST /api/v1/uploads (vite dev proxy 또는 nginx 경유).
 *               백엔드가 rasterio 로 bbox 추출 + PostGIS ST_Intersects 로
 *               sheet_codes 자동 + status promote.
 */

import type { Polygon } from "geojson";
import type {
  Dataset,
  DatasetUploadMeta,
  UploadProgress,
  UploadStage,
} from "@/types";
import { apiClientMeta, registerUploadedDataset } from "@/api/client";

export interface UploadDatasetOptions {
  file: File;
  meta: DatasetUploadMeta;
  onProgress?: (progress: UploadProgress) => void;
}

/**
 * Backend 업로드 URL.
 * 기본: 같은 origin 의 /api/v1 (vite dev proxy 또는 nginx 가 backend 로 forward).
 * 환경변수로 override 가능.
 */
function getUploadBaseUrl(): string {
  const fromEnv = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/$/, "");
  return fromEnv || "/api/v1";
}

export async function uploadDataset(
  options: UploadDatasetOptions,
): Promise<Dataset> {
  const { file, meta, onProgress } = options;
  const uploadId = `upload-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;

  const emit = (stage: UploadStage, percent: number, message?: string) => {
    onProgress?.({ uploadId, stage, percent, ...(message ? { message } : {}) });
  };

  emit("preparing", 0, `${file.name} 업로드 준비`);

  if (apiClientMeta.mode === "backend") {
    return uploadViaMultipart(file, meta, emit);
  }

  // ---- mock 모드: 시뮬레이션 ----
  await sleep(200);
  emit("uploading", 10);
  for (let p = 20; p <= 90; p += 10) {
    await sleep(120);
    emit("uploading", p);
  }
  emit("processing", 95, "서버측 변환 중");
  await sleep(300);

  const dummyBbox: Polygon = {
    type: "Polygon",
    coordinates: [
      [
        [0, 0],
        [0, 0],
        [0, 0],
        [0, 0],
        [0, 0],
      ],
    ],
  };
  const dataset = await registerUploadedDataset(meta, dummyBbox, [], null);
  emit("done", 100, "업로드 완료");
  return dataset;
}

async function uploadViaMultipart(
  file: File,
  meta: DatasetUploadMeta,
  emit: (stage: UploadStage, percent: number, message?: string) => void,
): Promise<Dataset> {
  const form = new FormData();
  form.append("file", file);
  form.append("display_name", meta.display_name);
  form.append("platform", meta.platform);
  form.append("taken_start_at", meta.taken_start_at);
  form.append("taken_end_at", meta.taken_end_at);

  return new Promise<Dataset>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${getUploadBaseUrl()}/uploads`);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        const pct = Math.min(95, Math.round((e.loaded / e.total) * 90) + 5);
        emit("uploading", pct);
      }
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const dataset = JSON.parse(xhr.responseText) as Dataset;
          emit(
            "done",
            100,
            `처리 완료 (도엽 ${dataset.sheet_codes.length}매)`,
          );
          resolve(dataset);
        } catch (e) {
          emit("error", 0, "응답 파싱 실패");
          reject(new Error(`응답 파싱 실패: ${e}`));
        }
      } else {
        let msg = `업로드 실패: ${xhr.status}`;
        try {
          const body = JSON.parse(xhr.responseText) as {
            detail?: { error?: { message?: string } };
          };
          if (body.detail?.error?.message) msg = body.detail.error.message;
        } catch {
          /* noop */
        }
        emit("error", 0, msg);
        reject(new Error(msg));
      }
    };
    xhr.onerror = () => {
      emit("error", 0, "네트워크 오류");
      reject(new Error("네트워크 오류"));
    };
    emit("uploading", 5);
    xhr.send(form);
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}