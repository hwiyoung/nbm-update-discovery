import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useMonthlyCompletedArea } from "@/stores/dashboardStats";
import { CHART_COLORS } from "@/utils/constants";

/** 월별 신규 처리 완료 면적 — 막대 차트. */
export function MonthlyBarChart() {
  const data = useMonthlyCompletedArea();
  return (
    <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-100">
      <div className="text-sm font-bold text-slate-700 mb-2">
        월별 신규 처리 면적
      </div>
      <div style={{ width: "100%", height: 180 }}>
        <ResponsiveContainer>
          <BarChart
            data={data}
            margin={{ top: 10, right: 10, left: -20, bottom: 0 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 10, fill: "#94a3b8" }}
              tickFormatter={(v: string) => v.split(".")[1] ?? v}
            />
            <YAxis
              tick={{ fontSize: 10, fill: "#94a3b8" }}
              tickFormatter={(v: number) => `${v.toFixed(0)}`}
            />
            <Tooltip
              contentStyle={{ fontSize: 11 }}
              formatter={(v: number) => [
                `${v.toFixed(1)} km²`,
                "신규 처리 면적",
              ]}
            />
            <Bar
              dataKey="areaKm2"
              fill={CHART_COLORS.primary}
              radius={[4, 4, 0, 0]}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
