import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Calendar, Download, RefreshCw } from "lucide-react";
import { useTranslation } from "@/i18n/useTranslation";

interface AnalyticsToolbarProps {
  range: string;
  onRangeChange: (v: string) => void;
  onExport: () => void;
  onRefresh: () => void;
}

export function AnalyticsToolbar({ range, onRangeChange, onExport, onRefresh }: AnalyticsToolbarProps) {
  const t = useTranslation();
  return (
    <div className="flex items-center justify-between gap-2 px-4 py-3 bg-slate-50 dark:bg-slate-800/40 border-b border-slate-200 dark:border-slate-700">
      {/* 左侧筛选 */}
      <div className="flex items-center gap-2">
        <Calendar className="h-4 w-4 text-slate-500" />
        <Select value={range} onValueChange={onRangeChange}>
          <SelectTrigger className="w-28 h-8">
            <SelectValue placeholder={t('analytics.range')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="7">{t('analytics.range.last7Days')}</SelectItem>
            <SelectItem value="30">{t('analytics.range.last30Days')}</SelectItem>
            <SelectItem value="90">{t('analytics.range.last90Days')}</SelectItem>
            <SelectItem value="all">{t('analytics.range.all')}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* 右侧操作 */}
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" title={t('analytics.export')} onClick={onExport}>
          <Download className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="icon" title={t('analytics.refresh')} onClick={onRefresh}>
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
} 