'use client';

import type { TranslationKey } from '@/i18n/types';
import type { ThinkingTurnRecord } from '@/lib/llm/thinkingTelemetry';
import {
  formatThinkingDuration,
  formatThinkingTokens,
} from '@/lib/llm/thinkingTelemetry';
import {
  getTurnForMessage,
  subscribeThinkingTurns,
} from '@/lib/telemetry/thinkingTelemetryStore';
import { useLocaleStore } from '@/store/localeStore';
/**
 * What one completed reply cost to think about (#101).
 *
 * Reads the recorded turn for this message; if nothing was recorded (an older message, a
 * run that never completed, a provider that never called back) it renders nothing rather
 * than guessing. The numbers come from the endpoint; the one honest answer to "the provider
 * did not say" is that the provider did not say.
 */
import { useEffect, useState } from 'react';

export function ThinkingTurnBadge({ messageId }: { messageId?: string }) {
  const translate = useLocaleStore((s) => s.t);
  const t = (key: string) => translate(key as TranslationKey);
  const [turn, setTurn] = useState<ThinkingTurnRecord | null>(null);

  useEffect(() => {
    if (!messageId) {
      setTurn(null);
      return;
    }
    let alive = true;
    // The turn is recorded when the stream completes, which is after this message mounted,
    // so reading once would leave a completed reply silently blank forever.
    const read = () => {
      void getTurnForMessage(messageId).then((found) => {
        if (alive) setTurn(found);
      });
    };
    setTurn(null);
    read();
    const unsubscribe = subscribeThinkingTurns(read);
    return () => {
      alive = false;
      unsubscribe();
    };
  }, [messageId]);

  if (!turn) return null;

  const parts: string[] = [];
  if (!turn.sent) {
    parts.push(t('thinkingReport.notSent'));
  } else {
    parts.push(
      t('thinkingReport.level').replace(
        '{0}',
        t(`thinkingLevel.${turn.level}`),
      ),
    );
    if (turn.carrier) {
      parts.push(t('thinkingReport.carrier').replace('{0}', turn.carrier));
    }
  }
  parts.push(
    turn.reasoningTokens !== undefined
      ? t('thinkingReport.reasoning').replace(
          '{0}',
          formatThinkingTokens(turn.reasoningTokens),
        )
      : t('thinkingReport.notReported'),
  );
  parts.push(formatThinkingDuration(turn.durationMs));

  const detail = [
    `${turn.provider} / ${turn.model}`,
    `${t('thinkingReport.completion').replace(
      '{0}',
      formatThinkingTokens(turn.completionTokens),
    )}`,
    `${formatThinkingTokens(turn.promptTokens)} prompt`,
  ].join(' · ');

  return (
    <span
      className="text-[10px] text-slate-400 dark:text-slate-500 whitespace-nowrap"
      title={detail}
    >
      {parts.join(' · ')}
    </span>
  );
}
