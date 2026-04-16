import { useDashboardSummaryQuery } from '../../hooks/useDashboard';
import { SummaryCards } from './components/SummaryCards';
import { SalesChart } from './components/SalesChart';
import { TopProductsChart } from './components/TopProductsChart';
import { YoYComparison } from './components/YoYComparison';
import { OverdueTable } from './components/OverdueTable';

export function DashboardPage() {
  const { data: summary, isLoading: summaryLoading } = useDashboardSummaryQuery();

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Overview of your shop performance, sales trends, and collections.
        </p>
      </div>

      {/* Summary cards row */}
      <SummaryCards data={summary} isLoading={summaryLoading} />

      {/* Charts row: Sales trend (60%) + Top products (40%) */}
      <div className="grid grid-cols-1 xl:grid-cols-5 gap-6">
        <div className="xl:col-span-3">
          <SalesChart />
        </div>
        <div className="xl:col-span-2">
          <TopProductsChart />
        </div>
      </div>

      {/* Bottom row: YoY comparison + Overdue installments */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <YoYComparison />
        <OverdueTable />
      </div>
    </div>
  );
}
