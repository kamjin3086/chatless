'use client';

/**
 * What a completed reply's thinking was, next to the answer (#101).
 *
 * Deliberately narrow. The message already shows how long it thought, so this adds only the
 * two things that view cannot say: which level was actually sent, and what thinking cost in
 * tokens when the endpoint reported it. A level that never reached the wire says nothing -
 * "auto" is not a fact about the answer. The request's own wall-clock lives in the tooltip,
 * labelled as such, because it includes tool rounds and streaming and is a different number
 * from the thinking time above it.
 */
import { useEffect, useState } from 'react';
import type { ThinkingTurnRecord } from '@/lib/llm/thinkingTelemetry';
import {
  formatThinkingDuration,
  formatThinkingTokens,
} from '@/lib/llm/thinkingTelemetry';
import {
  getTurnForMessage,
  subscribeThinkingTurns,
} from '@/lib/telemetry/thinkingTelemetryStore';
import type { TranslationKey } from '@/i18n/types';
import { useLocaleStore } from '@/store/localeStore';

/**
 * Did this answer think at all?
 *
 * The facts line exists to explain a thinking step the reader can already see; with nothing
 * to explain it is noise, and a level being configured is not evidence that it was used.
 * Either a think segment with content, or the duration saved on older messages whose
 * segments were never stored.
 */
export function hasThinkingEvidence(args: {
  segments?: readonly unknown[];
  thinkingDuration?: number;
}): boolean {
  if ((args.thinkingDuration ?? 0) > 0) return true;
  if (!Array.isArray(args.segments)) return false;
  return args.segments.some((segment) => {
    const seg = segment as { kind?: string; text?: string } | null;
    return seg?.kind === 'think' && String(seg.text ?? '').trim().length > 0;
  });
}

export function ThinkingLevelFacts({ messageId }: { messageId?: string }) {
  const translate = useLocaleStore((s) => s.t);
  const t = (key: string) => translate(key as TranslationKey);
  const [turn, setTurn] = useState<ThinkingTurnRecord | null>(null);

  useEffect(() => {
    if (!messageId) {
      setTurn(null);
      return;
    }
    let alive = true;
    // The turn is recorded when the stream completes, which is after this message mounted.
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

  if (!turn || !turn.sent) return null;

  const detail = [
    `${turn.provider} / ${turn.model}`,
    turn.carrier
      ? t('thinkingReport.carrier').replace('{0}', turn.carrier)
      : '',
    t('thinkingFacts.requestTotal').replace(
      '{0}',
      formatThinkingDuration(turn.durationMs),
    ),
    t('thinkingReport.completion').replace(
      '{0}',
      formatThinkingTokens(turn.completionTokens),
    ),
  ]
    .filter(Boolean)
    .join(' · ');

  const parts = [
    t('thinkingFacts.level').replace('{0}', t(`thinkingLevel.${turn.level}`)),
  ];
  if (turn.reasoningTokens !== undefined) {
    parts.push(
      t('thinkingFacts.reasoning').replace(
        '{0}',
        formatThinkingTokens(turn.reasoningTokens),
      ),
    );
  }

  return (
    <span
      className="text-[10px] text-slate-400 dark:text-slate-500 whitespace-nowrap"
      title={detail}
    >
      {parts.join(' · ')}
    </span>
  );
}
