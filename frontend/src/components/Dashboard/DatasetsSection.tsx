import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { Database, Plus, RefreshCw, Search } from "lucide-react";
import { Badge, Button, Input } from "@/components/Common";
import { DatasetRow, PendingUploadRow } from "@/components/Datasets";
import {
  useDatasetsStore,
  useFilteredDatasets,
} from "@/stores/datasetsStore";
import { rescanOrthomosaic } from "@/api/client";
import { auth } from "@/utils/auth";

/**
 * 메인 대시보드 우측 패널 — 데이터셋 자원 row 리스트.
 *
 * 좁은 패널에 카드 그리드는 비효율적이라 한 줄씩 row 표시.
 */
export function DatasetsSection() {
  const loadDatasets = useDatasetsStore((s) => s.loadDatasets);
  const datasets = useDatasetsStore((s) => s.datasets);
  const loading = useDatasetsStore((s) => s.loading);
  const error = useDatasetsStore((s) => s.error);
  const filtered = useFilteredDatasets();
  const filter = useDatasetsStore((s) => s.filter);
  const setFilter = useDatasetsStore((s) => s.setFilter);
  const openUpload = useDatasetsStore((s) => s.openUpload);
  const pendingUploads = useDatasetsStore((s) => s.pendingUploads);
  const [rescanning, setRescanning] = useState(false);

  useEffect(() => {
    void loadDatasets();
  }, [loadDatasets]);

  const handleRescan = async () => {
    if (rescanning) return;
    setRescanning(true);
    const tid = "orthomosaic-rescan";
    toast.loading("정사영상 폴더 스캔 중…", { id: tid });
    try {
      const stats = await rescanOrthomosaic();
      await loadDatasets();
      const parts: string[] = [];
      if (stats.registered > 0) parts.push(`신규 ${stats.registered}`);
      if (stats.removed > 0) parts.push(`삭제 ${stats.removed}`);
      if (stats.blocked > 0) parts.push(`보존(참조중) ${stats.blocked}`);
      if (stats.failed > 0) parts.push(`실패 ${stats.failed}`);
      const headline = parts.length > 0 ? parts.join(" · ") : "변경 없음";
      toast.success(
        `${headline} — 스캔 ${stats.scanned}, 스킵 ${stats.skipped}`,
        { id: tid },
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "스캔 실패", { id: tid });
    } finally {
      setRescanning(false);
    }
  };

  return (
    <section className="bg-white rounded-xl border border-slate-100 shadow-sm flex flex-col h-full min-h-0">
      <header className="px-3 py-3 border-b border-slate-100 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <Database size={14} className="text-blue-600" />
            <h3 className="text-sm font-bold text-slate-800">데이터셋 자원</h3>
            <Badge tone="blue">
              {filtered.length} / {datasets.length}
            </Badge>
          </div>
          <div className="flex items-center gap-1.5">
            <Button
              variant="ghost"
              size="sm"
              leftIcon={
                <RefreshCw
                  size={12}
                  className={rescanning ? "animate-spin" : undefined}
                />
              }
              onClick={() => void handleRescan()}
              disabled={rescanning}
              title="정사영상 폴더 재스캔 (1시간 주기 자동, 즉시 새로고침)"
            >
              새로고침
            </Button>
            {auth.canUploadDataset() ? (
              <Button
                variant="secondary"
                size="sm"
                leftIcon={<Plus size={12} />}
                onClick={openUpload}
              >
                업로드
              </Button>
            ) : null}
          </div>
        </div>
        <Input
          type="search"
          placeholder="파일명·플랫폼 검색"
          value={filter.search}
          onChange={(e) => setFilter({ search: e.target.value })}
          leftIcon={<Search size={14} />}
        />
      </header>

      <div className="flex-1 min-h-0 p-2 space-y-1.5 overflow-y-auto custom-scrollbar">
        {pendingUploads.length > 0 ? (
          <div className="space-y-1.5 mb-1">
            {pendingUploads.map((u) => (
              <PendingUploadRow key={u.id} upload={u} />
            ))}
          </div>
        ) : null}

        {error ? (
          <div className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-md p-2.5">
            {error}
          </div>
        ) : null}

        {loading && datasets.length === 0 ? (
          <div className="text-center text-xs text-slate-400 py-8">
            데이터셋 불러오는 중…
          </div>
        ) : null}

        {!loading && filtered.length === 0 && datasets.length > 0 ? (
          <div className="text-center text-xs text-slate-400 py-8">
            조건에 맞는 자원이 없습니다.
          </div>
        ) : null}

        {!loading && datasets.length === 0 ? (
          <div className="text-center text-xs text-slate-400 py-8">
            업로드된 자원이 없습니다.
            <br />
            상단 "업로드" 로 시작하세요.
          </div>
        ) : null}

        {filtered.map((d) => (
          <DatasetRow key={d.id} dataset={d} />
        ))}
      </div>
    </section>
  );
}
