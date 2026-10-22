'use client';

import * as React from 'react';
import { AlertTriangle, ArrowLeft, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { RouteFailureDetails } from './routeFailure';

export interface RouteFailureViewProps {
  title: string;
  description: string;
  routeLabel: string;
  detailsLabel: string;
  retryLabel: string;
  backLabel: string;
  details: RouteFailureDetails;
  canGoBack: boolean;
  onRetry: () => void;
  onBack: () => void;
}

/**
 * The failure surface itself, with no hooks or router: the boundary supplies labels and
 * handlers, and this can be rendered in a test without a browser.
 */
export function RouteFailureView({
  title,
  description,
  routeLabel,
  detailsLabel,
  retryLabel,
  backLabel,
  details,
  canGoBack,
  onRetry,
  onBack,
}: RouteFailureViewProps) {
  return (
    <div
      role="alert"
      className="flex h-full min-h-0 items-center justify-center p-6"
    >
      <section className="glass-panel w-full max-w-2xl rounded-2xl border border-slate-200/70 bg-white/80 p-6 shadow-sm dark:border-white/10 dark:bg-slate-900/70">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" />
          <div className="min-w-0 flex-1">
            <h1 className="text-base font-semibold text-slate-800 dark:text-slate-100">
              {title}
            </h1>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
              {description}
            </p>
            <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
              {routeLabel.includes('{0}')
                ? routeLabel.replace('{0}', details.route)
                : `${routeLabel} ${details.route}`}
            </p>
            <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-slate-100/70 p-3 text-xs text-slate-700 dark:bg-white/5 dark:text-slate-200">
              {details.message}
            </pre>
            {(details.stack || details.componentStack) && (
              <details className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                <summary className="cursor-pointer">{detailsLabel}</summary>
                <pre className="mt-1 max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-slate-100/70 p-3 text-[11px] dark:bg-white/5">
                  {details.stack ?? details.message}
                  {details.componentStack
                    ? `\n\nComponent stack:\n${details.componentStack}`
                    : ''}
                </pre>
              </details>
            )}
            <div className="mt-4 flex flex-wrap gap-2">
              <Button type="button" onClick={onRetry}>
                <RotateCcw className="h-4 w-4" />
                {retryLabel}
              </Button>
              {canGoBack && (
                <Button type="button" variant="outline" onClick={onBack}>
                  <ArrowLeft className="h-4 w-4" />
                  {backLabel}
                </Button>
              )}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
