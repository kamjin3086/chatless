'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  KeyRound,
  Loader2,
  ExternalLink,
  LogOut,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
} from 'lucide-react';
import { InputField } from './InputField';
import { toast } from '@/components/ui/sonner';
import {
  ApiKeyCredentialProvider,
  ORCA_API_KEY_PROVIDER_ID,
  ORCA_PKCE_PROVIDER_ID,
  PkceCredentialProvider,
} from '@/lib/orcarouter/adapters';
import {
  createTauriCredentialStore,
  type CredentialResult,
} from '@/lib/orcarouter/credentials';
import { ORCA_KEY_MANAGEMENT_URL } from '@/lib/orcarouter/catalog';
import type { OrcaCatalog } from '@/lib/orcarouter/catalog';

/**
 * OrcaRouter configuration panel.
 *
 * Presents the two authentication choices side by side as first-class options:
 * paste an existing `sk-orca-…` key, or sign in and let OrcaRouter issue one. Both
 * routes produce the same durable key, and both write it through the same credential
 * store the rest of the app already trusts.
 */

const AUTH_LABEL = 'OrcaRouter - API';
const AUTH_PKCE_LABEL = 'OrcaRouter - Auth';

export interface OrcaRouterConnectPanelProps {
  /** Called after a credential changes so the caller can refresh the model catalog. */
  onCredentialChanged?: (result: CredentialResult) => void;
  /** Live catalog summary, rendered as the discovery status line. */
  catalog?: OrcaCatalog;
  onRefreshCatalog?: () => void;
}

export function OrcaRouterConnectPanel({
  onCredentialChanged,
  catalog,
  onRefreshCatalog,
}: OrcaRouterConnectPanelProps) {
  const store = useRef(createTauriCredentialStore());
  const apiKeyProvider = useRef(
    new ApiKeyCredentialProvider(store.current, ORCA_API_KEY_PROVIDER_ID),
  );
  const pkceProvider = useRef(
    new PkceCredentialProvider(store.current, {}, ORCA_PKCE_PROVIDER_ID),
  );

  const [apiKeyDraft, setApiKeyDraft] = useState('');
  const [apiKeyStatus, setApiKeyStatus] = useState<{
    connected: boolean;
    redacted: string;
    needsReauth: boolean;
  }>({
    connected: false,
    redacted: '',
    needsReauth: false,
  });
  const [pkceStatus, setPkceStatus] = useState<{
    connected: boolean;
    redacted: string;
    needsReauth: boolean;
  }>({
    connected: false,
    redacted: '',
    needsReauth: false,
  });

  // Monotonic attempt id: a late response from an earlier attempt must not update the UI.
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [authorizeUrl, setAuthorizeUrl] = useState('');
  const [codeDraft, setCodeDraft] = useState('');
  const attemptRef = useRef(0);

  const refreshStatus = useCallback(async () => {
    const [a, p] = await Promise.all([
      apiKeyProvider.current.describe(),
      pkceProvider.current.describe(),
    ]);
    setApiKeyStatus(a);
    setPkceStatus(p);
  }, []);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  const clearBusyHint = useCallback(() => {
    setBusy(false);
    setAuthorizeUrl('');
    setCodeDraft('');
  }, []);

  /**
   * Release login state when the page is hidden or unloaded.
   *
   * The page can be restored from the back-forward cache, so the busy flag and the
   * authorization hint must be cleared *here*: the guarded `finally` of an invalidated
   * request correctly refuses to touch state, which would leave a restored page busy.
   */
  useEffect(() => {
    const onPageHide = () => {
      pkceProvider.current.cancelSync();
      attemptRef.current += 1;
      clearBusyHint();
    };
    window.addEventListener('pagehide', onPageHide);
    return () => {
      window.removeEventListener('pagehide', onPageHide);
      // Real unmount: cancel server-side work without writing UI state.
      pkceProvider.current.cancelSync();
    };
  }, [clearBusyHint]);

  const handleSaveApiKey = async () => {
    try {
      const result = await apiKeyProvider.current.save(apiKeyDraft);
      setApiKeyDraft('');
      await refreshStatus();
      onCredentialChanged?.(result);
      toast.success('OrcaRouter API key saved');
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Could not save the API key',
      );
    }
  };

  const handleClearApiKey = async () => {
    await apiKeyProvider.current.clear();
    await refreshStatus();
    toast.info('OrcaRouter API key removed');
  };

  const handleBeginConnect = async () => {
    attemptRef.current += 1;
    const current = attemptRef.current;
    setAttempt(current);
    setBusy(true);
    setAuthorizeUrl('');
    try {
      // chatless is a static-export desktop client and cannot bind a loopback port,
      // so the out-of-band code flow is used with S256.
      const session = await pkceProvider.current.begin('oob');
      if (attemptRef.current !== current) return;
      setAuthorizeUrl(session.authorizeUrl);
      const { linkOpener } = await import('@/lib/utils/linkOpener');
      await linkOpener.openLink(session.authorizeUrl);
    } catch (error) {
      if (attemptRef.current !== current) return;
      clearBusyHint();
      toast.error(
        error instanceof Error
          ? error.message
          : 'Could not start the OrcaRouter login',
      );
    }
  };

  const handleCompleteConnect = async () => {
    const current = attemptRef.current;
    try {
      const result = await pkceProvider.current.complete(current, codeDraft);
      if (attemptRef.current !== current) return;
      await refreshStatus();
      onCredentialChanged?.(result);
      toast.success('Connected to OrcaRouter');
    } catch (error) {
      if (attemptRef.current !== current) return;
      toast.error(
        error instanceof Error
          ? error.message
          : 'Could not complete the OrcaRouter login',
      );
    } finally {
      if (attemptRef.current === current) clearBusyHint();
    }
  };

  const handleCancelConnect = async () => {
    await pkceProvider.current.cancel();
    attemptRef.current += 1;
    clearBusyHint();
  };

  const openKeyManagement = async () => {
    try {
      const { linkOpener } = await import('@/lib/utils/linkOpener');
      await linkOpener.openLink(ORCA_KEY_MANAGEMENT_URL);
    } catch {
      toast.error('Could not open the OrcaRouter console');
    }
  };

  return (
    <div
      className="space-y-3"
      data-testid="orcarouter-panel"
      data-provider={AUTH_LABEL}
    >
      {/* ── Choice 1: paste an existing API key ───────────────────────────── */}
      <section className="rounded-md border border-slate-200/70 dark:border-slate-700/70 p-2.5 space-y-2">
        <div className="flex items-center gap-1.5">
          <KeyRound className="w-3.5 h-3.5 text-slate-500" />
          <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
            {AUTH_LABEL} — API Key
          </span>
          {apiKeyStatus.connected && (
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
          )}
          {apiKeyStatus.needsReauth && (
            <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
          )}
        </div>

        <div className="flex items-center gap-1.5">
          <InputField
            label="API密钥"
            type="password"
            value={apiKeyDraft}
            onChange={(e) => setApiKeyDraft(e.target.value)}
            onBlur={() => {
              if (apiKeyDraft.trim()) void handleSaveApiKey();
            }}
            placeholder="sk-orca-…"
            className="h-8 text-xs w-full"
            wrapperClassName="mb-0 flex-1"
            icon={<KeyRound className="w-3.5 h-3.5 text-slate-400" />}
            inline
            labelWidthClassName="w-20"
            data-testid="orcarouter-api-key-input"
            autoComplete="off"
          />
          <button
            type="button"
            onClick={handleSaveApiKey}
            disabled={!apiKeyDraft.trim()}
            data-testid="orcarouter-api-key-save"
            className="h-7 px-2 text-xs rounded border border-slate-200/70 dark:border-slate-700/70 hover:bg-slate-100 dark:hover:bg-slate-700/50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            保存
          </button>
          <button
            type="button"
            onClick={openKeyManagement}
            title="前往密钥管理"
            className="h-7 w-7 flex items-center justify-center text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-slate-100 dark:hover:bg-slate-700/50 rounded transition-colors"
          >
            <ExternalLink className="w-3.5 h-3.5" />
          </button>
        </div>

        {apiKeyStatus.connected && (
          <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
            <span data-testid="orcarouter-api-key-status">
              已保存 {apiKeyStatus.redacted}
            </span>
            <button
              type="button"
              onClick={handleClearApiKey}
              data-testid="orcarouter-api-key-clear"
              className="flex items-center gap-1 hover:text-red-500 transition-colors"
            >
              <LogOut className="w-3 h-3" /> 清除
            </button>
          </div>
        )}
        {apiKeyStatus.needsReauth && (
          <p className="text-[11px] text-amber-600 dark:text-amber-400">
            该密钥已被撤销，请重新填写或使用下方账号登录。
          </p>
        )}
      </section>

      {/* ── Choice 2: sign in with OAuth 2.0 + PKCE ───────────────────────── */}
      <section className="rounded-md border border-slate-200/70 dark:border-slate-700/70 p-2.5 space-y-2">
        <div className="flex items-center gap-1.5">
          <CheckCircle2 className="w-3.5 h-3.5 text-slate-500" />
          <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
            {AUTH_PKCE_LABEL} — 账号登录
          </span>
          {pkceStatus.connected && (
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
          )}
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={handleBeginConnect}
            disabled={busy}
            data-testid="orcarouter-connect-button"
            aria-busy={busy}
            className="h-8 px-3 text-xs rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5 transition-colors"
          >
            {busy ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <KeyRound className="w-3.5 h-3.5" />
            )}
            Connect with OrcaRouter
          </button>
          {busy && (
            <button
              type="button"
              onClick={handleCancelConnect}
              data-testid="orcarouter-connect-cancel"
              className="h-8 px-2 text-xs rounded-md border border-slate-200/70 dark:border-slate-700/70 hover:bg-slate-100 dark:hover:bg-slate-700/50 transition-colors"
            >
              取消
            </button>
          )}
        </div>

        {authorizeUrl && (
          <div className="space-y-1.5" data-testid="orcarouter-authorize-hint">
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              浏览器未自动打开时，请手动访问下面的地址以授权；授权页会显示一个一次性代码。
            </p>
            <input
              readOnly
              value={authorizeUrl}
              data-testid="orcarouter-authorize-url"
              className="w-full h-7 px-2 text-[11px] bg-slate-50 dark:bg-slate-800/60 border border-slate-200/70 dark:border-slate-700/70 rounded text-slate-600 dark:text-slate-300"
            />
            <div className="flex items-center gap-1.5">
              <input
                value={codeDraft}
                onChange={(e) => setCodeDraft(e.target.value)}
                placeholder="粘贴授权码"
                data-testid="orcarouter-code-input"
                autoComplete="off"
                className="flex-1 h-7 px-2 text-xs bg-white dark:bg-slate-800/60 border border-slate-200/70 dark:border-slate-700/70 rounded focus:outline-none focus:ring-1 focus:ring-blue-500/40"
              />
              <button
                type="button"
                onClick={handleCompleteConnect}
                disabled={!codeDraft.trim()}
                data-testid="orcarouter-code-submit"
                className="h-7 px-2 text-xs rounded border border-slate-200/70 dark:border-slate-700/70 hover:bg-slate-100 dark:hover:bg-slate-700/50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                完成连接
              </button>
            </div>
          </div>
        )}

        {pkceStatus.connected && (
          <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
            <span data-testid="orcarouter-pkce-status">
              已连接 {pkceStatus.redacted}
            </span>
          </div>
        )}
      </section>

      {/* ── Model discovery status ────────────────────────────────────────── */}
      {catalog && (
        <div
          className="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400"
          data-testid="orcarouter-catalog-status"
          data-source={catalog.source}
          data-degraded={catalog.degraded ? 'true' : 'false'}
        >
          <span>
            {catalog.degraded
              ? `模型目录暂不可用，已回退到已验证清单（${catalog.models.length}）`
              : `已从 OrcaRouter 获取 ${catalog.models.length} 个可用模型`}
          </span>
          {onRefreshCatalog && (
            <button
              type="button"
              onClick={onRefreshCatalog}
              className="flex items-center gap-1 hover:text-blue-500 transition-colors"
            >
              <RefreshCw className="w-3 h-3" /> 刷新
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export default OrcaRouterConnectPanel;
