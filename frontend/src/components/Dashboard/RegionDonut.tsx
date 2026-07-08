import { Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { useRegionDistribution } from "@/stores/dashboardStats";
import { CHART_COLORS } from "@/utils/constants";

/** 권역별 처리 대상 도엽 분포 — 도넛 차트. */
export function RegionDonut() {
  const data = useRegionDistribution();
  const colors = CHART_COLORS.multi;
  return (
    <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-100">
      <div className="text-sm font-bold text-slate-700 mb-2">권역별 처리 도엽</div>
      <div style={{ width: "100%", height: 180 }}>
        {data.length === 0 ? (
          <Empty />
        ) : (
          <ResponsiveContainer>
            <PieChart>
              <Pie
                data={data}
                dataKey="count"
                nameKey="region"
                innerRadius={40}
                outerRadius={65}
                paddingAngle={2}
              >
                {data.map((_, i) => (
                  <Cell key={i} fill={colors[i % colors.length]} />
                ))}
              </Pie>
              <Tooltip
                contentStyle={{ fontSize: 11 }}
                formatter={(v: number, _n: string, p: { payload?: { percent: number } }) => [
                  `${v}건 (${(p.payload?.percent ?? 0).toFixed(1)}%)`,
                  "도엽",
                ]}
              />
              <Legend
                verticalAlign="bottom"
                height={36}
                wrapperStyle={{ fontSize: 10 }}
              />
            </PieChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}

function Empty() {
  return (
    <div className="h-full flex items-center justify-center text-xs text-slate-400">
      도엽 데이터 없음
    </div>
  );
}
