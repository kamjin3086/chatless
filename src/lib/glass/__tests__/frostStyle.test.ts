import { describe, expect, test } from 'vitest';
import { GLASS_FROST_CSS } from '../frostStyle';

describe('glass frost runtime css', () => {
  test('压掉简洁模式的实心白底，并带上毛玻璃模糊', () => {
    expect(GLASS_FROST_CSS).toContain('simple-ui:not(.dark) .bg-white');
    expect(GLASS_FROST_CSS).toContain('background-color: transparent !important');
    expect(GLASS_FROST_CSS).toContain('backdrop-filter: blur(40px)');
    expect(GLASS_FROST_CSS).toContain('rgba(255, 255, 255, 0.16)');
    expect(GLASS_FROST_CSS).toContain('#f3f8fc');
    expect(GLASS_FROST_CSS).not.toContain('255, 64, 160');
  });

  test('浮层分三型：dialog / menu / tip，不再混写 tooltip 与 dialog', () => {
    expect(GLASS_FROST_CSS).toContain('.glass-float-dialog');
    expect(GLASS_FROST_CSS).toContain('.glass-float-menu');
    expect(GLASS_FROST_CSS).toContain('.glass-float-tip');

    const dialogBlock = GLASS_FROST_CSS.match(
      /html\.glass-ui \.glass-float-dialog[\s\S]*?html\.glass-ui\.dark \.glass-float-dialog/
    )?.[0];
    expect(dialogBlock).toBeTruthy();
    expect(dialogBlock).toContain('[role="dialog"]');
    expect(dialogBlock).not.toContain('[data-slot="tooltip-content"]');

    const menuBlock = GLASS_FROST_CSS.match(
      /html\.glass-ui \.glass-float-menu[\s\S]*?html\.glass-ui\.dark \.glass-float-menu/
    )?.[0];
    expect(menuBlock).toBeTruthy();
    expect(menuBlock).toContain('[data-slot="dropdown-menu-content"]');
    expect(menuBlock).not.toContain('[data-slot="tooltip-content"]');

    const tipBlock = GLASS_FROST_CSS.match(
      /html\.glass-ui \.glass-float-tip[\s\S]*?html\.glass-ui\.dark \.glass-float-tip/
    )?.[0];
    expect(tipBlock).toBeTruthy();
    expect(tipBlock).toContain('[data-slot="tooltip-content"]');
    expect(tipBlock).not.toContain('[role="dialog"]');

    expect(GLASS_FROST_CSS).toContain('.glass-overlay');
    expect(GLASS_FROST_CSS).toContain('[data-slot="popover-content"]');
    expect(GLASS_FROST_CSS).toContain('[data-slot="select-content"]');
    expect(GLASS_FROST_CSS).toContain('[data-slot="alert-dialog-content"]');
    expect(GLASS_FROST_CSS).toContain('[data-slot="sheet-content"]');
    expect(GLASS_FROST_CSS).toContain('[data-sonner-toast]');
    expect(GLASS_FROST_CSS).toContain('.glass-panel');
    expect(GLASS_FROST_CSS).toContain('.glass-scrim');
    expect(GLASS_FROST_CSS).toContain('.knowledge-card');
    expect(GLASS_FROST_CSS).toContain('[role="tablist"]');
    expect(GLASS_FROST_CSS).toContain('[data-variant="ghost"]');
    expect(GLASS_FROST_CSS).toContain('::-webkit-scrollbar-button');
    expect(GLASS_FROST_CSS).toContain('display: none !important');
  });

  test('通透饱和度与语义色玻璃 token 映射', () => {
    expect(GLASS_FROST_CSS).toContain('saturate(1.42)');
    expect(GLASS_FROST_CSS).toContain('saturate(1.45)');
    expect(GLASS_FROST_CSS).toContain('var(--glass-accent)');
    expect(GLASS_FROST_CSS).toContain('var(--glass-agent-text)');
    expect(GLASS_FROST_CSS).toContain('var(--glass-search)');
    expect(GLASS_FROST_CSS).toContain('var(--glass-knowledge)');
    expect(GLASS_FROST_CSS).toContain('var(--glass-warn)');
    expect(GLASS_FROST_CSS).toContain('var(--glass-ok)');
    expect(GLASS_FROST_CSS).toContain('.glass-chip-agent');
    expect(GLASS_FROST_CSS).toContain('.glass-chip-search');
    expect(GLASS_FROST_CSS).toContain('.glass-btn-accent');
    expect(GLASS_FROST_CSS).toMatch(
      /\.glass-chip-agent \{[\s\S]*?background: transparent !important/
    );
    expect(GLASS_FROST_CSS).toContain('.composer-tool');
    expect(GLASS_FROST_CSS).toContain('.composer-send');
    expect(GLASS_FROST_CSS).toContain('.window-titlebar-name');
    expect(GLASS_FROST_CSS).toContain('.window-btn-win.window-btn-close:hover');
    expect(GLASS_FROST_CSS).toMatch(
      /\.glass-nav \.nav-item-active[\s\S]*?background: transparent !important/
    );
    expect(GLASS_FROST_CSS).not.toContain('rgba(51, 65, 85, 0.78)');
    expect(GLASS_FROST_CSS).not.toContain('rgb(30, 41, 59)');
  });

  test('composer 焦点走 accent，暖金不再作主边框', () => {
    const composerFocus = GLASS_FROST_CSS.match(
      /html\.glass-ui \.composer-box:focus-within[\s\S]*?\}/
    )?.[0];
    expect(composerFocus).toBeTruthy();
    expect(composerFocus).toContain('var(--glass-accent-border)');
    expect(composerFocus).not.toContain('0 0 0 2px');
    expect(composerFocus).not.toContain('0 0 0 3px');
    expect(composerFocus).not.toContain('212, 175, 110');
    expect(composerFocus).not.toContain('var(--glass-warm)');
  });

  test('弹窗玻璃分层，Switch 关闭态可读', () => {
    const dialogBlock = GLASS_FROST_CSS.match(
      /html\.glass-ui \.glass-float-dialog[\s\S]*?html\.glass-ui\.dark \.glass-float-dialog/
    )?.[0];
    expect(dialogBlock).toBeTruthy();
    expect(dialogBlock).toContain('saturate(1.55)');
    expect(dialogBlock).toContain('rgba(248, 252, 255, 0.78)');
    expect(dialogBlock).not.toContain('[data-slot="tooltip-content"]');
    expect(dialogBlock).not.toContain('[data-sonner-toast]');
    expect(GLASS_FROST_CSS).toContain('bg-white:not([role="dialog"])');

    expect(GLASS_FROST_CSS).toContain('rgba(71, 85, 105, 0.55)');
    expect(GLASS_FROST_CSS).toMatch(
      /\.glass-switch-track\[class~="bg-slate-300"\][\s\S]*?background-color: rgba\(71, 85, 105, 0\.55\)/
    );
    expect(GLASS_FROST_CSS).toContain('[class~="bg-green-100"]');
    expect(GLASS_FROST_CSS).toContain('[class~="bg-slate-300"]');
    expect(GLASS_FROST_CSS).toMatch(
      /\[class~="bg-green-100"\][\s\S]*?background-color: var\(--glass-ok\)/
    );
  });

  test('主按钮休息态与 Switch 开启走 accent 玻璃', () => {
    expect(GLASS_FROST_CSS).toContain('[class~="bg-slate-800"]');
    expect(GLASS_FROST_CSS).toContain('[class~="bg-slate-900"]');
    expect(GLASS_FROST_CSS).toContain('.glass-switch-track.glass-switch-on');
    expect(GLASS_FROST_CSS).toContain('.glass-switch-track[class~="bg-sky-500"]');
    expect(GLASS_FROST_CSS).toMatch(
      /\[class~="bg-slate-800"\][\s\S]*?background-color: var\(--glass-accent\)/
    );
    expect(GLASS_FROST_CSS).toMatch(
      /\.glass-switch-track\.glass-switch-on[\s\S]*?background-color: var\(--glass-accent\)/
    );
  });

  test('琥珀/历史标签与语义 chip 保留色相', () => {
    expect(GLASS_FROST_CSS).toContain('[class~="bg-amber-50"]');
    expect(GLASS_FROST_CSS).toContain('[class~="text-orange-500"]');
    expect(GLASS_FROST_CSS).toContain('.history-tag');
    expect(GLASS_FROST_CSS).toContain('[class~="glass-chip-active"]');
    expect(GLASS_FROST_CSS).toContain('[class~="bg-white/80"]');
    expect(GLASS_FROST_CSS).toContain('.glass-empty-glow');
    expect(GLASS_FROST_CSS).toContain('.glass-nav [class~="text-orange-500"]');
    expect(GLASS_FROST_CSS).toContain('.glass-field');
    expect(GLASS_FROST_CSS).toContain('.glass-inset');
    expect(GLASS_FROST_CSS).toContain('.glass-dialog-footer');
    expect(GLASS_FROST_CSS).toContain('[class~="bg-yellow-100"]');
    expect(GLASS_FROST_CSS).toContain('.glass-switch-knob');
    expect(GLASS_FROST_CSS).toContain('.glass-switch-track');
    expect(GLASS_FROST_CSS).toContain('.glass-nav-tooltip');
    expect(GLASS_FROST_CSS).toContain('.glass-checkbox-on');
    expect(GLASS_FROST_CSS).toContain(':not(.glass-switch-knob)');
    expect(GLASS_FROST_CSS).toContain(
      '.bg-white:not([role="dialog"]):not(.glass-float-dialog):not([data-slot="dialog-content"]):not([data-slot="alert-dialog-content"]):not([data-slot="sheet-content"]):not(.glass-switch-knob)'
    );
    expect(GLASS_FROST_CSS).toContain('[data-slot="checkbox"]');
    expect(GLASS_FROST_CSS).toMatch(
      /\[role="checkbox"\][\s\S]*?border-radius: 3px/
    );
  });

  test('设置侧栏内化到主面板，不再叠一层磨砂卡片', () => {
    expect(GLASS_FROST_CSS).toMatch(
      /html\.glass-ui \.settings-rail,\s*html\.glass-ui \.settings-main[\s\S]*?background: transparent !important/
    );
    expect(GLASS_FROST_CSS).toMatch(
      /html\.glass-ui \.settings-rail,\s*html\.glass-ui \.settings-main[\s\S]*?backdrop-filter: none !important/
    );
    expect(GLASS_FROST_CSS).toContain('.provider-rail');
    expect(GLASS_FROST_CSS).toContain('.provider-row.is-selected');
    expect(GLASS_FROST_CSS).toContain('.provider-row.is-muted');
    expect(GLASS_FROST_CSS).toMatch(
      /\.provider-row\.is-selected \{[\s\S]*?background-color: var\(--glass-accent-soft\)/
    );
    expect(GLASS_FROST_CSS).toMatch(
      /html\.glass-ui \.chat-rail \{[\s\S]*?backdrop-filter: blur\(32px\) saturate\(1\.42\)/
    );
    expect(GLASS_FROST_CSS).not.toMatch(
      /html\.glass-ui \.settings-rail,\s*html\.glass-ui \.chat-rail \{/
    );
  });
});
