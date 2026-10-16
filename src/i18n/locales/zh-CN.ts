import type { TranslationDict } from '../types';

const zhCN: TranslationDict = {
  'nav.chat': '聊天',
  'nav.prompts': '提示词',
  'nav.knowledge': '知识',
  'nav.extensions': '扩展',
  'nav.analytics': '统计',
  'nav.settings': '设置',
  'nav.devTools': '开发工具',
  'settings.general.title': '常规设置',
  'settings.general.description': '界面语言、主题模式、字体大小等基础设置。',
  'settings.general.language': '界面语言',
  'settings.general.theme': '主题模式',
  'settings.general.nightBrightness': '夜间亮度',
  'settings.general.closeToTray': '关闭窗口时隐藏到系统托盘（从托盘菜单退出）',
  'settings.general.closeConfirm': '关闭时显示确认',
  'tray.newChat': '新建聊天',
  'tray.minimize': '最小化',
  'tray.settings': '设置',
  'tray.quit': '退出',
  'common.cancel': '取消',
  'common.confirm': '确认',
  'dialog.closeApp.title': '确认关闭',
  'dialog.closeApp.message': '确定要关闭应用吗？',
  'window.minimize': '最小化',
  'window.maximize': '最大化',
  'window.restore': '还原',
  'window.close': '关闭',
  'modelParams.thinkingLevel': '思考等级',
  'modelParams.thinkingLevel.help':
    '告诉模型在回答前思考多少。保持“自动”则不下发任何参数，完全由模型决定；未收录的模型不会下发。',
  'modelParams.thinkingLevel.auto': '自动（由模型决定）',
  'modelParams.thinkingLevel.inherit': '继承模型设置',
  'modelParams.thinkingLevel.suppress': '关闭：不下发思考等级',
  'modelParams.thinkingLevel.unverified': '此模型未验证，不会下发思考等级',
  'thinkingReport.carrier': '载体 {0}',
  'thinkingReport.completion': '输出 {0}',
  'thinkingFacts.level': '思考 {0}',
  'thinkingFacts.reasoning': '推理 {0} tokens',
  'thinkingFacts.requestTotal': '请求总耗时 {0}',
  'thinkingSwitch.label': '思考',

  'thinkingSwitch.unverifiedHint':
    '端点未经确认：所选档位按 reasoning_effort 下发',

  'thinkingSwitch.staleHint': '保存的档位此模型不提供，本次不下发',
  'thinkingSwitch.pendingHint': '下一条消息只发一次',
  'thinkingShortcut.help': 'Alt+D 循环切换，Alt+Shift+D 反向',
  'thinkingSwitch.migration.off': '旧版“思考模式：关”已换成“不思考”档位',
  'thinkingSwitch.migration.kept-on':
    '旧版“思考模式：开”仍然生效，思考档位不会改动它',
  'thinkingSwitch.migration.kept-unsupported':
    '旧版“思考模式：关”仍然生效，此模型没有对应档位',

  'thinkingLevel.off': '不思考',
  'thinkingLevel.minimal': '极简',
  'thinkingLevel.low': '低',
  'thinkingLevel.medium': '中',
  'thinkingLevel.high': '高',
  'thinkingLevel.xhigh': '极高',
  'thinkingLevel.max': '尽力思考',
  'modelParams.thinking.conflictEffortDisabled':
    '关闭思考和 xhigh / max 档不能同时使用：请把思考等级降到 high 或更低，或者让思考保持开启。',
  'modelParams.thinking.conflictDisabledUnsupported':
    '这个型号不允许关闭思考（任何档位下都会被拒绝），请改成选择一个思考等级。',
  'modelParams.thinking.conflictBudgetAboveMax':
    '手动思考预算必须小于最大输出 token，否则请求一定会被拒绝。',
  'modelParams.thinking.conflictBudgetTooSmall':
    '手动思考预算不得低于 1024 token，否则请求一定会被拒绝。',
  'modelParams.thinking.warnEffortNeedsRoom':
    '思考用的 token 也算在最大输出里；这一档建议把上限设到 64k 左右，不然回答容易被截断。',
  'modelParams.thinking.cacheNotice':
    '在这个 provider 上改动思考等级会让 prompt cache 失效，接下来的请求要重新按未缓存计费。',
};

export default zhCN;
