import { useCallback, useEffect, useState } from "react";
import {
  ArrowUp,
  ChevronRight,
  FileImage,
  Folder,
  HardDrive,
  Loader2,
  RefreshCw,
  X,
} from "lucide-react";
import { Button, Modal, ModalDescription } from "@/components/Common";
import {
  browseFilesystem,
  getFilesystemRoots,
  type FsEntry,
  type FsRoot,
} from "@/api/client";
import { cn } from "@/utils/cn";

export interface ServerFileBrowserProps {
  open: boolean;
  onClose: () => void;
  /** 사용자가 파일 선택 시 호출. path 는 서버 측 절대 경로. */
  onSelect: (file: FsEntry) => void;
  title?: string;
}

/**
 * 서버 측 파일시스템 탐색기 (Docker 컨테이너 마운트 폴더).
 *
 *  - /data/storage (서버 볼륨), /media (외장하드), /mnt 영역만 접근.
 *  - 디렉토리 탐색 + 영상 파일 (.tif/.tiff/.jpg/.png) 선택.
 *  - 더블 클릭 또는 "선택" 버튼으로 onSelect 호출 후 닫힘.
 */
export function ServerFileBrowser({
  open,
  onClose,
  onSelect,
  title = "서버 파일 선택",
}: ServerFileBrowserProps) {
  const [view, setView] = useState<"roots" | "dir">("roots");
  const [roots, setRoots] = useState<FsRoot[]>([]);
  const [hint, setHint] = useState("");
  const [currentPath, setCurrentPath] = useState("");
  const [parentPath, setParentPath] = useState<string | null>(null);
  const [entries, setEntries] = useState<FsEntry[]>([]);
  const [imageCount, setImageCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<FsEntry | null>(null);

  const fetchRoots = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await getFilesystemRoots();
      setRoots(r.roots);
      setHint(r.hint);
      setView("roots");
      setEntries([]);
      setCurrentPath("");
      setParentPath(null);
      setSelected(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "마운트 목록 불러오기 실패");
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchDir = useCallback(async (path: string) => {
    setLoading(true);
    setError(null);
    setSelected(null);
    try {
      const r = await browseFilesystem(path);
      setEntries(r.entries);
      setImageCount(r.image_count);
      setCurrentPath(r.current_path);
      setParentPath(r.parent_path);
      setView("dir");
    } catch (err) {
      setError(err instanceof Error ? err.message : "디렉토리 탐색 실패");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) void fetchRoots();
  }, [open, fetchRoots]);

  const goUp = () => {
    if (parentPath) void fetchDir(parentPath);
    else void fetchRoots();
  };

  const submit = () => {
    if (selected && !selected.is_dir) {
      onSelect(selected);
      onClose();
    }
  };

  const breadcrumb = currentPath ? currentPath.split("/").filter(Boolean) : [];
  const breadcrumbPaths = breadcrumb.map(
    (_, i) => "/" + breadcrumb.slice(0, i + 1).join("/"),
  );

  return (
    <Modal
      open={open}
      onOpenChange={(o) => (!o ? onClose() : null)}
      title={title}
      icon={<Folder size={20} className="text-blue-600" />}
      width={780}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            취소
          </Button>
          <Button
            variant="primary"
            onClick={submit}
            disabled={!selected || selected.is_dir}
          >
            선택
          </Button>
        </>
      }
    >
      <ModalDescription>
        Docker 컨테이너에 마운트된 폴더에서 영상 파일 (TIFF/JPG/PNG) 선택
      </ModalDescription>

      {/* 경로 표시줄 */}
      <div className="flex items-center gap-1 text-xs overflow-x-auto custom-scrollbar py-1 mb-2">
        {view === "roots" ? (
          <span className="font-bold text-slate-700 flex items-center gap-1.5 px-2 py-1 bg-slate-100 rounded">
            <HardDrive size={12} className="text-blue-600" /> 마운트 디스크
          </span>
        ) : (
          <>
            <button
              type="button"
              onClick={() => void fetchRoots()}
              className="text-blue-600 hover:text-blue-700 font-bold inline-flex items-center gap-1 px-1.5 py-0.5 rounded hover:bg-blue-50 shrink-0"
            >
              <HardDrive size={12} /> 디스크
            </button>
            {breadcrumb.map((seg, i) => (
              <span key={i} className="inline-flex items-center gap-1">
                <ChevronRight size={11} className="text-slate-300 shrink-0" />
                <button
                  type="button"
                  onClick={() => void fetchDir(breadcrumbPaths[i]!)}
                  className={cn(
                    "px-1.5 py-0.5 rounded font-mono shrink-0 transition-colors",
                    i === breadcrumb.length - 1
                      ? "text-slate-800 font-bold bg-slate-100"
                      : "text-blue-600 hover:text-blue-700 hover:bg-blue-50",
                  )}
                >
                  {seg}
                </button>
              </span>
            ))}
          </>
        )}
      </div>

      {/* 네비게이션 바 */}
      <div className="flex items-center justify-between py-2 border-y border-slate-100 mb-2 text-xs">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={goUp}
            disabled={view === "roots"}
            className="inline-flex items-center gap-1 px-2 py-1 rounded text-slate-600 hover:text-blue-600 hover:bg-slate-100 disabled:text-slate-300 disabled:cursor-not-allowed transition-colors"
          >
            <ArrowUp size={13} /> 상위
          </button>
          <button
            type="button"
            onClick={() => (view === "roots" ? void fetchRoots() : void fetchDir(currentPath))}
            className="inline-flex items-center gap-1 px-2 py-1 rounded text-slate-600 hover:text-blue-600 hover:bg-slate-100"
          >
            <RefreshCw size={12} /> 새로고침
          </button>
        </div>
        {view === "dir" ? (
          <span className="text-slate-400">
            {imageCount > 0 ? `${imageCount}개 영상 · ` : ""}
            {entries.filter((e) => e.is_dir).length}개 폴더
          </span>
        ) : null}
      </div>

      {/* 본문 */}
      <div className="h-[420px] overflow-y-auto custom-scrollbar">
        {loading ? (
          <div className="flex items-center justify-center h-full text-slate-500 text-xs">
            <Loader2 size={18} className="animate-spin mr-2 text-blue-500" />
            불러오는 중…
          </div>
        ) : error ? (
          <div className="p-3 bg-red-50 border border-red-100 rounded-md text-xs text-red-700">
            {error}
          </div>
        ) : view === "roots" ? (
          <div className="space-y-2">
            {hint ? (
              <div className="px-3 py-2 bg-amber-50 border border-amber-100 rounded-md text-[11px] text-amber-700">
                {hint}
              </div>
            ) : null}
            {roots.map((r) => (
              <button
                key={r.path}
                type="button"
                onClick={() => void fetchDir(r.path)}
                className="w-full flex items-center gap-3 p-3 border border-slate-100 rounded-md hover:bg-blue-50 hover:border-blue-200 transition-colors text-left"
              >
                <HardDrive size={20} className="text-blue-600 shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-bold text-slate-800 truncate">
                    {r.label}
                  </div>
                  <div className="text-[11px] text-slate-400 font-mono truncate">
                    {r.path}
                  </div>
                  {r.total_gb != null && r.used_gb != null && r.total_gb > 0 ? (
                    <div className="mt-1.5 flex items-center gap-2">
                      <div className="flex-1 h-1 bg-slate-200 rounded-full overflow-hidden">
                        <div
                          className={cn(
                            "h-full rounded-full",
                            r.used_gb / r.total_gb > 0.9 ? "bg-red-500"
                              : r.used_gb / r.total_gb > 0.7 ? "bg-amber-500"
                                : "bg-blue-500",
                          )}
                          style={{ width: `${Math.min(100, (r.used_gb / r.total_gb) * 100)}%` }}
                        />
                      </div>
                      <span className="text-[10px] text-slate-400 shrink-0 tabular-nums">
                        {r.used_gb}/{r.total_gb}GB
                      </span>
                    </div>
                  ) : null}
                </div>
                <ChevronRight size={14} className="text-slate-300 shrink-0" />
              </button>
            ))}
            {roots.length === 0 ? (
              <div className="text-center text-xs text-slate-400 py-8">
                마운트된 디스크가 없습니다.
              </div>
            ) : null}
          </div>
        ) : (
          <ul className="space-y-0.5">
            {entries.map((e) => {
              const isSelected = selected?.path === e.path;
              return (
                <li key={e.path}>
                  <button
                    type="button"
                    onClick={() => {
                      if (e.is_dir) void fetchDir(e.path);
                      else setSelected(e);
                    }}
                    onDoubleClick={() => {
                      if (!e.is_dir) {
                        onSelect(e);
                        onClose();
                      }
                    }}
                    className={cn(
                      "w-full flex items-center gap-2 px-2 py-1.5 rounded transition-colors text-left",
                      isSelected
                        ? "bg-blue-100 text-blue-700"
                        : "hover:bg-slate-50",
                    )}
                  >
                    {e.is_dir ? (
                      <Folder size={14} className="text-blue-500 shrink-0" />
                    ) : (
                      <FileImage size={14} className="text-slate-500 shrink-0" />
                    )}
                    <span className="flex-1 text-xs truncate font-mono">{e.name}</span>
                    {!e.is_dir && e.size != null ? (
                      <span className="text-[10px] text-slate-400 tabular-nums shrink-0">
                        {formatSize(e.size)}
                      </span>
                    ) : null}
                  </button>
                </li>
              );
            })}
            {entries.length === 0 ? (
              <li className="text-center text-xs text-slate-400 py-8">
                폴더가 비어있습니다.
              </li>
            ) : null}
          </ul>
        )}
      </div>

      {selected && !selected.is_dir ? (
        <div className="mt-3 px-3 py-2 bg-blue-50 border border-blue-100 rounded-md text-[11px] text-slate-700 flex items-center gap-2">
          <FileImage size={13} className="text-blue-600 shrink-0" />
          <span className="font-mono truncate flex-1">{selected.path}</span>
          <button
            type="button"
            aria-label="선택 해제"
            onClick={() => setSelected(null)}
            className="p-0.5 text-slate-400 hover:text-slate-700"
          >
            <X size={12} />
          </button>
        </div>
      ) : null}
    </Modal>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
