/** 构建链路会丢掉 .glass-ui 的 backdrop-filter；启用主题时注入到 document。 */
export const GLASS_FROST_STYLE_ID = 'chatless-glass-frost';

export const GLASS_FROST_CSS = `
html.glass-ui,
html.glass-ui body {
  background-color: transparent !important;
}

html.glass-ui:not(.dark) {
  background-image:
    radial-gradient(880px 640px at 22% 18%, rgba(56, 189, 248, 0.22), transparent 58%),
    radial-gradient(760px 560px at 82% 78%, rgba(45, 212, 191, 0.14), transparent 55%),
    radial-gradient(520px 400px at 50% 42%, rgba(251, 191, 36, 0.08), transparent 62%),
    linear-gradient(165deg, #f3f8fc 0%, #e7f0f7 52%, #edf4f9 100%);
  background-attachment: fixed;
}

html.glass-ui.dark {
  background-image:
    radial-gradient(880px 640px at 24% 16%, rgba(99, 102, 241, 0.28), transparent 56%),
    radial-gradient(760px 560px at 80% 80%, rgba(14, 165, 233, 0.18), transparent 54%),
    radial-gradient(520px 400px at 48% 38%, rgba(251, 191, 36, 0.06), transparent 60%),
    linear-gradient(165deg, #1a1f2e 0%, #141824 52%, #181d2a 100%);
  background-attachment: fixed;
}

html.glass-ui.simple-ui:not(.dark) .bg-white:not([role="dialog"]):not(.glass-float-dialog):not([data-slot="dialog-content"]):not([data-slot="alert-dialog-content"]):not([data-slot="sheet-content"]):not(.glass-switch-knob),
html.glass-ui.dark.simple-ui .bg-white:not([role="dialog"]):not(.glass-float-dialog):not([data-slot="dialog-content"]):not([data-slot="alert-dialog-content"]):not([data-slot="sheet-content"]):not(.glass-switch-knob),
html.glass-ui .glass-surface,
html.glass-ui .glass-shell-inner,
html.glass-ui .bg-slate-50,
html.glass-ui.dark .bg-slate-900 {
  background-color: transparent !important;
  background-image: none !important;
}

html.glass-ui .chat-rail .bg-white,
html.glass-ui .chat-rail .bg-gray-50,
html.glass-ui .history-sticky-header {
  background-color: transparent !important;
  background-image: none !important;
}

html.glass-ui [class~="bg-white/95"],
html.glass-ui [class~="bg-white/90"],
html.glass-ui [class~="bg-white/80"],
html.glass-ui [class~="bg-slate-50/80"],
html.glass-ui [class~="bg-slate-900/95"],
html.glass-ui [class~="bg-slate-900/90"],
html.glass-ui [class~="bg-slate-900/60"] {
  background-color: transparent !important;
  background-image: none !important;
}

html.glass-ui .glass-overlay {
  background-image: none !important;
}

/* 浮层分型：对话框 / 菜单 / 提示 */
html.glass-ui .glass-float-dialog,
html.glass-ui [role="dialog"],
html.glass-ui [data-slot="dialog-content"],
html.glass-ui [data-slot="alert-dialog-content"],
html.glass-ui [data-slot="sheet-content"],
html.glass-ui [data-radix-dialog-content],
html.glass-ui [data-radix-alert-dialog-content],
html.glass-ui.simple-ui .glass-float-dialog,
html.glass-ui.simple-ui [role="dialog"],
html.glass-ui.simple-ui [data-slot="dialog-content"],
html.glass-ui.simple-ui [data-slot="alert-dialog-content"],
html.glass-ui.simple-ui [data-slot="sheet-content"] {
  background-color: rgba(248, 252, 255, 0.78) !important;
  background-image: none !important;
  border-color: rgba(148, 163, 184, 0.38) !important;
  border-radius: var(--glass-radius-overlay) !important;
  backdrop-filter: blur(36px) saturate(1.55) !important;
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.86),
    inset 0 0 0 1px rgba(255, 255, 255, 0.22),
    0 24px 56px rgba(15, 23, 42, 0.16),
    0 0 40px rgba(56, 189, 248, 0.1) !important;
  color: var(--glass-text-primary) !important;
}

html.glass-ui.dark .glass-float-dialog,
html.glass-ui.dark [role="dialog"],
html.glass-ui.dark [data-slot="dialog-content"],
html.glass-ui.dark [data-slot="alert-dialog-content"],
html.glass-ui.dark [data-slot="sheet-content"],
html.glass-ui.dark [data-radix-dialog-content],
html.glass-ui.dark [data-radix-alert-dialog-content],
html.glass-ui.dark.simple-ui .glass-float-dialog,
html.glass-ui.dark.simple-ui [role="dialog"],
html.glass-ui.dark.simple-ui [data-slot="dialog-content"] {
  background-color: rgba(22, 28, 38, 0.72) !important;
  border-color: rgba(255, 255, 255, 0.18) !important;
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.16),
    inset 0 0 0 1px rgba(255, 255, 255, 0.06),
    0 28px 64px rgba(0, 0, 0, 0.42),
    0 0 36px rgba(56, 189, 248, 0.08) !important;
  color: var(--glass-text-primary) !important;
}

html.glass-ui [data-sonner-toast] {
  background-color: rgba(255, 255, 255, 0.62) !important;
  background-image: none !important;
  border-color: var(--glass-border) !important;
  border-radius: var(--glass-radius-overlay) !important;
  backdrop-filter: blur(24px) saturate(1.35) !important;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.5), 0 10px 28px rgba(15, 23, 42, 0.1) !important;
  color: var(--glass-text-primary) !important;
}

html.glass-ui.dark [data-sonner-toast] {
  background-color: rgba(22, 26, 32, 0.58) !important;
  border-color: rgba(255, 255, 255, 0.14) !important;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.1), 0 12px 32px rgba(0, 0, 0, 0.32) !important;
}

html.glass-ui .glass-float-menu,
html.glass-ui [data-slot="popover-content"],
html.glass-ui [data-slot="dropdown-menu-content"],
html.glass-ui [data-slot="dropdown-menu-sub-content"],
html.glass-ui [data-slot="select-content"],
html.glass-ui [role="menu"],
html.glass-ui [role="listbox"],
html.glass-ui .context-menu,
html.glass-ui .bg-popover {
  background-color: rgba(255, 255, 255, 0.5) !important;
  background-image: none !important;
  border-color: var(--glass-border) !important;
  border-radius: var(--glass-radius-overlay) !important;
  backdrop-filter: blur(20px) saturate(1.3) !important;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.42), 0 8px 24px rgba(15, 23, 42, 0.08) !important;
  color: var(--glass-text-secondary) !important;
}

html.glass-ui.dark .glass-float-menu,
html.glass-ui.dark [data-slot="popover-content"],
html.glass-ui.dark [data-slot="dropdown-menu-content"],
html.glass-ui.dark [data-slot="dropdown-menu-sub-content"],
html.glass-ui.dark [data-slot="select-content"],
html.glass-ui.dark [role="menu"],
html.glass-ui.dark [role="listbox"],
html.glass-ui.dark .context-menu,
html.glass-ui.dark .bg-popover {
  background-color: rgba(22, 26, 32, 0.42) !important;
  border-color: rgba(255, 255, 255, 0.12) !important;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.1), 0 10px 28px rgba(0, 0, 0, 0.26) !important;
  color: var(--glass-text-secondary) !important;
}

html.glass-ui .glass-float-tip,
html.glass-ui [data-slot="tooltip-content"],
html.glass-ui [role="tooltip"] {
  background-color: rgba(15, 23, 42, 0.88) !important;
  background-image: none !important;
  color: rgb(248, 250, 252) !important;
  border-color: rgba(148, 163, 184, 0.28) !important;
  border-radius: var(--glass-radius-chip) !important;
  backdrop-filter: blur(12px) saturate(1.2) !important;
  box-shadow: 0 4px 14px rgba(15, 23, 42, 0.22), inset 0 1px 0 rgba(255, 255, 255, 0.08) !important;
}

html.glass-ui.dark .glass-float-tip,
html.glass-ui.dark [data-slot="tooltip-content"],
html.glass-ui.dark [role="tooltip"] {
  background-color: rgba(15, 23, 42, 0.9) !important;
  color: rgb(241, 245, 249) !important;
  border-color: rgba(255, 255, 255, 0.14) !important;
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.35), inset 0 1px 0 rgba(255, 255, 255, 0.06) !important;
}

html.glass-ui .glass-panel,
html.glass-ui.simple-ui .glass-panel,
html.glass-ui .knowledge-card,
html.glass-ui .chart-card {
  background-color: rgba(255, 255, 255, 0.22) !important;
  background-image: none !important;
  border-color: rgba(100, 116, 139, 0.28) !important;
  backdrop-filter: blur(18px) saturate(1.45) !important;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.35) !important;
}

html.glass-ui.dark .glass-panel,
html.glass-ui.dark .knowledge-card,
html.glass-ui.dark .chart-card {
  background-color: rgba(255, 255, 255, 0.08) !important;
  border-color: rgba(255, 255, 255, 0.14) !important;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.1) !important;
}

html.glass-ui .glass-overlay .bg-white:not(.glass-switch-knob),
html.glass-ui [role="dialog"] .bg-white:not(.glass-switch-knob),
html.glass-ui [data-radix-dialog-content] .bg-white:not(.glass-switch-knob),
html.glass-ui [data-radix-alert-dialog-content] .bg-white:not(.glass-switch-knob) {
  background-color: transparent !important;
  background-image: none !important;
}

html.glass-ui .glass-switch-track,
html.glass-ui [role="switch"] {
  border-radius: 999px !important;
}

html.glass-ui .glass-switch-knob,
html.glass-ui.simple-ui .glass-switch-knob {
  background-color: #fff !important;
  background-image: none !important;
  border-radius: 999px !important;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.28) !important;
  opacity: 1 !important;
}

html.glass-ui.dark .glass-switch-knob {
  background-color: rgb(255, 255, 255) !important;
}

html.glass-ui .glass-switch-track[class~="bg-slate-500"],
html.glass-ui .glass-switch-track[class~="bg-sky-500"],
html.glass-ui .glass-switch-track.glass-switch-on,
html.glass-ui .glass-switch-track.peer-checked\:bg-slate-500,
html.glass-ui .glass-switch-track:has(:checked) {
  background-color: var(--glass-accent) !important;
  background-image: none !important;
  border: none !important;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.28), 0 1px 4px rgba(14, 165, 233, 0.22) !important;
}

html.glass-ui [data-slot="checkbox"],
html.glass-ui [role="checkbox"] {
  border-radius: 3px !important;
}

html.glass-ui [data-slot="checkbox-indicator"],
html.glass-ui .glass-checkbox-on {
  background-color: var(--glass-accent) !important;
  background-image: none !important;
  border-color: var(--glass-accent-border) !important;
  border-radius: 3px !important;
  color: rgb(255, 255, 255) !important;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.35) !important;
}

html.glass-ui.dark .glass-switch-track[class~="bg-slate-400"],
html.glass-ui.dark .glass-switch-track[class~="bg-sky-400"],
html.glass-ui.dark .glass-switch-track.glass-switch-on,
html.glass-ui.dark .glass-switch-track.peer-checked\:bg-slate-400,
html.glass-ui.dark .glass-switch-track:has(:checked) {
  background-color: var(--glass-accent) !important;
  border: none !important;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.18), 0 1px 4px rgba(14, 165, 233, 0.28) !important;
}

html.glass-ui .glass-switch-track[class~="bg-slate-200"],
html.glass-ui .glass-switch-track[class~="bg-slate-300"],
html.glass-ui .glass-switch-track[class~="bg-slate-200/70"] {
  background-color: rgba(71, 85, 105, 0.55) !important;
  background-image: none !important;
  border: none !important;
  box-shadow: inset 0 0 0 1px rgba(51, 65, 85, 0.28), inset 0 1px 3px rgba(15, 23, 42, 0.28) !important;
}

html.glass-ui.dark .glass-switch-track[class~="bg-slate-700"],
html.glass-ui.dark .glass-switch-track[class~="bg-slate-600"] {
  background-color: rgba(148, 163, 184, 0.42) !important;
  border: none !important;
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.22), inset 0 1px 2px rgba(0, 0, 0, 0.35) !important;
}

html.glass-ui [data-slot="tooltip-content"].glass-nav-tooltip,
html.glass-ui [role="tooltip"].glass-nav-tooltip {
  background-color: rgba(15, 23, 42, 0.88) !important;
  color: rgb(248, 250, 252) !important;
  border-radius: var(--glass-radius-chip) !important;
}

html.glass-ui.dark [data-slot="tooltip-content"].glass-nav-tooltip,
html.glass-ui.dark [role="tooltip"].glass-nav-tooltip {
  background-color: rgba(15, 23, 42, 0.9) !important;
  color: rgb(241, 245, 249) !important;
}

html.glass-ui .glass-scrim,
html.glass-ui [data-slot="dialog-overlay"],
html.glass-ui [data-slot="alert-dialog-overlay"],
html.glass-ui [data-slot="sheet-overlay"],
html.glass-ui [data-radix-dialog-overlay],
html.glass-ui [data-radix-alert-dialog-overlay] {
  background: rgba(15, 23, 42, 0.36) !important;
  backdrop-filter: blur(14px) saturate(1.12) !important;
}

html.glass-ui.dark .glass-scrim,
html.glass-ui.dark [data-slot="dialog-overlay"],
html.glass-ui.dark [data-slot="alert-dialog-overlay"],
html.glass-ui.dark [data-slot="sheet-overlay"],
html.glass-ui.dark [data-radix-dialog-overlay],
html.glass-ui.dark [data-radix-alert-dialog-overlay] {
  background: rgba(0, 0, 0, 0.52) !important;
}

/* 弹窗内对比度：说明文字、分割线、选项卡、旧蓝底选中 */
html.glass-ui [role="dialog"] [class~="text-gray-400"],
html.glass-ui [role="dialog"] [class~="text-gray-500"],
html.glass-ui [role="dialog"] [class~="text-slate-500"],
html.glass-ui [data-slot="dialog-content"] [class~="text-gray-400"],
html.glass-ui [data-slot="dialog-content"] [class~="text-gray-500"],
html.glass-ui [data-slot="dialog-content"] [class~="text-slate-500"],
html.glass-ui [data-slot="dialog-description"] {
  color: var(--glass-text-secondary) !important;
}

html.glass-ui [role="dialog"] [class~="border-t"],
html.glass-ui [data-slot="dialog-content"] [class~="border-t"] {
  border-color: rgba(148, 163, 184, 0.28) !important;
}

html.glass-ui [role="dialog"] [class~="border-gray-200"],
html.glass-ui [role="dialog"] [class~="border-gray-300"],
html.glass-ui [role="dialog"] [class~="border-slate-300/80"],
html.glass-ui [data-slot="dialog-content"] [class~="border-gray-200"] {
  border-color: rgba(100, 116, 139, 0.4) !important;
  background-color: rgba(255, 255, 255, 0.38) !important;
}

html.glass-ui.dark [role="dialog"] [class~="border-gray-700"],
html.glass-ui.dark [data-slot="dialog-content"] [class~="border-gray-700"] {
  border-color: rgba(255, 255, 255, 0.16) !important;
  background-color: rgba(255, 255, 255, 0.06) !important;
}

html.glass-ui [role="dialog"] [class~="border-blue-500"],
html.glass-ui [role="dialog"] [class~="bg-blue-50"],
html.glass-ui [role="dialog"] [class~="bg-blue-900/20"],
html.glass-ui [role="dialog"] [class~="bg-sky-50"],
html.glass-ui [role="dialog"] [class~="bg-sky-100"],
html.glass-ui [data-slot="dialog-content"] [class~="border-blue-500"] {
  border-color: var(--glass-accent-border) !important;
  background-color: var(--glass-accent-soft) !important;
  background-image: none !important;
}

html.glass-ui [role="dialog"] [class~="bg-blue-500"]:not([data-slot="button"]):not(.glass-btn-accent) {
  background-color: var(--glass-accent-soft) !important;
  color: var(--glass-accent-text) !important;
  border-color: var(--glass-accent-border) !important;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.35) !important;
}

html.glass-ui [data-slot="select-trigger"],
html.glass-ui [role="tablist"] {
  background-color: rgba(255, 255, 255, 0.14) !important;
  border-color: rgba(148, 163, 184, 0.2) !important;
  backdrop-filter: blur(12px) saturate(1.38) !important;
  box-shadow: none !important;
}

html.glass-ui [data-slot="select-trigger"][data-variant="ghost"],
html.glass-ui.dark [data-slot="select-trigger"][data-variant="ghost"] {
  background: transparent !important;
  border: none !important;
  box-shadow: none !important;
  backdrop-filter: none !important;
}

html.glass-ui [data-slot="select-trigger"][data-variant="ghost"]:hover,
html.glass-ui.dark [data-slot="select-trigger"][data-variant="ghost"]:hover {
  background-color: rgba(148, 163, 184, 0.12) !important;
}

html.glass-ui.dark [data-slot="select-trigger"][data-variant="ghost"]:hover {
  background-color: rgba(255, 255, 255, 0.06) !important;
}

html.glass-ui.dark [data-slot="select-trigger"],
html.glass-ui.dark [role="tablist"] {
  background-color: rgba(255, 255, 255, 0.06) !important;
  border-color: rgba(255, 255, 255, 0.12) !important;
}

html.glass-ui [role="tab"][data-state="active"] {
  background-color: rgba(255, 255, 255, 0.38) !important;
  color: var(--glass-text-primary) !important;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.45) !important;
  border-radius: var(--glass-radius-chip) !important;
}

html.glass-ui.dark [role="tab"][data-state="active"] {
  background-color: rgba(255, 255, 255, 0.14) !important;
  color: var(--glass-text-primary) !important;
}

html.glass-ui [role="tablist"] {
  border-radius: var(--glass-radius-control) !important;
}

html.glass-ui [data-slot="select-content"] .sticky,
html.glass-ui [role="listbox"] .sticky,
html.glass-ui [role="dialog"] .sticky,
html.glass-ui .glass-overlay .sticky {
  background: transparent !important;
  background-image: none !important;
  border-color: rgba(148, 163, 184, 0.16) !important;
  backdrop-filter: none !important;
}

html.glass-ui [class~="bg-blue-50/90"],
html.glass-ui [class~="bg-blue-50/80"],
html.glass-ui [class~="bg-blue-50/30"],
html.glass-ui [class~="bg-blue-50"],
html.glass-ui [class~="bg-blue-100"],
html.glass-ui [class~="bg-sky-50"] {
  background-color: var(--glass-search) !important;
  background-image: none !important;
}

html.glass-ui [class~="bg-violet-50"],
html.glass-ui [class~="bg-purple-100"],
html.glass-ui [class~="bg-purple-50"] {
  background-color: var(--glass-knowledge) !important;
  background-image: none !important;
}

html.glass-ui [class~="bg-amber-50"],
html.glass-ui [class~="bg-orange-50"],
html.glass-ui [class~="bg-yellow-50"],
html.glass-ui [class~="bg-yellow-100"] {
  background-color: var(--glass-warn) !important;
  background-image: none !important;
}

html.glass-ui [class~="bg-emerald-50"],
html.glass-ui [class~="bg-emerald-950/40"],
html.glass-ui [class~="bg-emerald-900/50"],
html.glass-ui [class~="bg-green-100"],
html.glass-ui [class~="bg-green-50"] {
  background-color: var(--glass-ok) !important;
  background-image: none !important;
}

html.glass-ui [class~="bg-rose-50"] {
  background-color: var(--glass-danger) !important;
  background-image: none !important;
}

html.glass-ui [class~="bg-slate-200/70"],
html.glass-ui [class~="bg-white/80"],
html.glass-ui [class~="bg-white/40"],
html.glass-ui [class~="bg-slate-200/50"],
html.glass-ui [class~="bg-slate-200/55"],
html.glass-ui [class~="bg-blue-600/40"] {
  background-color: rgba(255, 255, 255, 0.18) !important;
  background-image: none !important;
}

html.glass-ui.dark [class~="bg-blue-50/90"],
html.glass-ui.dark [class~="bg-blue-50/80"],
html.glass-ui.dark [class~="bg-blue-50/30"],
html.glass-ui.dark [class~="bg-blue-50"],
html.glass-ui.dark [class~="bg-blue-100"],
html.glass-ui.dark [class~="bg-sky-50"] {
  background-color: var(--glass-search) !important;
  background-image: none !important;
}

html.glass-ui.dark [class~="bg-violet-50"] {
  background-color: var(--glass-knowledge) !important;
  background-image: none !important;
}

html.glass-ui.dark [class~="bg-amber-50"],
html.glass-ui.dark [class~="bg-orange-50"],
html.glass-ui.dark [class~="bg-yellow-50"],
html.glass-ui.dark [class~="bg-yellow-100"] {
  background-color: var(--glass-warn) !important;
  background-image: none !important;
}

html.glass-ui.dark [class~="bg-emerald-50"],
html.glass-ui.dark [class~="bg-emerald-950/40"],
html.glass-ui.dark [class~="bg-emerald-900/50"],
html.glass-ui.dark [class~="bg-green-100"],
html.glass-ui.dark [class~="bg-green-50"],
html.glass-ui.dark [class~="bg-green-900/30"] {
  background-color: var(--glass-ok) !important;
  background-image: none !important;
}

html.glass-ui.dark [class~="bg-rose-50"] {
  background-color: var(--glass-danger) !important;
  background-image: none !important;
}

html.glass-ui.dark [class~="bg-slate-200/70"],
html.glass-ui.dark [class~="bg-white/80"],
html.glass-ui.dark [class~="bg-white/40"],
html.glass-ui.dark [class~="bg-slate-200/50"],
html.glass-ui.dark [class~="bg-slate-200/55"],
html.glass-ui.dark [class~="bg-blue-600/40"] {
  background-color: rgba(255, 255, 255, 0.08) !important;
  background-image: none !important;
}

html.glass-ui [class~="hover:bg-gray-100"]:hover,
html.glass-ui [class~="hover:bg-slate-100"]:hover,
html.glass-ui [class~="hover:bg-slate-100/70"]:hover {
  background-color: rgba(255, 255, 255, 0.14) !important;
}

html.glass-ui [class~="hover:bg-sky-50"]:hover,
html.glass-ui [class~="hover:bg-blue-50"]:hover {
  background-color: var(--glass-search) !important;
}

html.glass-ui [class~="hover:bg-violet-50"]:hover,
html.glass-ui [class~="hover:bg-violet-100"]:hover {
  background-color: var(--glass-knowledge) !important;
}

html.glass-ui [class~="hover:bg-rose-50"]:hover {
  background-color: var(--glass-danger) !important;
}

html.glass-ui [class~="hover:bg-amber-50"]:hover,
html.glass-ui [class~="hover:bg-amber-950/40"]:hover {
  background-color: var(--glass-warn) !important;
}

html.glass-ui [class~="hover:bg-emerald-100"]:hover,
html.glass-ui [class~="hover:bg-emerald-900/50"]:hover {
  background-color: var(--glass-ok) !important;
}

html.glass-ui [class~="text-blue-700"],
html.glass-ui [class~="text-blue-600"],
html.glass-ui [class~="text-blue-500"] {
  color: var(--glass-accent-text) !important;
}

html.glass-ui [class~="text-sky-500"],
html.glass-ui [class~="text-sky-600"],
html.glass-ui [class~="text-sky-700"] {
  color: var(--glass-search-text) !important;
}

html.glass-ui [class~="text-violet-500"],
html.glass-ui [class~="text-violet-600"],
html.glass-ui [class~="text-purple-700"],
html.glass-ui [class~="text-purple-600"] {
  color: var(--glass-knowledge-text) !important;
}

html.glass-ui [class~="text-amber-500"],
html.glass-ui [class~="text-amber-600"],
html.glass-ui [class~="text-orange-500"],
html.glass-ui [class~="text-orange-600"] {
  color: var(--glass-warn-text) !important;
}

html.glass-ui [class~="text-emerald-500"],
html.glass-ui [class~="text-emerald-600"],
html.glass-ui [class~="text-emerald-700"],
html.glass-ui [class~="text-emerald-400"],
html.glass-ui [class~="text-green-700"],
html.glass-ui [class~="text-green-600"] {
  color: var(--glass-ok-text) !important;
}

html.glass-ui.dark [class~="text-blue-700"],
html.glass-ui.dark [class~="text-blue-600"],
html.glass-ui.dark [class~="text-blue-500"],
html.glass-ui.dark [class~="text-blue-400"] {
  color: var(--glass-accent-text) !important;
}

html.glass-ui.dark [class~="text-sky-500"],
html.glass-ui.dark [class~="text-sky-600"] {
  color: var(--glass-search-text) !important;
}

html.glass-ui.dark [class~="text-violet-500"],
html.glass-ui.dark [class~="text-violet-600"] {
  color: var(--glass-knowledge-text) !important;
}

html.glass-ui.dark [class~="text-amber-500"],
html.glass-ui.dark [class~="text-amber-600"],
html.glass-ui.dark [class~="text-orange-500"],
html.glass-ui.dark [class~="text-orange-600"] {
  color: var(--glass-warn-text) !important;
}

html.glass-ui.dark [class~="text-emerald-500"],
html.glass-ui.dark [class~="text-emerald-600"],
html.glass-ui.dark [class~="text-emerald-400"],
html.glass-ui.dark [class~="text-green-700"],
html.glass-ui.dark [class~="text-green-600"],
html.glass-ui.dark [class~="text-green-400"] {
  color: var(--glass-ok-text) !important;
}

html.glass-ui [class~="bg-blue-600"],
html.glass-ui [class~="bg-blue-500"],
html.glass-ui [class~="bg-slate-800"],
html.glass-ui [class~="bg-slate-900"],
html.glass-ui [class~="from-blue-500"],
html.glass-ui [class~="from-blue-600"],
html.glass-ui [class~="to-blue-600"],
html.glass-ui [class~="to-purple-600"],
html.glass-ui [class~="from-purple-600"],
html.glass-ui [class~="from-indigo-500"],
html.glass-ui [class~="to-indigo-500"],
html.glass-ui [class~="from-violet-500"],
html.glass-ui .glass-btn-accent {
  background-image: none !important;
  background-color: var(--glass-accent) !important;
  border-color: var(--glass-accent-border) !important;
  color: rgb(255, 255, 255) !important;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.35), 0 2px 10px rgba(14, 165, 233, 0.22) !important;
}

html.glass-ui [class~="from-violet-100"],
html.glass-ui [class~="to-purple-50"] {
  background-image: none !important;
  background-color: var(--glass-knowledge) !important;
}

html.glass-ui [class~="from-blue-50"],
html.glass-ui [class~="from-blue-50/80"],
html.glass-ui [class~="from-blue-50/90"],
html.glass-ui [class~="to-indigo-50/80"],
html.glass-ui [class~="to-indigo-50/60"],
html.glass-ui [class~="to-blue-50/30"] {
  background-image: none !important;
  background-color: var(--glass-search) !important;
}

html.glass-ui [class~="bg-blue-600"]:hover,
html.glass-ui [class~="hover:bg-blue-700"]:hover,
html.glass-ui [class~="bg-blue-500"]:hover,
html.glass-ui [class~="hover:bg-blue-600"]:hover,
html.glass-ui .glass-btn-accent:hover:not(:disabled) {
  background-color: var(--glass-accent-hover) !important;
}

html.glass-ui [class~="bg-slate-800"]:hover,
html.glass-ui [class~="hover:bg-slate-900"]:hover {
  background-color: var(--glass-accent-hover) !important;
}

html.glass-ui .bg-gray-100,
html.glass-ui .glass-overlay .bg-gray-100 {
  background-color: rgba(255, 255, 255, 0.16) !important;
}

html.glass-ui .composer-box:focus-within {
  border-color: var(--glass-accent-border) !important;
  --tw-ring-shadow: 0 0 #0000 !important;
  --tw-ring-offset-shadow: 0 0 #0000 !important;
  box-shadow: none !important;
}

html.glass-ui .glass-empty-glow {
  background: radial-gradient(circle, rgba(56, 189, 248, 0.42), rgba(14, 165, 233, 0.12), transparent 72%) !important;
  opacity: 0.38 !important;
}

html.glass-ui.dark .glass-empty-glow {
  background: radial-gradient(circle, rgba(56, 189, 248, 0.28), rgba(99, 102, 241, 0.1), transparent 72%) !important;
  opacity: 0.32 !important;
}

html.glass-ui .about-support .glass-panel {
  background-color: rgba(255, 255, 255, 0.18) !important;
  background-image: none !important;
  border-color: rgba(148, 163, 184, 0.2) !important;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.35) !important;
}

html.glass-ui.dark .about-support .glass-panel {
  background-color: rgba(255, 255, 255, 0.06) !important;
  border-color: rgba(255, 255, 255, 0.12) !important;
}

html.glass-ui .settings-rail [class~="bg-slate-200/55"] {
  background-color: var(--glass-accent-soft) !important;
}

html.glass-ui .glass-panel[class~="bg-white/80"],
html.glass-ui .glass-panel[class~="bg-white/40"] {
  background-color: rgba(255, 255, 255, 0.22) !important;
  background-image: none !important;
}

html.glass-ui.dark .glass-panel[class~="bg-white/80"],
html.glass-ui.dark .glass-panel[class~="bg-white/40"] {
  background-color: rgba(255, 255, 255, 0.08) !important;
}

html.glass-ui .glass-nav [class~="border-orange-400/30"],
html.glass-ui .glass-nav [class~="border-orange-500/30"] {
  border-color: rgba(251, 146, 60, 0.35) !important;
}

html.glass-ui .glass-nav [class~="text-orange-500"],
html.glass-ui .glass-nav [class~="text-orange-400"] {
  color: rgb(234, 88, 12) !important;
}

html.glass-ui.dark .glass-nav [class~="text-orange-500"],
html.glass-ui.dark .glass-nav [class~="text-orange-400"] {
  color: rgb(251, 146, 60) !important;
}

html.glass-ui .history-tag {
  background-image: none !important;
  background-color: var(--glass-accent-soft) !important;
  color: var(--glass-accent-text) !important;
}

html.glass-ui.dark .history-tag {
  background-color: var(--glass-accent-soft) !important;
  color: var(--glass-accent-text) !important;
}

html.glass-ui [class~="glass-chip-active"] {
  background-color: var(--glass-accent-soft) !important;
  background-image: none !important;
  color: var(--glass-accent-text) !important;
  border-color: var(--glass-accent-border) !important;
}

html.glass-ui.dark [class~="glass-chip-active"] {
  background-color: var(--glass-accent-soft) !important;
  color: var(--glass-accent-text) !important;
  border-color: var(--glass-accent-border) !important;
}

html.glass-ui .glass-chip-agent {
  background: transparent !important;
  border-color: transparent !important;
  color: var(--glass-agent-text) !important;
  box-shadow: none !important;
}

html.glass-ui .glass-chip-search {
  background: transparent !important;
  border-color: transparent !important;
  color: var(--glass-search-text) !important;
  box-shadow: none !important;
}

html.glass-ui .glass-chip-knowledge {
  background: transparent !important;
  border-color: transparent !important;
  color: var(--glass-knowledge-text) !important;
  box-shadow: none !important;
}

html.glass-ui .glass-chip-ok {
  background: transparent !important;
  border-color: transparent !important;
  color: var(--glass-ok-text) !important;
  box-shadow: none !important;
}

html.glass-ui .composer-tool,
html.glass-ui .composer-send,
html.glass-ui .input-area .composer-tool,
html.glass-ui .input-area .composer-send {
  background: transparent !important;
  background-image: none !important;
  border-color: transparent !important;
  box-shadow: none !important;
}

html.glass-ui .composer-tool:hover,
html.glass-ui .composer-send:hover,
html.glass-ui .input-area .composer-tool:hover,
html.glass-ui .input-area .composer-send:hover {
  background: transparent !important;
}

html.glass-ui .composer-send {
  color: var(--glass-accent-text) !important;
}

html.glass-ui .inline-edit,
html.glass-ui input.inline-edit,
html.glass-ui .inline-edit.glass-field {
  background: transparent !important;
  background-image: none !important;
  border-top-color: transparent !important;
  border-left-color: transparent !important;
  border-right-color: transparent !important;
  border-radius: 0 !important;
  box-shadow: none !important;
  backdrop-filter: none !important;
}

html.glass-ui .glass-nav .nav-item,
html.glass-ui .glass-nav .nav-item-active,
html.glass-ui .glass-nav .nav-item:hover {
  background: transparent !important;
  box-shadow: none !important;
  border-color: transparent !important;
}

html.glass-ui .glass-nav .nav-item-active {
  color: var(--glass-accent-text) !important;
}

html.glass-ui input:not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="file"]):not([type="hidden"]):not([type="color"]):not(.inline-edit),
html.glass-ui textarea,
html.glass-ui select {
  background-color: rgba(255, 255, 255, 0.28) !important;
  border-color: var(--glass-border) !important;
  border-radius: var(--glass-radius-control) !important;
  color: var(--glass-text-primary) !important;
}

html.glass-ui.dark input:not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="file"]):not([type="hidden"]):not([type="color"]):not(.inline-edit),
html.glass-ui.dark textarea,
html.glass-ui.dark select {
  background-color: rgba(255, 255, 255, 0.08) !important;
  border-color: rgba(255, 255, 255, 0.14) !important;
  color: var(--glass-text-primary) !important;
}

html.glass-ui .glass-field:not(.inline-edit) {
  background-color: rgba(255, 255, 255, 0.28) !important;
  border-color: var(--glass-border) !important;
  border-radius: var(--glass-radius-control) !important;
  backdrop-filter: blur(12px) saturate(1.3) !important;
  color: var(--glass-text-primary) !important;
}

html.glass-ui.dark .glass-field:not(.inline-edit) {
  background-color: rgba(255, 255, 255, 0.08) !important;
  border-color: rgba(255, 255, 255, 0.14) !important;
}

html.glass-ui input::placeholder,
html.glass-ui textarea::placeholder {
  color: var(--glass-text-muted) !important;
}

html.glass-ui .glass-inset {
  background-color: rgba(15, 23, 42, 0.05) !important;
  background-image: none !important;
  border-color: rgba(148, 163, 184, 0.22) !important;
}

html.glass-ui.dark .glass-inset {
  background-color: rgba(255, 255, 255, 0.05) !important;
  border-color: rgba(255, 255, 255, 0.1) !important;
}

html.glass-ui .glass-dialog-footer {
  background-color: rgba(255, 255, 255, 0.08) !important;
  background-image: none !important;
}

html.glass-ui.dark .glass-dialog-footer {
  background-color: rgba(255, 255, 255, 0.04) !important;
}

html.glass-ui [class~="bg-yellow-100"],
html.glass-ui [class~="bg-yellow-50"] {
  background-color: var(--glass-warn) !important;
  background-image: none !important;
}

html.glass-ui [class~="text-yellow-700"],
html.glass-ui [class~="text-yellow-600"] {
  color: var(--glass-warn-text) !important;
}

html.glass-ui.dark [class~="text-yellow-700"],
html.glass-ui.dark [class~="text-yellow-600"] {
  color: var(--glass-warn-text) !important;
}

html.glass-ui input:focus-visible,
html.glass-ui textarea:focus-visible,
html.glass-ui select:focus-visible {
  border-color: var(--glass-accent-border) !important;
  box-shadow: 0 0 0 2px rgba(56, 189, 248, 0.18) !important;
  outline: none !important;
}

html.glass-ui [class~="bg-red-600"],
html.glass-ui [class~="hover:bg-red-700"]:hover,
html.glass-ui [class~="bg-red-500"] {
  background-color: var(--glass-danger) !important;
  background-image: none !important;
  border: 1px solid rgba(244, 63, 94, 0.45) !important;
  color: rgb(255, 255, 255) !important;
}

html.glass-ui .bg-blue-600[class*="rounded"]:not([data-slot="checkbox"]):not([role="checkbox"]):not([data-slot="checkbox-indicator"]) {
  background-color: var(--glass-accent) !important;
  border-color: var(--glass-accent-border) !important;
}

html.glass-ui [class~="focus:ring-blue-500"],
html.glass-ui [class~="focus-visible:ring-blue-500"],
html.glass-ui [class~="focus:ring-blue-500/30"],
html.glass-ui [class~="focus-visible:ring-blue-500/30"],
html.glass-ui [class~="focus:border-blue-400"],
html.glass-ui [class~="focus-visible:border-blue-500"] {
  --tw-ring-color: rgba(56, 189, 248, 0.28) !important;
  border-color: var(--glass-accent-border) !important;
  box-shadow: 0 0 0 2px rgba(56, 189, 248, 0.18) !important;
}

html.glass-ui [class~="caret-blue-500"] {
  caret-color: var(--glass-accent-text) !important;
}

html.glass-ui.dark [class~="caret-blue-500"] {
  caret-color: var(--glass-accent-text) !important;
}

html.glass-ui .glass-nav,
html.glass-ui .glass-shell {
  backdrop-filter: blur(40px) saturate(1.42) !important;
}

html.glass-ui .glass-shell {
  position: fixed !important;
  z-index: 10;
}

html.glass-ui .glass-nav {
  background: rgba(255, 255, 255, 0.18) !important;
}

html.glass-ui .glass-shell {
  background: rgba(255, 255, 255, 0.16) !important;
}

html.glass-ui .glass-shell-inner {
  background: transparent !important;
}

html.glass-ui.dark .glass-nav {
  background: rgba(255, 255, 255, 0.08) !important;
}

html.glass-ui.dark .glass-shell {
  background: rgba(255, 255, 255, 0.07) !important;
}

html.glass-ui .input-area {
  background-color: transparent !important;
  background-image: none !important;
  border: none !important;
  box-shadow: none !important;
  backdrop-filter: none !important;
}

html.glass-ui.dark .input-area {
  background-color: transparent !important;
}

html.glass-ui .input-area .composer-box {
  background-color: rgba(255, 255, 255, 0.2) !important;
  border-color: var(--glass-border) !important;
  border-radius: 16px !important;
  overflow: hidden !important;
  isolation: isolate;
  background-clip: padding-box;
  backdrop-filter: none !important;
  box-shadow: none !important;
}

html.glass-ui.dark .input-area .composer-box {
  background-color: rgba(255, 255, 255, 0.08) !important;
}

html.glass-ui .prompt-chip,
html.glass-ui .settings-card,
html.glass-ui .setting-collapse,
html.glass-ui .setting-collapse-content {
  background: rgba(255, 255, 255, 0.14) !important;
  background-image: none !important;
  border-color: rgba(148, 163, 184, 0.28) !important;
  backdrop-filter: blur(16px) !important;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.28) !important;
}

html.glass-ui.dark .prompt-chip,
html.glass-ui.dark .settings-card,
html.glass-ui.dark .setting-collapse,
html.glass-ui.dark .setting-collapse-content {
  background: rgba(255, 255, 255, 0.07) !important;
  border-color: rgba(255, 255, 255, 0.1) !important;
}

html.glass-ui .input-area [class~="bg-blue-600"]:not(.composer-tool):not(.composer-send),
html.glass-ui .input-area [class~="bg-blue-700"]:not(.composer-tool):not(.composer-send),
html.glass-ui .input-area [class~="hover:bg-blue-700"]:not(.composer-tool):not(.composer-send),
html.glass-ui .input-area .glass-btn-accent:not(.composer-tool):not(.composer-send) {
  background-color: var(--glass-accent) !important;
  border-color: var(--glass-accent-border) !important;
  color: rgb(255, 255, 255) !important;
}

html.glass-ui .input-area [class~="bg-violet-50"],
html.glass-ui .input-area [class~="bg-sky-50"],
html.glass-ui .input-area [class~="hover:bg-violet-100"],
html.glass-ui .input-area [class~="hover:bg-sky-100"] {
  background-color: var(--glass-search) !important;
  background-image: none !important;
  color: var(--glass-search-text) !important;
}

html.glass-ui.dark .input-area [class~="bg-violet-50"],
html.glass-ui.dark .input-area [class~="bg-sky-50"] {
  background-color: var(--glass-search) !important;
  color: var(--glass-search-text) !important;
}

html.glass-ui .input-area [class~="bg-emerald-50"],
html.glass-ui .input-area [class~="bg-emerald-950/40"] {
  background-color: var(--glass-ok) !important;
  color: var(--glass-ok-text) !important;
}

html.glass-ui .settings-rail,
html.glass-ui .settings-main,
html.glass-ui .provider-rail,
html.glass-ui .provider-detail {
  background: transparent !important;
  backdrop-filter: none !important;
  box-shadow: none !important;
}

html.glass-ui .provider-rail .glass-field {
  background-color: rgba(255, 255, 255, 0.14) !important;
  box-shadow: none !important;
}

html.glass-ui .provider-row {
  color: var(--glass-text-primary) !important;
  box-shadow: none !important;
  border: none !important;
}

html.glass-ui .provider-row:hover:not(.is-selected) {
  background-color: rgba(15, 23, 42, 0.05) !important;
}

html.glass-ui .provider-row.is-selected {
  background-color: var(--glass-accent-soft) !important;
  color: var(--glass-text-primary) !important;
}

html.glass-ui .provider-row.is-muted:not(.is-selected) {
  color: var(--glass-text-muted) !important;
}

html.glass-ui.dark .provider-rail .glass-field {
  background-color: rgba(255, 255, 255, 0.08) !important;
}

html.glass-ui.dark .provider-row:hover:not(.is-selected) {
  background-color: rgba(255, 255, 255, 0.06) !important;
}

html.glass-ui .chat-rail {
  background: rgba(255, 255, 255, 0.16) !important;
  backdrop-filter: blur(32px) saturate(1.42) !important;
}

html.glass-ui.dark .chat-rail {
  background: rgba(255, 255, 255, 0.07) !important;
}

html.glass-ui [data-slot="select-trigger"]:not([data-variant="ghost"]) {
  border-radius: var(--glass-radius-control) !important;
}

html.glass-ui [data-slot="button"]:not([role="checkbox"]):not([data-slot="checkbox"]) {
  border-radius: var(--glass-radius-control) !important;
}

html.glass-ui [data-slot="dropdown-menu-item"]:focus,
html.glass-ui [data-slot="dropdown-menu-item"][data-highlighted] {
  background-color: rgba(255, 255, 255, 0.35) !important;
  color: var(--glass-text-primary) !important;
  border-radius: var(--glass-radius-chip) !important;
}

html.glass-ui.dark [data-slot="dropdown-menu-item"]:focus,
html.glass-ui.dark [data-slot="dropdown-menu-item"][data-highlighted] {
  background-color: rgba(255, 255, 255, 0.1) !important;
  color: var(--glass-text-primary) !important;
}

html.glass-ui .window-titlebar-name {
  color: var(--glass-text-secondary);
}

html.glass-ui .window-btn-win:hover {
  background: rgba(255, 255, 255, 0.28) !important;
  color: var(--glass-text-primary) !important;
}

html.glass-ui.dark .window-btn-win:hover {
  background: rgba(255, 255, 255, 0.1) !important;
}

html.glass-ui .window-btn-win.window-btn-close:hover,
html.glass-ui.dark .window-btn-win.window-btn-close:hover {
  background: #e81123 !important;
  color: #fff !important;
}

html.glass-ui.reduced-motion .glass-nav,
html.glass-ui.reduced-motion .glass-shell,
html.glass-ui.reduced-motion .input-area,
html.glass-ui.reduced-motion .chat-rail,
html.glass-ui.reduced-motion .glass-overlay,
html.glass-ui.reduced-motion .glass-panel,
html.glass-ui.reduced-motion [role="dialog"],
html.glass-ui.reduced-motion [data-radix-popper-content-wrapper] > *,
html.glass-ui.reduced-motion [data-sonner-toast],
html.glass-ui.reduced-motion .knowledge-card,
html.glass-ui.reduced-motion .chart-card {
  backdrop-filter: blur(8px) !important;
}

html.glass-ui,
html.glass-ui * {
  scrollbar-width: thin !important;
  scrollbar-color: rgba(148, 163, 184, 0.42) transparent !important;
}

html.glass-ui.dark,
html.glass-ui.dark * {
  scrollbar-color: rgba(255, 255, 255, 0.22) transparent !important;
}

html.glass-ui ::-webkit-scrollbar {
  width: 8px !important;
  height: 8px !important;
}

html.glass-ui ::-webkit-scrollbar-track,
html.glass-ui ::-webkit-scrollbar-corner {
  background: transparent !important;
}

html.glass-ui ::-webkit-scrollbar-thumb {
  background-color: rgba(148, 163, 184, 0.36) !important;
  border-radius: 999px !important;
  border: 2px solid transparent !important;
  background-clip: padding-box !important;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.28) !important;
}

html.glass-ui ::-webkit-scrollbar-thumb:hover {
  background-color: rgba(56, 189, 248, 0.42) !important;
}

html.glass-ui.dark ::-webkit-scrollbar-thumb {
  background-color: rgba(255, 255, 255, 0.18) !important;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.12) !important;
}

html.glass-ui.dark ::-webkit-scrollbar-thumb:hover {
  background-color: rgba(125, 211, 252, 0.38) !important;
}

html.glass-ui ::-webkit-scrollbar-button,
html.glass-ui ::-webkit-scrollbar-button:single-button,
html.glass-ui ::-webkit-scrollbar-button:decrement,
html.glass-ui ::-webkit-scrollbar-button:increment,
html.glass-ui ::-webkit-scrollbar-button:vertical:decrement,
html.glass-ui ::-webkit-scrollbar-button:vertical:increment,
html.glass-ui ::-webkit-scrollbar-button:horizontal:decrement,
html.glass-ui ::-webkit-scrollbar-button:horizontal:increment,
html.glass-ui ::-webkit-scrollbar-button:vertical:start:decrement,
html.glass-ui ::-webkit-scrollbar-button:vertical:end:increment,
html.glass-ui ::-webkit-scrollbar-button:vertical:start:increment,
html.glass-ui ::-webkit-scrollbar-button:vertical:end:decrement {
  display: none !important;
  width: 0 !important;
  height: 0 !important;
  appearance: none !important;
  background: transparent !important;
}
`;
