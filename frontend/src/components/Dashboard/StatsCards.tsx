import { CheckCircle2, HardDrive, Layers, ListTodo } from "lucide-react";
import { Badge } from "@/components/Common";
import { useOverviewStats } from "@/stores/dashboardStats";
import { formatPercent } from "@/utils/formatters";

/**
 * 메인 대시보드 상단 — 4개 통계 카드 가로 그리드.
 *
 * 1. 처리 완료 면적 (km², 전체 대비 %)
 * 2. 도엽 진행률 (완료/전체 + breakdown 배지)
 * 3. 변경 객체 (처리 완료 / 전체)
 * 4. 데이터셋 용량 (GB) + 데이터셋 수
 */
export function StatsCards() {
  const stats = useOverviewStats();

  const nationalRatio =
    stats.nationalAreaKm2 === 0
      ? 0
      : (stats.completedAreaKm2 / stats.nationalAreaKm2) * 100;
  const nationalRatioDigits = nationalRatio > 0 && nationalRatio < 1 ? 3 : 1;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
      <StatCard
        icon={<CheckCircle2 size={20} />}
        tone="emerald"
        label="처리 완료 면적"
        primary={`${stats.completedAreaKm2.toFixed(1)}`}
        unit="km²"
        sub={`전국토 대비 ${formatPercent(nationalRatio, nationalRatioDigits)}`}
      />
      <StatCard
        icon={<ListTodo size={20} />}
        tone="blue"
        label="프로젝트 진행"
        primary={`${stats.completedTasks} / ${stats.totalTasks}`}
        unit="건"
        sub={
          <span className="flex flex-wrap gap-1.5 mt-1">
            <Badge tone="emerald">완료 {stats.byStatus.succeeded}</Badge>
            <Badge tone="blue">진행 {stats.byStatus.running}</Badge>
            <Badge tone="slate">대기 {stats.byStatus.pending}</Badge>
            {stats.byStatus.failed > 0 ? (
              <Badge tone="red">실패 {stats.byStatus.failed}</Badge>
            ) : null}
            {stats.byStatus.canceled > 0 ? (
              <Badge tone="amber">중단 {stats.byStatus.canceled}</Badge>
            ) : null}
          </span>
        }
      />
      <StatCard
        icon={<Layers size={20} />}
        tone="amber"
        label="변경 객체"
        primary={stats.totalDetections.toLocaleString("ko-KR")}
        unit="건"
        sub={`처리 도엽 ${stats.completedSheets} / ${stats.totalSheets}매`}
      />
      <StatCard
        icon={<HardDrive size={20} />}
        tone="slate"
        label="총 저장 용량"
        primary={stats.totalDatasetGB.toFixed(1)}
        unit="GB"
        sub={`데이터셋 ${stats.totalDatasets}건`}
      />
    </div>
  );
}

function StatCard({
  icon,
  tone,
  label,
  primary,
  unit,
  sub,
}: {
  icon: React.ReactNode;
  tone: "emerald" | "blue" | "amber" | "slate";
  label: string;
  primary: string;
  unit?: string;
  sub: React.ReactNode;
}) {
  const toneCls = {
    emerald: "bg-emerald-50 text-emerald-600",
    blue: "bg-blue-50 text-blue-600",
    amber: "bg-amber-50 text-amber-600",
    slate: "bg-slate-100 text-slate-600",
  }[tone];

  return (
    <div className="bg-white rounded-xl p-5 shadow-sm border border-slate-100 hover:shadow-md transition-shadow">
      <div className="flex items-start gap-3">
        <div className={`p-2.5 rounded-lg shrink-0 ${toneCls}`}>{icon}</div>
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1">
            {label}
          </div>
          <div className="flex items-baseline gap-1">
            <span className="text-2xl font-bold text-slate-800 tabular-nums truncate">
              {primary}
            </span>
            {unit ? (
              <span className="text-sm text-slate-500 font-bold">{unit}</span>
            ) : null}
          </div>
          <div className="text-xs text-slate-500 mt-0.5">{sub}</div>
        </div>
      </div>
    </div>
  );
}
