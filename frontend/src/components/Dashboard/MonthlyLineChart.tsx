import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useMonthlyCompletedTasks } from "@/stores/dashboardStats";
import { CHART_COLORS } from "@/utils/constants";

/** 월별 완료 프로젝트 수 — 라인 차트. */
export function MonthlyLineChart() {
  const data = useMonthlyCompletedTasks();
  return (
    <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-100">
      <div className="text-sm font-bold text-slate-700 mb-2">월별 완료 프로젝트</div>
      <div style={{ width: "100%", height: 180 }}>
        <ResponsiveContainer>
          <LineChart data={data} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 10, fill: "#94a3b8" }}
              tickFormatter={(v: string) => v.split(".")[1] ?? v}
            />
            <YAxis tick={{ fontSize: 10, fill: "#94a3b8" }} allowDecimals={false} />
            <Tooltip
              contentStyle={{ fontSize: 11 }}
              formatter={(v: number) => [`${v}건`, "완료 프로젝트"]}
            />
            <Line
              type="monotone"
              dataKey="count"
              stroke={CHART_COLORS.primary}
              strokeWidth={2}
              dot={{ r: 3, fill: CHART_COLORS.primary }}
              activeDot={{ r: 5 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
