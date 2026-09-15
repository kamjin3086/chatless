export type Locale = 'zh' | 'en';

export type TranslationKey =
  | 'nav.chat'
  | 'nav.prompts'
  | 'nav.knowledge'
  | 'nav.extensions'
  | 'nav.analytics'
  | 'nav.settings'
  | 'nav.devTools'
  | 'settings.general.title'
  | 'settings.general.description'
  | 'settings.general.language'
  | 'settings.general.theme'
  | 'settings.general.nightBrightness'
  | 'settings.general.minimizeToTray'
  | 'settings.general.closeConfirm'
  | 'tray.newChat'
  | 'tray.minimize'
  | 'tray.settings'
  | 'tray.quit'
  | 'common.cancel'
  | 'common.confirm'
  | 'dialog.closeApp.title'
  | 'dialog.closeApp.message'
  | 'window.minimize'
  | 'window.maximize'
  | 'window.restore'
  | 'window.close';

export type TranslationDict = Record<TranslationKey, string>;
