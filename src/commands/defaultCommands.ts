import { registerCommand } from './commandRegistry';
import { Home, MessageSquare, Database, History, Settings, MessageSquarePlus, Bookmark } from 'lucide-react';

// 引入设置相关命令注册（侧效果）
import './settingsCommands';

// simple navigation helper
function navigate(path: string) {
  window.location.href = path;
}

registerCommand({
  id: 'nav-home',
  titleI18n: 'command.home',
  section: 'navigation',
  hintI18n: 'command.homeHint',
  icon: Home,
  keywords: ['home', '首页', 'index', 'start', 'main'],
  action: () => navigate('/'),
});

registerCommand({
  id: 'nav-chat',
  titleI18n: 'command.chat',
  section: 'navigation',
  hintI18n: 'command.chatHint',
  icon: MessageSquare,
  keywords: ['聊天', 'chat', 'conversation', 'talk', 'messages'],
  action: () => navigate('/chat'),
});

registerCommand({
  id: 'nav-knowledge',
  titleI18n: 'command.knowledge',
  section: 'navigation',
  hintI18n: 'command.knowledgeHint',
  icon: Database,
  keywords: ['知识库', 'knowledge', 'docs', 'library', 'kb'],
  action: () => navigate('/knowledge'),
});

registerCommand({
  id: 'nav-history',
  titleI18n: 'command.history',
  section: 'navigation',
  hintI18n: 'command.historyHint',
  icon: History,
  keywords: ['历史', 'history', 'recent', 'log', 'timeline'],
  action: () => navigate('/history'),
});

registerCommand({
  id: 'nav-settings',
  titleI18n: 'command.settings',
  section: 'navigation',
  hintI18n: 'command.settingsHint',
  icon: Settings,
  keywords: ['设置', 'settings', 'prefs', 'preferences', 'config'],
  action: () => navigate('/settings'),
});

registerCommand({
  id: 'nav-prompts',
  titleI18n: 'command.prompts',
  section: 'navigation',
  hintI18n: 'command.promptsHint',
  icon: Bookmark,
  keywords: ['提示词', 'prompts', 'prompt', '模板', '库', '书签'],
  action: () => navigate('/prompts'),
});

// new chat command
registerCommand({
  id: 'chat-new',
  titleI18n: 'command.newChat',
  section: 'action',
  hintI18n: 'command.newChatHint',
  icon: MessageSquarePlus,
  keywords: ['新建', '对话', 'chat', 'create', 'new', 'conversation', 'add'],
  action: async () => {
    const { useChatStore } = await import('@/store/chatStore');
    const create = useChatStore.getState().createConversation;
    const { NEW_CONVERSATION_TITLE } = await import('@/lib/chat/TitleGenerator');
    await create(NEW_CONVERSATION_TITLE, 'default-model');
    navigate('/chat');
  },
}); 