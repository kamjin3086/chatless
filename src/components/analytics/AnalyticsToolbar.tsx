import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Calendar, Download, RefreshCw } from "lucide-react";

interface AnalyticsToolbarProps {
  range: string;
  onRangeChange: (v: string) => void;
  onExport: () => void;
  onRefresh: () => void;
}

export function AnalyticsToolbar({ range, onRangeChange, onExport, onRefresh }: AnalyticsToolbarProps) {
  return (
    <div className="flex items-center justify-between gap-2 px-4 py-3 bg-slate-50 dark:bg-slate-800/40 border-b border-slate-200 dark:border-slate-700">
      {/* 左侧筛选 */}
      <div className="flex items-center gap-2">
        <Calendar className="h-4 w-4 text-slate-500" />
        <Select value={range} onValueChange={onRangeChange}>
          <SelectTrigger className="w-28 h-8">
            <SelectValue placeholder="范围" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="7">最近7天</SelectItem>
            <SelectItem value="30">最近30天</SelectItem>
            <SelectItem value="90">最近90天</SelectItem>
            <SelectItem value="all">全部</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* 右侧操作 */}
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" title="导出" onClick={onExport}>
          <Download className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="icon" title="刷新" onClick={onRefresh}>
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
} 