import { Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { TASK_STATUS_LABEL, useStatusDistribution } from "@/stores/dashboardStats";

const TONE_COLOR: Record<string, string> = {
  pending: "#94a3b8", // slate-400
  running: "#3b82f6", // blue-500
  succeeded: "#10b981", // emerald-500
  failed: "#ef4444", // red-500
  canceled: "#f59e0b", // amber-500
};

/** 프로젝트 상태 분포 — 도넛 차트. */
export function StatusDonut() {
  const data = useStatusDistribution();
  return (
    <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-100">
      <div className="text-sm font-bold text-slate-700 mb-2">프로젝트 상태 분포</div>
      <div style={{ width: "100%", height: 180 }}>
        {data.length === 0 ? (
          <div className="h-full flex items-center justify-center text-xs text-slate-400">
            도엽 데이터 없음
          </div>
        ) : (
          <ResponsiveContainer>
            <PieChart>
              <Pie
                data={data}
                dataKey="count"
                nameKey="status"
                innerRadius={40}
                outerRadius={65}
                paddingAngle={2}
              >
                {data.map((d, i) => (
                  <Cell key={i} fill={TONE_COLOR[d.status]} />
                ))}
              </Pie>
              <Tooltip
                contentStyle={{ fontSize: 11 }}
                formatter={(v: number, _n: string, p: { payload?: { status?: string } }) => {
                  const label = p.payload?.status
                    ? TASK_STATUS_LABEL[p.payload.status as keyof typeof TASK_STATUS_LABEL]
                    : "";
                  return [`${v}건`, label];
                }}
              />
              <Legend
                verticalAlign="bottom"
                height={36}
                wrapperStyle={{ fontSize: 10 }}
                formatter={(value: string) =>
                  TASK_STATUS_LABEL[value as keyof typeof TASK_STATUS_LABEL] ?? value
                }
              />
            </PieChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
