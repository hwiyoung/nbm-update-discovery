/**
 * api/client.ts — 백엔드 호출 단일 접점 (CLAUDE.md §9.2)
 *
 * 모든 페이지·컴포넌트의 데이터 입출력은 본 파일 경유.
 * 기본 동작: backend API 호출.
 * Mock 모드는 VITE_USE_MOCK=true 로 명시한 경우에만 사용.
 *
 * 본 파일을 수정해도 호출부 시그니처는 유지되어야 한다.
 */

import type {
  Dataset,
  DatasetPreflightResult,
  DatasetStatus,
  DatasetUploadMeta,
  DetectionObject,
  DetectionUpdatePayload,
  HistoryAction,
  MapSheet,
  ObjectCategory,
  ReviewHistory,
  ReviewStatus,
  Task,
  TaskCreatePayload,
} from "@/types";
import type { Polygon } from "geojson";
import { STORAGE_KEY } from "@/utils/constants";
import { getCurrentAuth } from "@/utils/auth";

// ============================================================
// 환경 설정
// ============================================================

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? "/api/v1").replace(/\/$/, "");

const STATIC_DATA_BASE = "/data";

const useMock = String(import.meta.env.VITE_USE_MOCK ?? "").toLowerCase() === "true";

// ============================================================
// fetch 유틸 (정적 JSON / 백엔드 양 모드 공통)
// ============================================================

async function fetchJson<T>(path: string): Promise<T> {
  const res = await fetch(path, { headers: { Accept: "application/json" } });
  if (!res.ok) {
    throw new Error(`fetch ${path} failed: ${res.status} ${res.statusText}`);
  }
  return (await res.json()) as T;
}

// ============================================================
// localStorage diff 레이어 (mock 단계 임시 저장)
// 백엔드 swap 후 본 레이어는 사용하지 않음.
// ============================================================

function readLocal<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeLocal<T>(key: string, value: T): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* QuotaExceeded 무시 (mock 단계) */
  }
}

const detectionDraftKey = (sheetCode: string) =>
  `${STORAGE_KEY.detectionDraft}.${sheetCode}`;
const historyKey = (sheetCode: string) => `${STORAGE_KEY.history}.${sheetCode}`;
const sheetStatusKey = "nbm.mock.sheetStatus";
const datasetStatusKey = "nbm.mock.datasetStatus";
const userDatasetsKey = "nbm.mock.userDatasets";

interface DetectionDraftMap {
  // detection.id → 부분 업데이트
  [id: string]: DetectionUpdatePayload & {
    is_user_added?: boolean;
    reviewer_memo?: string;
    geometry?: Polygon;
    is_deleted?: boolean;
    reviewed_by?: string | null;
    reviewed_at?: string | null;
  };
}

// 처리자가 신규 추가한 객체 (FN) 임시 저장
interface UserAddedDetectionsMap {
  [id: string]: DetectionObject;
}

const userAddedKey = (sheetCode: string) =>
  `${STORAGE_KEY.detectionDraft}.added.${sheetCode}`;

// ============================================================
// 유틸: ID·시각
// ============================================================

function genId(prefix: string): string {
  const rnd = Math.random().toString(16).slice(2, 10);
  return `${prefix}_${Date.now().toString(16)}_${rnd}`;
}

/** task 식별자 — 32자리 hex (prefix 없음). 백엔드 _gen_task_id 와 동일. */
function genTaskId(): string {
  const rnd = () => Math.random().toString(16).slice(2, 10).padStart(8, "0");
  return rnd() + rnd() + rnd() + rnd();
}

function nowIso(): string {
  return new Date().toISOString();
}

// ============================================================
// 도엽 (MapSheet)
// ============================================================

interface SheetIndexFile {
  sheets: MapSheet[];
}

async function fetchSheetsIndex(): Promise<MapSheet[]> {
  if (useMock) {
    const data = await fetchJson<SheetIndexFile>(`${STATIC_DATA_BASE}/sheets/index.json`);
    return data.sheets ?? [];
  }
  return fetchJson<MapSheet[]>(`${API_BASE_URL}/sheets`);
}

export async function listSheets(): Promise<MapSheet[]> {
  const sheets = await fetchSheetsIndex();
  if (!useMock) return sheets;
  // mock: localStorage 의 review_status 오버라이드 적용
  const overrides = readLocal<Record<string, ReviewStatus>>(sheetStatusKey, {});
  return sheets.map((s) => {
    const ov = overrides[s.code];
    return ov ? { ...s, review_status: ov } : s;
  });
}

export async function getSheet(code: string): Promise<MapSheet> {
  if (useMock) {
    const all = await listSheets();
    const found = all.find((s) => s.code === code);
    if (!found) throw new Error(`Sheet not found: ${code}`);
    return found;
  }
  return fetchJson<MapSheet>(`${API_BASE_URL}/sheets/${code}`);
}

export async function updateSheetStatus(
  code: string,
  status: ReviewStatus,
): Promise<MapSheet> {
  if (useMock) {
    const overrides = readLocal<Record<string, ReviewStatus>>(sheetStatusKey, {});
    overrides[code] = status;
    writeLocal(sheetStatusKey, overrides);
    return getSheet(code);
  }
  const res = await fetch(`${API_BASE_URL}/sheets/${code}/status`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ review_status: status }),
  });
  if (!res.ok) throw new Error(`updateSheetStatus failed: ${res.status}`);
  return (await res.json()) as MapSheet;
}

// ============================================================
// 변화탐지 객체 (DetectionObject)
// ============================================================

async function fetchSheetDetections(sheetCode: string): Promise<DetectionObject[]> {
  if (useMock) {
    return fetchJson<DetectionObject[]>(
      `${STATIC_DATA_BASE}/sheets/${sheetCode}/detections.json`,
    );
  }
  return fetchJson<DetectionObject[]>(
    `${API_BASE_URL}/sheets/${sheetCode}/detections`,
  );
}

function applyDetectionDrafts(
  base: DetectionObject[],
  drafts: DetectionDraftMap,
  added: UserAddedDetectionsMap,
): DetectionObject[] {
  const merged = base.map((d) => {
    const patch = drafts[d.id];
    return patch ? { ...d, ...patch } : d;
  });
  // 사용자 추가 폴리곤도 동일하게 drafts patch 를 받아야 한다
  // (그래야 is_deleted / error_class / reviewer_memo 변경이 반영됨).
  const addedList = Object.values(added).map((d) => {
    const patch = drafts[d.id];
    return patch ? { ...d, ...patch } : d;
  });
  return merged.concat(addedList);
}

export async function listDetections(sheetCode: string): Promise<DetectionObject[]> {
  const base = await fetchSheetDetections(sheetCode);
  if (!useMock) return base;
  const drafts = readLocal<DetectionDraftMap>(detectionDraftKey(sheetCode), {});
  const added = readLocal<UserAddedDetectionsMap>(userAddedKey(sheetCode), {});
  return applyDetectionDrafts(base, drafts, added);
}

/**
 * Task(프로젝트) 가 커버하는 모든 sheet 의 detections 를 합쳐 반환.
 * /tasks/:id 페이지에서 사용 — 도엽 분할 없이 영상 단위로 가시화.
 */
export async function listTaskDetections(taskId: string): Promise<DetectionObject[]> {
  if (useMock) {
    // mock 모드에서는 task 가 가진 sheet_codes 별로 list 호출 후 병합
    const tasks = await listTasks();
    const task = tasks.find((t) => t.id === taskId);
    if (!task) return [];
    const all: DetectionObject[] = [];
    for (const code of task.sheet_codes) {
      const sub = await listDetections(code);
      all.push(...sub);
    }
    return all;
  }
  return fetchJson<DetectionObject[]>(
    `${API_BASE_URL}/tasks/${taskId}/detections`,
  );
}

/**
 * task 모드일 때 taskId 를 전달하면 처리 이력 record 에 task_id 가 같이 저장되어
 * 같은 sheet 를 공유하는 두 프로젝트의 히스토리가 격리됨.
 */
export async function updateDetection(
  sheetCode: string,
  id: string,
  payload: DetectionUpdatePayload,
  taskId?: string | null,
): Promise<DetectionObject> {
  if (useMock) {
    const drafts = readLocal<DetectionDraftMap>(detectionDraftKey(sheetCode), {});
    drafts[id] = { ...(drafts[id] ?? {}), ...payload };
    writeLocal(detectionDraftKey(sheetCode), drafts);
    const all = await listDetections(sheetCode);
    const found = all.find((d) => d.id === id);
    if (!found) throw new Error(`Detection not found: ${id}`);
    return found;
  }
  const qs = taskId ? `?task_id=${encodeURIComponent(taskId)}` : "";
  const res = await fetch(`${API_BASE_URL}/detections/${id}${qs}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`updateDetection failed: ${res.status}`);
  return (await res.json()) as DetectionObject;
}

export async function createDetection(
  sheetCode: string,
  draft: Omit<DetectionObject, "id" | "sheet_code">,
  taskId?: string | null,
): Promise<DetectionObject> {
  if (useMock) {
    const id = genId("obj");
    const obj: DetectionObject = {
      ...draft,
      id,
      sheet_code: sheetCode,
      is_user_added: true,
    };
    const added = readLocal<UserAddedDetectionsMap>(userAddedKey(sheetCode), {});
    added[id] = obj;
    writeLocal(userAddedKey(sheetCode), added);
    return obj;
  }
  const qs = taskId ? `?task_id=${encodeURIComponent(taskId)}` : "";
  const res = await fetch(`${API_BASE_URL}/sheets/${sheetCode}/detections${qs}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(draft),
  });
  if (!res.ok) throw new Error(`createDetection failed: ${res.status}`);
  return (await res.json()) as DetectionObject;
}

/**
 * Task(프로젝트) 단위 신규 detection 추가.
 * 백엔드가 폴리곤 centroid 로 task.sheet_codes 중 매칭되는 sheet 자동 선택.
 */
export async function createTaskDetection(
  taskId: string,
  draft: Omit<DetectionObject, "id" | "sheet_code">,
): Promise<DetectionObject> {
  if (useMock) {
    const id = genId("obj");
    return { ...draft, id, sheet_code: taskId, is_user_added: true } as DetectionObject;
  }
  const res = await fetch(`${API_BASE_URL}/tasks/${taskId}/detections`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(draft),
  });
  if (!res.ok) throw new Error(`createTaskDetection failed: ${res.status}`);
  return (await res.json()) as DetectionObject;
}

/** 영구 삭제 — DB row 제거. 처리 이력에는 before 스냅샷이 남음 (감사용). 복원 불가. */
export async function hardDeleteDetection(
  id: string,
  taskId?: string | null,
): Promise<void> {
  if (useMock) return;
  const qs = taskId ? `?task_id=${encodeURIComponent(taskId)}` : "";
  const res = await fetch(`${API_BASE_URL}/detections/${id}${qs}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error(`hardDeleteDetection failed: ${res.status}`);
}

export async function setDetectionDeleted(
  sheetCode: string,
  id: string,
  deleted: boolean,
  taskId?: string | null,
): Promise<DetectionObject> {
  if (useMock) {
    return updateDetection(sheetCode, id, { is_deleted: deleted });
  }
  const qs = taskId ? `?task_id=${encodeURIComponent(taskId)}` : "";
  const res = await fetch(`${API_BASE_URL}/detections/${id}/deletion${qs}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ is_deleted: deleted }),
  });
  if (!res.ok) throw new Error(`setDetectionDeleted failed: ${res.status}`);
  return (await res.json()) as DetectionObject;
}

// ============================================================
// 처리 이력 (ReviewHistory)
// ============================================================

export async function listHistory(sheetCode: string): Promise<ReviewHistory[]> {
  if (useMock) {
    return readLocal<ReviewHistory[]>(historyKey(sheetCode), []);
  }
  return fetchJson<ReviewHistory[]>(
    `${API_BASE_URL}/sheets/${sheetCode}/history`,
  );
}

/** 프로젝트(=task) 단위 처리 이력 — task.sheet_codes 의 모든 sheet 합산. */
export async function listTaskHistory(taskId: string): Promise<ReviewHistory[]> {
  if (useMock) return [];
  return fetchJson<ReviewHistory[]>(
    `${API_BASE_URL}/tasks/${taskId}/history`,
  );
}

export async function appendHistory(
  sheetCode: string,
  entry: Omit<ReviewHistory, "id" | "reviewed_at" | "reviewer">,
): Promise<ReviewHistory> {
  const auth = getCurrentAuth();
  const record: ReviewHistory = {
    ...entry,
    id: genId("h"),
    reviewer: auth.userName,
    reviewed_at: nowIso(),
  };
  if (useMock) {
    const list = readLocal<ReviewHistory[]>(historyKey(sheetCode), []);
    list.push(record);
    writeLocal(historyKey(sheetCode), list);
    return record;
  }
  // Backend 모드: server 의 write endpoint 들 (create_detection, update_detection 등)
  // 이 자동으로 review_histories 에 기록함. client 가 추가 호출하면 중복 + 405.
  // record 를 그대로 반환해 caller 의 흐름은 유지.
  return record;
}

/**
 * Undo 용. 가장 최근 N 건의 이력을 제거하고 반환.
 * 호출부는 반환된 이력의 before 상태로 객체를 복원해야 한다.
 */
export async function popHistory(
  sheetCode: string,
  count: number,
): Promise<ReviewHistory[]> {
  if (useMock) {
    const list = readLocal<ReviewHistory[]>(historyKey(sheetCode), []);
    const popped = list.splice(Math.max(0, list.length - count), count);
    writeLocal(historyKey(sheetCode), list);
    return popped.reverse(); // 최신부터
  }
  const res = await fetch(
    `${API_BASE_URL}/sheets/${sheetCode}/history/recent?count=${count}`,
    { method: "DELETE" },
  );
  if (!res.ok) throw new Error(`popHistory failed: ${res.status}`);
  return (await res.json()) as ReviewHistory[];
}

// ============================================================
// 데이터셋 (Dataset)
// ============================================================

interface DatasetIndexFile {
  datasets: DatasetWire[];
}

type DatasetWire = Omit<Dataset, "regions" | "primary_region" | "capture_year" | "host_path"> & Partial<Pick<
  Dataset,
  "regions" | "primary_region" | "capture_year" | "host_path"
>>;

function normalizeDataset(dataset: DatasetWire): Dataset {
  return {
    ...dataset,
    regions: dataset.regions ?? [],
    primary_region: dataset.primary_region ?? null,
    capture_year: dataset.capture_year ?? getYearFromIso(dataset.taken_start_at),
    host_path: dataset.host_path ?? null,
  };
}

async function fetchDatasetsIndex(): Promise<Dataset[]> {
  if (useMock) {
    const data = await fetchJson<DatasetIndexFile>(
      `${STATIC_DATA_BASE}/datasets/index.json`,
    );
    return (data.datasets ?? []).map(normalizeDataset);
  }
  const datasets = await fetchJson<DatasetWire[]>(`${API_BASE_URL}/datasets`);
  return datasets.map(normalizeDataset);
}

export async function listDatasets(): Promise<Dataset[]> {
  const baseList = await fetchDatasetsIndex();
  if (!useMock) return baseList;
  const statusOverrides = readLocal<Record<number, DatasetStatus>>(
    datasetStatusKey,
    {},
  );
  const userAdded = readLocal<DatasetWire[]>(userDatasetsKey, []);
  const merged = baseList.map((d) => {
    const ov = statusOverrides[d.id];
    return ov ? { ...d, status: ov } : d;
  });
  return merged.concat(userAdded.map(normalizeDataset));
}

export async function getDataset(id: number): Promise<Dataset> {
  if (useMock) {
    const all = await listDatasets();
    const found = all.find((d) => d.id === id);
    if (!found) throw new Error(`Dataset not found: ${id}`);
    return found;
  }
  return fetchJson<Dataset>(`${API_BASE_URL}/datasets/${id}`);
}

export async function registerUploadedDataset(
  meta: DatasetUploadMeta,
  bbox: Polygon,
  sheetCodes: string[],
  tilePath: string | null,
): Promise<Dataset> {
  if (useMock) {
    const userAdded = readLocal<Dataset[]>(userDatasetsKey, []);
    const id =
      Math.max(0, ...userAdded.map((d) => d.id), 1000) + 1; // 1001부터
    const dataset: Dataset = {
      id,
      source: "upload",
      display_name: meta.display_name,
      platform: meta.platform,
      taken_start_at: meta.taken_start_at,
      taken_end_at: meta.taken_end_at,
      bbox,
      tile_path: tilePath,
      sheet_codes: sheetCodes,
      regions: [],
      primary_region: null,
      capture_year: getYearFromIso(meta.taken_start_at),
      host_path:
        tilePath?.startsWith("/media/") || tilePath?.startsWith("/mnt/")
          ? tilePath
          : null,
      status: "processing",
      thumbnail_url: null,
      size_bytes: null,
    };
    userAdded.push(dataset);
    writeLocal(userDatasetsKey, userAdded);
    return dataset;
  }
  const res = await fetch(`${API_BASE_URL}/datasets`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...meta, bbox, sheet_codes: sheetCodes, tile_path: tilePath }),
  });
  if (!res.ok) throw new Error(`registerUploadedDataset failed: ${res.status}`);
  return (await res.json()) as Dataset;
}

/**
 * 데이터셋 하드 삭제. 사용 중인 task 가 있으면 backend 가 409 + blocking_tasks 반환.
 * Frontend 는 blocking 정보를 throw 메시지에 담는다.
 */
export async function deleteDataset(id: number): Promise<void> {
  if (useMock) {
    // 사용자 추가 데이터셋만 삭제 (시드 mock 은 정적 JSON 이라 제거 불가)
    const userAdded = readLocal<Dataset[]>(userDatasetsKey, []);
    const idx = userAdded.findIndex((d) => d.id === id);
    if (idx >= 0) {
      userAdded.splice(idx, 1);
      writeLocal(userDatasetsKey, userAdded);
    }
    // status override 도 정리
    const overrides = readLocal<Record<number, DatasetStatus>>(datasetStatusKey, {});
    delete overrides[id];
    writeLocal(datasetStatusKey, overrides);
    return;
  }
  const res = await fetch(`${API_BASE_URL}/datasets/${id}`, { method: "DELETE" });
  if (res.ok) return; // 200/204 모두 성공
  // 에러 응답 (409, 404, 500)
  type ErrorBody = {
    detail?: {
      error?: {
        message?: string;
        details?: { blocking_tasks?: { id: string; name: string }[] };
      };
    };
  };
  let body: ErrorBody = {};
  try {
    body = (await res.json()) as ErrorBody;
  } catch {
    /* noop */
  }
  // FastAPI HTTPException 은 본 raise 의 detail 을 응답 body 의 "detail" 키에 넣음.
  const errInfo = body.detail?.error;
  const blocking = errInfo?.details?.blocking_tasks ?? [];
  const baseMsg = errInfo?.message ?? `deleteDataset failed: ${res.status}`;
  if (blocking.length > 0) {
    const names = blocking.map((t) => t.name).join(", ");
    throw new Error(`${baseMsg} — 사용 중 작업: ${names}`);
  }
  throw new Error(baseMsg);
}

/**
 * 호스트의 `ORTHOMOSAIC_DIR` 폴더를 다시 스캔해 신규 .tif 를 데이터셋으로 등록.
 * 서버는 startup 1회 + 1시간 주기 자동 스캔도 수행. 본 함수는 사용자가 새 파일을
 * 떨어뜨린 직후 즉시 반영하고 싶을 때 호출.
 */
export interface OrthomosaicRescanStats {
  scanned: number;
  registered: number;
  updated: number;
  skipped: number;
  deduped: number;
  failed: number;
  /** 파일이 사라져 자동 삭제된 dataset 수. */
  removed: number;
  /** 파일은 사라졌지만 task 가 참조 중이라 보존된 dataset 수. */
  blocked: number;
}

export async function rescanOrthomosaic(): Promise<OrthomosaicRescanStats> {
  if (useMock) {
    // mock 모드에서는 호스트 폴더 스캔이 의미 없음 — no-op 으로 0 반환.
    return {
      scanned: 0,
      registered: 0,
      updated: 0,
      skipped: 0,
      deduped: 0,
      failed: 0,
      removed: 0,
      blocked: 0,
    };
  }
  const res = await fetch(`${API_BASE_URL}/datasets/rescan-orthomosaic`, {
    method: "POST",
  });
  if (!res.ok) throw new Error(`rescanOrthomosaic failed: ${res.status}`);
  return (await res.json()) as OrthomosaicRescanStats;
}

function getYearFromIso(value: string | null | undefined): number | null {
  if (!value) return null;
  const year = new Date(value).getFullYear();
  return Number.isFinite(year) ? year : null;
}

export async function getDatasetPreflight(
  standardId: number,
  compareId: number,
): Promise<DatasetPreflightResult> {
  if (useMock) {
    return {
      standard: mockPreflightRaster(standardId),
      compare: mockPreflightRaster(compareId),
      target_gsd_m: 0.12,
      intersection_area_m2: 1,
      overlap_ratio: 1,
      overlap_method: "mock",
      intersection_bounds_5186: null,
      can_proceed: true,
      warnings: [],
    };
  }
  return fetchJson<DatasetPreflightResult>(
    `${API_BASE_URL}/datasets/preflight?std=${standardId}&cmp=${compareId}`,
  );
}

export async function getDatasetPreflightMetadata(
  standardId: number,
  compareId: number,
): Promise<DatasetPreflightResult> {
  if (useMock) {
    return {
      standard: mockPreflightRaster(standardId),
      compare: mockPreflightRaster(compareId),
      target_gsd_m: 0.12,
      intersection_area_m2: 1,
      overlap_ratio: 1,
      overlap_method: "mock",
      intersection_bounds_5186: null,
      can_proceed: true,
      warnings: [],
    };
  }
  return fetchJson<DatasetPreflightResult>(
    `${API_BASE_URL}/datasets/preflight/metadata?std=${standardId}&cmp=${compareId}`,
  );
}

function mockPreflightRaster(datasetId: number) {
  return {
    dataset_id: datasetId,
    path: "",
    crs: "EPSG:5186",
    width: 1,
    height: 1,
    band_count: 3,
    gsd_x_m: 0.12,
    gsd_y_m: 0.12,
    mean_gsd_m: 0.12,
    footprint_area_m2: 1,
    footprint_method: "mock",
    valid_pixel_count: 1,
  };
}

// ============================================================
// 작업 (Task)
// ============================================================

interface TaskIndexFile {
  tasks: Task[];
}

const userTasksKey = "nbm.mock.userTasks";

export async function listTasks(): Promise<Task[]> {
  if (useMock) {
    const file = await fetchJson<TaskIndexFile>(
      `${STATIC_DATA_BASE}/tasks/index.json`,
    );
    const userAdded = readLocal<Task[]>(userTasksKey, []);
    return [...(file.tasks ?? []), ...userAdded];
  }
  return fetchJson<Task[]>(`${API_BASE_URL}/tasks`);
}

/**
 * 작업 진행률 폴링용. backend 의 /tasks/{id}/status 호출.
 * mock 모드는 즉시 succeeded 로 반환 (프론트 흐름 검증용).
 */
export async function getTaskStatus(taskId: string): Promise<Task> {
  if (useMock) {
    const list = await listTasks();
    const found = list.find((t) => t.id === taskId);
    if (!found) {
      // 위저드에서 직전에 등록한 task — mock localStorage 에서 찾기
      throw new Error(`Task not found: ${taskId}`);
    }
    return found;
  }
  return fetchJson<Task>(`${API_BASE_URL}/tasks/${taskId}/status`);
}

/**
 * Task의 활성 변화탐지 결과를 백엔드가 Fiona/GDAL로 생성한 UTF-8 SHP ZIP으로 받는다.
 * 브라우저에서 DBF를 만들지 않아 한글 속성의 실제 UTF-8 바이트를 보장한다.
 */
export async function downloadTaskShapefile(
  taskId: string,
  objectIds?: string[],
): Promise<Blob> {
  if (useMock) {
    throw new Error("Mock 모드에서는 SHP 내보내기를 지원하지 않습니다");
  }
  const res = await fetch(`${API_BASE_URL}/tasks/${encodeURIComponent(taskId)}/export/shp`, {
    method: objectIds ? "POST" : "GET",
    headers: objectIds
      ? { Accept: "application/zip", "Content-Type": "application/json" }
      : { Accept: "application/zip" },
    body: objectIds ? JSON.stringify({ object_ids: objectIds }) : undefined,
  });
  if (!res.ok) {
    let message = `SHP 내보내기 실패: HTTP ${res.status}`;
    try {
      const body = (await res.json()) as { detail?: string };
      if (body.detail) message = body.detail;
    } catch {/* JSON이 아닌 오류 응답은 기본 메시지 사용 */}
    throw new Error(message);
  }
  return res.blob();
}

export async function createTask(payload: TaskCreatePayload): Promise<Task> {
  if (useMock) {
    const task: Task = {
      id: genTaskId(),
      name: payload.name,
      description: payload.description,
      models: payload.models,
      compare_type: payload.compare_type,
      standard_resource_id: payload.standard_resource_id,
      compare_resource_id: payload.compare_resource_id,
      standard_resource_ids: payload.standard_resource_ids ?? [payload.standard_resource_id],
      compare_resource_ids: payload.compare_resource_ids ?? [payload.compare_resource_id],
      sheet_codes: [],
      status: "pending",
      progress: 0,
      progress_message: null,
      progress_stage: null,
      progress_detail: null,
      progress_updated_at: null,
      created_at: nowIso(),
      started_at: null,
      finished_at: null,
      celery_task_id: null,
      detection_count: 0,
    };
    const list = readLocal<Task[]>(userTasksKey, []);
    list.push(task);
    writeLocal(userTasksKey, list);
    return task;
  }
  const res = await fetch(`${API_BASE_URL}/tasks`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`createTask failed: ${res.status}`);
  return (await res.json()) as Task;
}

/**
 * 프로젝트(=task) 부분 수정 — name/description/standard_resource_id/compare_resource_id.
 * mock 모드는 localStorage 만 갱신.
 */
export interface TaskUpdatePayload {
  name?: string;
  description?: string;
  standard_resource_id?: number | null;
  compare_resource_id?: number | null;
  standard_resource_ids?: number[];
  compare_resource_ids?: number[];
  models?: ObjectCategory[];
}

export async function updateTask(
  taskId: string,
  payload: TaskUpdatePayload,
): Promise<Task> {
  if (useMock) {
    const list = readLocal<Task[]>(userTasksKey, []);
    const idx = list.findIndex((t) => t.id === taskId);
    if (idx < 0) throw new Error(`Task not found: ${taskId}`);
    const updated = { ...list[idx]!, ...payload } as Task;
    list[idx] = updated;
    writeLocal(userTasksKey, list);
    return updated;
  }
  const res = await fetch(`${API_BASE_URL}/tasks/${taskId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`updateTask failed: ${res.status}`);
  return (await res.json()) as Task;
}

/** 처리 시작 — pending/canceled/failed → Celery enqueue 후 status='pending'. */
export async function startTask(taskId: string): Promise<Task> {
  if (useMock) {
    const list = readLocal<Task[]>(userTasksKey, []);
    const idx = list.findIndex((t) => t.id === taskId);
    if (idx < 0) throw new Error(`Task not found: ${taskId}`);
    const updated = {
      ...list[idx]!,
      status: "pending" as const,
      progress: 0,
      progress_message: null,
      progress_stage: null,
      progress_detail: null,
      progress_updated_at: null,
      started_at: null,
      finished_at: null,
    };
    list[idx] = updated;
    writeLocal(userTasksKey, list);
    return updated;
  }
  const res = await fetch(`${API_BASE_URL}/tasks/${taskId}/start`, {
    method: "POST",
  });
  if (!res.ok) {
    let msg = `startTask failed: ${res.status}`;
    try {
      const body = (await res.json()) as {
        detail?: { error?: { message?: string } };
      };
      if (body.detail?.error?.message) msg = body.detail.error.message;
    } catch {/* noop */}
    throw new Error(msg);
  }
  return (await res.json()) as Task;
}

/** 처리 중단 — Celery 작업 revoke + status='canceled'. */
export async function cancelTask(taskId: string): Promise<Task> {
  if (useMock) {
    const list = readLocal<Task[]>(userTasksKey, []);
    const idx = list.findIndex((t) => t.id === taskId);
    if (idx < 0) throw new Error(`Task not found: ${taskId}`);
    const updated = {
      ...list[idx]!,
      status: "canceled" as const,
      finished_at: nowIso(),
    };
    list[idx] = updated;
    writeLocal(userTasksKey, list);
    return updated;
  }
  const res = await fetch(`${API_BASE_URL}/tasks/${taskId}/cancel`, {
    method: "POST",
  });
  if (!res.ok) {
    let msg = `cancelTask failed: ${res.status}`;
    try {
      const body = (await res.json()) as {
        detail?: { error?: { message?: string } };
      };
      if (body.detail?.error?.message) msg = body.detail.error.message;
    } catch {/* noop */}
    throw new Error(msg);
  }
  return (await res.json()) as Task;
}

/** 프로젝트 하드 삭제 — 연결된 detection / 도엽 메타도 함께 정리. */
export async function deleteTask(taskId: string): Promise<void> {
  if (useMock) {
    const list = readLocal<Task[]>(userTasksKey, []);
    writeLocal(
      userTasksKey,
      list.filter((t) => t.id !== taskId),
    );
    return;
  }
  const res = await fetch(`${API_BASE_URL}/tasks/${taskId}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error(`deleteTask failed: ${res.status}`);
}

/**
 * 두 데이터셋의 도엽 코드 교집합 비율 (위저드 중첩률 표시용).
 */
export async function getDatasetOverlapRatio(
  stdId: number,
  cmpId: number,
): Promise<{ ratio: number; common_sheets: string[] }> {
  if (useMock) {
    const [std, cmp] = await Promise.all([getDataset(stdId), getDataset(cmpId)]);
    const stdSet = new Set(std.sheet_codes);
    const common = cmp.sheet_codes.filter((c) => stdSet.has(c));
    const denom = new Set([...std.sheet_codes, ...cmp.sheet_codes]).size;
    const ratio = denom === 0 ? 0 : common.length / denom;
    return { ratio, common_sheets: common };
  }
  return fetchJson<{ ratio: number; common_sheets: string[] }>(
    `${API_BASE_URL}/datasets/overlap?std=${stdId}&cmp=${cmpId}`,
  );
}

// ============================================================
// 액션별 헬퍼 — 객체 변경 + 히스토리 동시 기록
// ============================================================

async function withHistory(
  sheetCode: string,
  before: DetectionObject | null,
  after: DetectionObject,
  action: HistoryAction,
  memo: string | null,
): Promise<DetectionObject> {
  await appendHistory(sheetCode, {
    object_id: after.id,
    sheet_code: sheetCode,
    task_id: null,
    model: after.model,
    change_type: after.change_type,
    geometry: after.geometry,
    action,
    before: before ? { ...before } : null,
    after: { ...after },
    memo,
  });
  return after;
}

async function findDetection(
  sheetCode: string,
  id: string,
): Promise<DetectionObject | null> {
  const all = await listDetections(sheetCode);
  return all.find((d) => d.id === id) ?? null;
}


export async function editDetectionGeometry(
  sheetCode: string,
  id: string,
  geometry: Polygon,
  memo: string,
  taskId?: string | null,
): Promise<DetectionObject> {
  const before = await findDetection(sheetCode, id);
  const after = await updateDetection(sheetCode, id, { geometry }, taskId);
  return withHistory(sheetCode, before, after, "edit_geometry", memo);
}

export async function editDetectionMeta(
  sheetCode: string,
  id: string,
  reviewerMemo: string,
  taskId?: string | null,
): Promise<DetectionObject> {
  const before = await findDetection(sheetCode, id);
  const after = await updateDetection(
    sheetCode,
    id,
    { reviewer_memo: reviewerMemo },
    taskId,
  );
  return withHistory(sheetCode, before, after, "edit_meta", reviewerMemo);
}

export async function softDeleteDetection(
  sheetCode: string,
  id: string,
  deleted: boolean,
  memo: string,
  taskId?: string | null,
): Promise<DetectionObject> {
  const before = await findDetection(sheetCode, id);
  const after = await setDetectionDeleted(sheetCode, id, deleted, taskId);
  return withHistory(
    sheetCode,
    before,
    after,
    deleted ? "delete" : "restore",
    memo,
  );
}

// ============================================================
// 권역 / 도엽 격자 (지도 overlay)
// ============================================================

/**
 * 8개 권역 디졸브 GeoJSON. /sheets 화면 기본 overlay.
 * 17,034 도엽 격자 → 8 권역 폴리곤으로 렌더 비용 대폭 감소.
 *
 * properties: { region: string, region_full: string, sheet_count: number }
 */
export async function listRegions(): Promise<GeoJSON.FeatureCollection> {
  return fetchJson<GeoJSON.FeatureCollection>(
    `${STATIC_DATA_BASE}/regions/regions.geojson`,
  );
}

// ============================================================
// 서버 파일시스템 browse (ServerFileBrowser)
// ============================================================
export interface FsRoot {
  name: string;
  path: string;
  label: string;
  total_gb: number | null;
  used_gb: number | null;
}
export interface FsRootsResponse {
  roots: FsRoot[];
  hint: string;
}
export interface FsEntry {
  name: string;
  path: string;
  is_dir: boolean;
  size: number | null;
  modified: number | null;
}
export interface FsBrowseResponse {
  current_path: string;
  parent_path: string | null;
  entries: FsEntry[];
  image_count: number;
}

export async function getFilesystemRoots(): Promise<FsRootsResponse> {
  return fetchJson<FsRootsResponse>(`${API_BASE_URL}/filesystem/roots`);
}
export async function browseFilesystem(path: string): Promise<FsBrowseResponse> {
  return fetchJson<FsBrowseResponse>(
    `${API_BASE_URL}/filesystem/browse?path=${encodeURIComponent(path)}`,
  );
}

export interface RegionPreview {
  bbox_5186: [number, number, number, number];
  regions: string[];
  sheet_count: number;
  error: string | null;
}

/** 등록 전 미리보기 — 영상의 bbox·매칭 권역을 백엔드에서 읽어옴. */
export async function previewCaptureRegion(
  serverPath: string,
): Promise<RegionPreview> {
  if (useMock) {
    return { bbox_5186: [0, 0, 0, 0], regions: [], sheet_count: 0, error: null };
  }
  const res = await fetch(
    `${API_BASE_URL}/uploads/preview-region?server_path=${encodeURIComponent(serverPath)}`,
  );
  if (!res.ok) {
    let msg = `previewCaptureRegion failed: ${res.status}`;
    try {
      const body = (await res.json()) as { detail?: string };
      if (typeof body.detail === "string") msg = body.detail;
    } catch {/* noop */}
    throw new Error(msg);
  }
  return (await res.json()) as RegionPreview;
}

/** 서버 측 기존 파일 path 로 dataset 등록. multipart 업로드 단계 없음. */
export async function registerFromServerPath(payload: {
  server_path: string;
  display_name: string;
  platform: string;
  taken_start_at: string;
  taken_end_at: string;
}): Promise<Dataset> {
  const res = await fetch(`${API_BASE_URL}/uploads/from-server`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    let msg = `registerFromServerPath failed: ${res.status}`;
    try {
      const body = await res.json() as { detail?: { error?: { message?: string } } | string };
      if (typeof body.detail === "object" && body.detail?.error?.message) {
        msg = body.detail.error.message;
      } else if (typeof body.detail === "string") {
        msg = body.detail;
      }
    } catch {/* noop */}
    throw new Error(msg);
  }
  return (await res.json()) as Dataset;
}

// ============================================================
// 표준 GeoJSON import — backend /tasks/{id}/import-geojson
//
// Feature properties 표준 (backend.services.change_type_mapping 와 동일):
//   { model: "building"|"road", type: "1"|"2"|"3",
//     accuracy?: number|string, area?: number|string,
//     address?: string, region_code?: string, memo?: string }
//
// 매핑 (type → change_type):
//   1 → *_new (신축/신설),  2 → *_removed (철거/소멸),  3 → *_updated (갱신)
// ============================================================

export interface ImportGeoJsonResult {
  imported: number;
  skipped_unknown_type: number;
  skipped_no_sheet: number;
  skipped_invalid_geometry: number;
  by_change_type: Record<string, number>;
  affected_sheets: string[];
}

export async function importTaskGeoJson(
  taskId: string,
  featureCollection: GeoJSON.FeatureCollection,
): Promise<ImportGeoJsonResult> {
  if (useMock) {
    // 1차 mock 단계는 미지원 — backend 모드에서만 동작.
    throw new Error("GeoJSON import 는 backend 모드에서만 사용 가능합니다.");
  }
  const res = await fetch(
    `${API_BASE_URL}/tasks/${encodeURIComponent(taskId)}/import-geojson`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(featureCollection),
    },
  );
  if (!res.ok) {
    let msg = `import failed: ${res.status}`;
    try {
      const body = (await res.json()) as { detail?: { error?: { message?: string } } | string };
      if (typeof body.detail === "object" && body.detail?.error?.message) {
        msg = body.detail.error.message;
      } else if (typeof body.detail === "string") {
        msg = body.detail;
      }
    } catch {/* noop */}
    throw new Error(msg);
  }
  return (await res.json()) as ImportGeoJsonResult;
}

// ============================================================
// 디버그 / 모드 표시
// ============================================================

export const apiClientMeta = {
  mode: useMock ? ("mock" as const) : ("backend" as const),
  baseUrl: API_BASE_URL || null,
};

// 호출 일관성을 위해 ObjectCategory 도 import 시 expose
export type { ObjectCategory };
