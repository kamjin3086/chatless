import type { TranslationDict } from '../types';

const enUS: TranslationDict = {
  'nav.chat': 'Chat',
  'nav.switchPage': 'Switch page',
  'nav.collapse': 'Hide app navigation',
  'nav.expand': 'Show app navigation',
  'toolApproval.title': 'Tool approvals',
  'toolApproval.scope':
    'Choose when the AI must ask before running tools in this conversation.',
  'toolApproval.defaultMode': 'Follow settings',
  'toolApproval.defaultDetails':
    'Already allowed actions run immediately. When approval is required, the AI waits for you to confirm.',
  'toolApproval.automaticMode': 'Automatic approval',
  'toolApproval.automaticDetails':
    'The AI can run commands, read knowledge bases, or call enabled external tools (MCP) without asking each time.',
  'toolApproval.automaticLimits':
    'This does not expand file access. Unapproved folders, file deletion, and administrative actions still follow the existing approval rules.',
  'toolApproval.current': 'Current mode',
  'toolApproval.temporaryStatus': 'Temporary permissions active',
  'toolApproval.clearOnSwitch':
    'Switching back also revokes temporary permissions for this conversation.',
  'toolApproval.resetNote':
    'Closing or reloading the app restores your configured approval rules and clears temporary permissions. Switching modes does not undo actions already in progress.',
  'toolApproval.revoke': 'Revoke temporary permissions',
  'toolApproval.apply': 'Apply mode',
  'chatComposer.skills': 'Skills',
  'chatComposer.prompts': 'Prompts',
  'chatComposer.mentions': 'MCP and workspace files',
  'chatComposer.manageMcp': 'Manage MCP servers',
  'chatComposer.parentFolder': 'Back to parent folder',
  'chatComposer.workspaceFiles': 'Workspace files',
  'chatComposer.filePermissionNote':
    'Selecting a file inserts its path without granting AI access.',
  'chatComposer.noWorkspace': 'This conversation has no workspace directory.',
  'chatComposer.loadingFiles': 'Loading workspace files…',
  'chatComposer.filesUnavailable': 'Could not list this directory.',
  'chatComposer.noFiles': 'No matching files or folders.',
  'chatComposer.filesTruncated': 'Only the first 200 entries were loaded.',
  'chatComposer.noMcp': 'No matching MCP servers.',
  'chatComposer.mcpDisconnected': 'Disconnected',
  'chatComposer.mcpDisabled': 'Disabled',
  'chatSidebar.viewSettings': 'View settings',
  'chatSidebar.grouping': 'Group by',
  'chatSidebar.byTime': 'Time',
  'chatSidebar.byWorkspace': 'Working directory',
  'chatSidebar.defaultWorkspace': 'Default workspace',
  'chatSidebar.openWorkspace': 'Open workspace…',
  'chatSidebar.openWorkspaceFailed': 'Could not open the workspace. Try again.',
  'chatSidebar.newConversation': 'New conversation',
  'chatSidebar.newConversationInWorkspace': 'New conversation here',
  'chatSidebar.newConversationFailed':
    'Could not create the conversation. Try again.',
  'chatSidebar.emptyWorkspace': 'No conversations yet. Use + to start one.',
  'chatSidebar.currentWorkspace': 'Current workspace',
  'chatSidebar.revealWorkspace': 'Open in file manager',
  'chatSidebar.archive': 'Archive',
  'chatSidebar.archived': 'Archived',
  'chatSidebar.exitArchive': 'Exit archive view',
  'chatSidebar.restore': 'Unarchive',
  'chatSidebar.restoreWorkspace': 'Unarchive parent workspace',
  'chatSidebar.emptyArchive': 'No archived conversations or workspaces',
  'chatSidebar.deleteFailed': 'Deletion did not complete. Try again.',
  'chatSidebar.today': 'Today',
  'chatSidebar.yesterday': 'Yesterday',
  'chatSidebar.last7Days': 'Last 7 days',
  'chatSidebar.last30Days': 'Last 30 days',
  'chatSidebar.older': 'Older',
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
  'settings.general.closeToTray':
    'Close window to tray (quit from the tray menu)',
  'settings.general.closeConfirm': 'Confirm before closing',
  'tray.newChat': 'New Chat',
  'tray.show': 'Show Window',
  'tray.settings': 'Settings',
  'tray.quit': 'Quit',
  'common.cancel': 'Cancel',
  'common.confirm': 'Confirm',
  'error.title': 'This page hit an error',
  'error.description':
    'This page could not finish rendering. Your conversation is still here - retry or go back to chats.',
  'error.route': 'Failed route: {0}',
  'error.details': 'Error details',
  'error.componentStack': 'Component stack:',
  'error.unknown': 'Unknown error',
  'error.retry': 'Retry',
  'error.backToChat': 'Back to chats',
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
