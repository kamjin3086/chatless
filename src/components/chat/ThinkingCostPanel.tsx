'use client';

import type { TranslationKey } from '@/i18n/types';
import type { ThinkingLevelAggregate } from '@/lib/llm/thinkingTelemetry';
import {
  formatThinkingDuration,
  formatThinkingTokens,
} from '@/lib/llm/thinkingTelemetry';
import {
  aggregateRecentThinking,
  subscribeThinkingTurns,
} from '@/lib/telemetry/thinkingTelemetryStore';
import { useLocaleStore } from '@/store/localeStore';
/**
 * Cost per thinking level over recent turns (#101).
 *
 * The ticket's stated purpose is evidence: whether thinking harder buys anything worth paying
 * for, which is also why automatic level changes are not built yet. Rows are ordered by the
 * documented ladder, not by cost, so the reader is comparing levels rather than a ranking
 * that changes with the last message. Totals only include turns whose endpoint reported
 * usage, and the count of those is shown: a comparison built on half-reported data has to
 * say so on its face.
 */
import { useEffect, useState } from 'react';

/** How many recent turns the comparison covers. */
export const THINKING_COST_WINDOW = 20;

export function ThinkingCostPanel() {
  const translate = useLocaleStore((s) => s.t);
  const t = (key: string) => translate(key as TranslationKey);
  const [rows, setRows] = useState<ThinkingLevelAggregate[]>([]);

  const reload = () => {
    void aggregateRecentThinking(THINKING_COST_WINDOW).then(setRows);
  };

  useEffect(() => {
    reload();
    return subscribeThinkingTurns(reload);
  }, []);

  const reported = rows.reduce((total, row) => total + row.usageTurns, 0);
  const turns = rows.reduce((total, row) => total + row.turns, 0);
  const totalOf = (pick: (row: ThinkingLevelAggregate) => number) =>
    rows.reduce((total, row) => total + pick(row), 0);

  return (
    <div className="mt-1.5 border-t border-slate-200 pt-1.5 text-[11px] dark:border-slate-700">
      <div className="mb-1 font-medium text-slate-600 dark:text-slate-300">
        {t('thinkingCost.title')} ·{' '}
        {t('thinkingCost.window').replace('{0}', String(THINKING_COST_WINDOW))}
      </div>
      {rows.length === 0 && (
        <div className="text-slate-400 dark:text-slate-500">
          {t('thinkingCost.empty')}
        </div>
      )}
      <table className="w-full">
        <tbody>
          {rows.map((row) => (
            <tr key={row.level} className="align-top">
              <td className="py-0.5 pr-2 whitespace-nowrap">
                {t(
                  row.sent
                    ? `thinkingLevel.${row.level}`
                    : 'thinkingReport.notSent',
                )}
              </td>
              <td className="py-0.5 pr-2 text-right tabular-nums">
                {t('thinkingCost.turns').replace('{0}', String(row.turns))}
              </td>
              <td className="py-0.5 pr-2 text-right tabular-nums">
                {formatThinkingDuration(row.avgMs)}
              </td>
              <td className="py-0.5 text-right tabular-nums">
                {row.reasoningTurns > 0
                  ? formatThinkingTokens(row.reasoningTokens)
                  : formatThinkingTokens(undefined)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {turns > 0 && (
        <div className="mt-1 text-slate-400 dark:text-slate-500">
          {t('thinkingCost.usageNote')
            .replace('{0}', String(reported))
            .replace('{1}', String(turns))}
        </div>
      )}
      {reported > 0 && (
        <div className="mt-1 text-slate-400 dark:text-slate-500">
          {t('thinkingCost.promptTotal').replace(
            '{0}',
            formatThinkingTokens(totalOf((row) => row.promptTokens)),
          )}
          {' · '}
          {t('thinkingCost.completionTotal').replace(
            '{0}',
            formatThinkingTokens(totalOf((row) => row.completionTokens)),
          )}
        </div>
      )}
      <div className="mt-1 text-slate-400 dark:text-slate-500">
        {t('thinkingCost.escalationNote')}
      </div>
    </div>
  );
}
