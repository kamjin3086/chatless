import type { TranslationDict } from '../types';

const enUS: TranslationDict = {
  'nav.chat': 'Chat',
  'nav.switchPage': 'Switch page',
  'nav.collapse': 'Hide app navigation',
  'nav.expand': 'Show app navigation',
  'androidChat.conversationActions': 'Conversation actions',
  'androidChat.conversations': 'Conversations',
  'androidChat.searchConversations': 'Search conversations',
  'androidChat.back': 'Back',
  'androidChat.providers': 'Providers',
  'androidChat.searchModels': 'Search models or providers',
  'androidChat.availableModels': 'Available models',
  'androidChat.recentModels': 'Recently used',
  'androidChat.noModels': 'No matching models',
  'androidPhoto.capture': 'Take a photo',
  'androidPhoto.pick': 'Choose a photo',
  'androidPhoto.preview': 'Selected photo preview',
  'androidPhoto.remove': 'Remove photo',
  'androidPhoto.recipient': 'Photo recipient',
  'androidPhoto.checking': 'Checking whether this model accepts photos…',
  'androidPhoto.supported':
    'Accepts photos. The photo is shared with this provider only when you tap Send.',
  'androidPhoto.unsupported':
    'Photo sending is unavailable for this model or request strategy. Try a vision model on OpenAI-compatible Chat Completions (not strict OpenAI), Gemini, or Ollama, or remove the photo.',
  'androidPhoto.busy':
    'Wait for the current reply to finish or stop it before sending the photo.',
  'androidPhoto.other_attachment':
    'Remove the document or finish editing before sending the photo.',
  'androidPhoto.acquiring': 'Opening photo…',
  'androidPhoto.unavailable':
    'Android could not open the camera or photo picker. Try the other option.',
  'androidPhoto.unreadable':
    'Could not prepare this photo. Try taking or choosing a different or smaller image.',
  'androidPhoto.too_large':
    'That photo is larger than 32 MB. Choose a smaller one.',
  'androidPhoto.recipient_changed':
    'The photo recipient or its image support changed. Reselect the model and try again.',
  'androidPhoto.not_accepted':
    'The photo is still in your draft. Retry, choose a smaller image, or try a photo-capable model with a larger context window.',
  'androidPhoto.message': '[Photo]',
  'androidPhotos.label': 'Android photos for this chat',
  'androidPhotos.choose': 'Choose photos',
  'androidPhotos.reselect': 'Reselect photos',
  'androidPhotos.forget': 'Forget photos',
  'androidPhotos.selected': 'Photos selected',
  'androidPhotos.preparing': 'Preparing selected photos…',
  'androidPhotos.disclosure':
    'Choosing photos doesn’t upload them. Photo organization needs a tool-capable model and shares file names, sizes and grouping with its provider, never photo contents.',
  'androidPhotos.unavailable':
    'Could not access the selected photos. Choose them again.',
  'androidDirectory.label': 'Android folder for this chat',
  'androidDirectory.choose': 'Choose folder',
  'androidDirectory.reselect': 'Reselect folder',
  'androidDirectory.forget': 'Forget folder',
  'androidDirectory.disclosure':
    'Picking a folder doesn’t upload anything. Folder requests use a tool-capable model and share names and metadata with its provider, not file contents.',
  'androidDirectory.revoked':
    'Folder access was lost. Reselect it or forget it to continue.',
  'androidDirectory.unavailable':
    'Could not access or update the folder selection. Try again.',
  'androidDocument.attach': 'Attach document',
  'androidDocument.formats': 'Text PDF or plain text (UTF-8)',
  'androidDocument.remove': 'Remove document',
  'androidDocument.working': 'Preparing document…',
  'androidDocument.disclosure':
    'Chatless does not upload the file when you pick it. Document questions require a tool-capable model; relevant excerpts go to the selected provider.',
  'androidDocument.empty': 'This text file is empty. Choose another file.',
  'androidDocument.inaccessible':
    'Could not access the document. Try choosing it again.',
  'androidDocument.oversized':
    'This document is too large. Limits: 8 MB per file, 200 PDF pages, and 1 MB of extracted text.',
  'androidDocument.scanned':
    'This PDF has no extractable text. Scanned pages need OCR, which is not supported here.',
  'androidDocument.unsupported':
    'Choose a readable text PDF or UTF-8 plain text file.',
  'chatStarter.title': 'Start a conversation',
  'chatStarter.initializing': 'Getting models ready…',
  'chatStarter.noProvider': 'Add a provider to start chatting',
  'chatStarter.noSelection': 'Choose a model for this conversation',
  'chatStarter.noModels': 'No models available',
  'chatStarter.addProvider': 'Add provider',
  'chatStarter.chooseModel': 'Choose model',
  'chatStarter.manageModels': 'Manage models',
  'chatStarter.workspaceFiles': 'Pick workspace files',
  'chatStarter.attach': 'Add attachment',
  'chatStarter.prompts': 'Use a prompt',
  'toolApproval.title': 'Tool approvals',
  'toolApproval.scope':
    'Choose when Chatless must ask before running tools in this conversation.',
  'toolApproval.defaultMode': 'Follow settings',
  'toolApproval.defaultDetails':
    'Already allowed actions run immediately. When approval is required, Chatless waits for you to confirm.',
  'toolApproval.automaticMode': 'Automatic approval',
  'toolApproval.automaticDetails':
    'Chatless can run commands, read knowledge bases, or call enabled external tools (MCP) without asking each time.',
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
    'Selecting a file inserts its path without giving Chatless access to it.',
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
  'chatSidebar.emptyWorkspace': 'No conversations yet',
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
