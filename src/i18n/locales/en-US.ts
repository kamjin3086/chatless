import type { TranslationDict } from '../types';

const enUS: TranslationDict = {
  'nav.chat': 'Chat',
  'nav.prompts': 'Prompts',
  'nav.knowledge': 'Knowledge',
  'nav.extensions': 'Extensions',
  'nav.analytics': 'Analytics',
  'nav.settings': 'Settings',
  'nav.devTools': 'Dev Tools',
  'settings.general.title': 'General',
  'settings.general.description':
    'Language, theme, fonts, and other basic preferences.',
  'settings.general.language': 'Language',
  'settings.general.theme': 'Theme',
  'settings.general.nightBrightness': 'Night brightness',
  'settings.general.minimizeToTray':
    'Minimize to system tray when clicking minimize',
  'settings.general.closeToTray':
    'Close window to tray (quit from the tray menu)',
  'settings.general.closeConfirm': 'Confirm before closing',
  'tray.newChat': 'New Chat',
  'tray.minimize': 'Minimize to Tray',
  'tray.settings': 'Settings',
  'tray.quit': 'Quit',
  'common.cancel': 'Cancel',
  'common.confirm': 'Confirm',
  'dialog.closeApp.title': 'Confirm Close',
  'dialog.closeApp.message': 'Are you sure you want to close the application?',
  'window.minimize': 'Minimize',
  'window.maximize': 'Maximize',
  'window.restore': 'Restore',
  'window.close': 'Close',
  'modelParams.thinkingLevel': 'Thinking level',
  'modelParams.thinkingLevel.help':
    'How much the model should think before answering. “Auto” sends nothing and leaves the choice to the model; unverified models are never sent a level.',
  'modelParams.thinkingLevel.auto': 'Auto (model decides)',
  'modelParams.thinkingLevel.inherit': 'Inherit the model setting',
  'modelParams.thinkingLevel.suppress': 'Off: send no thinking level',
  'modelParams.thinkingLevel.unverified':
    'Not verified for this model - no level is sent',
  'thinkingReport.carrier': 'carrier {0}',
  'thinkingReport.completion': 'output {0}',
  'thinkingFacts.level': '{0} thinking',
  'thinkingFacts.reasoning': '{0} reasoning tokens',
  'thinkingFacts.requestTotal': 'request took {0}',
  'thinkingSwitch.label': 'Thinking',

  'thinkingSwitch.unverifiedHint':
    'Endpoint unverified: a chosen tier goes out as reasoning_effort',

  'thinkingSwitch.staleHint':
    'The saved level is not offered by this model, so nothing is sent',
  'thinkingSwitch.pendingHint': 'Sent once, with the next message',
  'thinkingShortcut.help': 'Alt+D cycles levels, Alt+Shift+D reverses',
  'thinkingSwitch.migration.off':
    'The old thinking switch was off; that is now the "do not think" level',
  'thinkingSwitch.migration.kept-on':
    'The old thinking switch is still on and this level does not change it',
  'thinkingSwitch.migration.kept-unsupported':
    'The old thinking switch is still off and this model has no matching level',

  'thinkingLevel.off': 'Off',
  'thinkingLevel.minimal': 'Minimal',
  'thinkingLevel.low': 'Low',
  'thinkingLevel.medium': 'Medium',
  'thinkingLevel.high': 'High',
  'thinkingLevel.xhigh': 'Very high',
  'thinkingLevel.max': 'Maximum',
  'modelParams.thinking.conflictEffortDisabled':
    'Turning thinking off cannot be combined with xhigh or max: choose high or lower, or leave thinking on.',
  'modelParams.thinking.conflictDisabledUnsupported':
    'This model cannot be told not to think at any level; pick a thinking level instead.',
  'modelParams.thinking.conflictBudgetAboveMax':
    'A manual thinking budget has to be smaller than the maximum output tokens, or the request is rejected.',
  'modelParams.thinking.conflictBudgetTooSmall':
    'A manual thinking budget has to be at least 1024 tokens, or the request is rejected.',
  'modelParams.thinking.warnEffortNeedsRoom':
    'Thinking tokens count against the output limit; around 64k is the suggested floor at this level, or answers get truncated.',
  'modelParams.thinking.cacheNotice':
    'Changing the thinking level on this provider invalidates prompt caching, so the next requests pay uncached.',
};

export default enUS;
