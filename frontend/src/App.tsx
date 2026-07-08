import { HashRouter, Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "@/components/Layout";
import { TooltipProvider } from "@/components/Common";
import Landing from "@/pages/Landing";
import SheetDetail from "@/pages/SheetDetail";
import TaskDetail from "@/pages/TaskDetail";

/**
 * 라우트:
 *   /                  → 통합 대시보드 (프로젝트 리스트 + 지도 + 데이터셋)
 *   /tasks/:taskId     → 변화탐지 작업(=프로젝트) 상세 — 영상 단위 집계 폴리곤
 *   /sheets/:sheetCode → 단일 도엽 상세 (legacy, drill-down 용)
 *
 * 구 `/sheets`, `/datasets` 는 `/` 로 redirect.
 */
export default function App() {
  return (
    <TooltipProvider>
      <HashRouter>
        <AppShell>
          <Routes>
            <Route path="/" element={<Landing />} />
            <Route path="/tasks/:taskId" element={<TaskDetail />} />
            <Route path="/sheets" element={<Navigate to="/" replace />} />
            <Route path="/sheets/:sheetCode" element={<SheetDetail />} />
            <Route path="/datasets" element={<Navigate to="/" replace />} />
          </Routes>
        </AppShell>
      </HashRouter>
    </TooltipProvider>
  );
}
