import type { Polygon } from "geojson";
import type { ObjectCategory } from "./sheet";

/**
 * 변화탐지 객체 (DetectionObject) — 처리의 2차 단위 (폴리곤 1건).
 * PROJECT_BRIEF.md §3.2 기준.
 */
export type ChangeType =
  // 건물 변화 — 색변화(building_color) 는 도메인에서 제외.
  | "building_new"
  | "building_removed"
  | "building_updated"
  // 도로 변화
  | "road_new"
  | "road_removed"
  | "road_updated";

export interface DetectionObject {
  id: string;
  sheet_code: string;
  /**
   * 본 detection 이 속한 프로젝트(=task). 같은 sheet 의 다른 프로젝트와 격리.
   * 신규 객체 추가 draft 에서는 생략 가능 — backend 가 호출 path 또는 sheet 메타에서
   * 도출하여 채움. 응답에는 항상 포함.
   */
  task_id?: string | null;

  // AI 탐지 결과 (불변, 입력)
  model: ObjectCategory;
  change_type: ChangeType;
  confidence: number; // 0~100
  area_m2: number;
  geometry: Polygon; // EPSG:4326
  region_code: string; // 행정구역 코드
  address: string;

  // 처리 결과 (가변, 출력) — 의견 메모만 유지.
  reviewer_memo: string;
  reviewed_by: string | null;
  reviewed_at: string | null;

  // 메타
  is_user_added: boolean;
  is_deleted: boolean;
}

/**
 * api/client 의 PATCH 호출 페이로드. 부분 업데이트.
 */
export interface DetectionUpdatePayload {
  reviewer_memo?: string;
  geometry?: Polygon;
  is_deleted?: boolean;
  model?: ObjectCategory;
  change_type?: ChangeType;
}

/**
 * 도엽 처리 상세(/sheets/:code)의 단일 진실 원천 필터.
 * 좌 사이드바·지도·우 패널이 동시 구독 (CLAUDE.md §9.5).
 */
export interface DetectionFilter {
  confidenceMin: number; // 0~100
  confidenceMax: number;
  changeTypes: ChangeType[]; // 가시 변화 유형
  regionCode: string | null; // 도엽 내 행정구역 (8자리 읍면동)
}
