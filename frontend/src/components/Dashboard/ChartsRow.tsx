import { MonthlyBarChart } from "./MonthlyBarChart";
import { MonthlyLineChart } from "./MonthlyLineChart";
import { RegionDonut } from "./RegionDonut";
import { StatusDonut } from "./StatusDonut";

/** 메인 대시보드 — 4 차트 가로 행. */
export function ChartsRow() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
      <MonthlyLineChart />
      <RegionDonut />
      <StatusDonut />
      <MonthlyBarChart />
    </div>
  );
}
