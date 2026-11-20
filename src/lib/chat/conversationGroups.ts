import type { Conversation } from '@/types/chat';

export type ConversationGrouping = 'time' | 'workspace';
export type ConversationGroup =
  | {
      kind: 'time';
      id: 'today' | 'yesterday' | 'last7Days' | 'last30Days' | 'older';
    }
  | { kind: 'workspace'; id: string; path: string | null };

export type ConversationSidebarRow =
  | { kind: 'heading'; key: string; group: ConversationGroup }
  | { kind: 'conversation'; key: string; conversation: Conversation };

export function workspacePath(value?: string | null): string | null {
  const path = value?.trim().replace(/\\/g, '/');
  if (!path) return null;
  const driveRoot = /^([A-Za-z]):\/+$/i.exec(path);
  if (driveRoot) return `${driveRoot[1].toUpperCase()}:/`;
  return path.replace(/\/+$/, '') || '/';
}

export function conversationSidebarRows(
  conversations: readonly Conversation[],
  grouping: ConversationGrouping,
  mountedDirectories: Readonly<Record<string, string | undefined>>,
  now = new Date(),
  openedWorkspaces?: readonly string[],
  collapsedWorkspaces?: ReadonlySet<string | null>,
): ConversationSidebarRow[] {
  const previousDay = (days: number) =>
    new Date(now.getFullYear(), now.getMonth(), now.getDate() - days).getTime();
  const today = previousDay(0);
  const yesterday = previousDay(1);
  const last7Days = previousDay(6);
  const last30Days = previousDay(29);
  const groups = new Map<
    string,
    { group: ConversationGroup; items: Conversation[] }
  >();

  for (const conversation of [...conversations].sort(
    (a, b) => b.updated_at - a.updated_at,
  )) {
    let group: ConversationGroup;
    if (grouping === 'workspace') {
      const path = workspacePath(mountedDirectories[conversation.id]);
      // Use the full mounted path, never the basename or the generated session folder.
      group = {
        kind: 'workspace',
        id: path === null ? 'default' : `path:${path}`,
        path,
      };
    } else {
      const time = conversation.updated_at;
      group = {
        kind: 'time',
        id:
          time >= today
            ? 'today'
            : time >= yesterday
              ? 'yesterday'
              : time >= last7Days
                ? 'last7Days'
                : time >= last30Days
                  ? 'last30Days'
                  : 'older',
      };
    }
    const key = `${group.kind}:${group.id}`;
    const existing = groups.get(key);
    if (existing) existing.items.push(conversation);
    else groups.set(key, { group, items: [conversation] });
  }

  if (grouping === 'workspace' && openedWorkspaces) {
    const ordered = new Map<
      string,
      { group: ConversationGroup; items: Conversation[] }
    >();
    for (const path of openedWorkspaces
      .map(workspacePath)
      .filter((path) => path !== null)) {
      const id = path === null ? 'default' : `path:${path}`;
      const key = `workspace:${id}`;
      ordered.set(
        key,
        groups.get(key) ?? {
          group: { kind: 'workspace', id, path },
          items: [],
        },
      );
    }
    const defaultKey = 'workspace:default';
    for (const [key, group] of groups)
      if (key !== defaultKey && !ordered.has(key)) ordered.set(key, group);
    ordered.set(
      defaultKey,
      groups.get(defaultKey) ?? {
        group: { kind: 'workspace', id: 'default', path: null },
        items: [],
      },
    );
    groups.clear();
    for (const [key, group] of ordered) groups.set(key, group);
  }

  return [...groups].flatMap<ConversationSidebarRow>(
    ([key, { group, items }]) => [
      { kind: 'heading', key, group },
      ...(group.kind === 'workspace' && collapsedWorkspaces?.has(group.path)
        ? []
        : items
      ).map((conversation) => ({
        kind: 'conversation' as const,
        key: `conversation:${conversation.id}`,
        conversation,
      })),
    ],
  );
}

export function workspaceGroupName(path: string): string {
  return path.split('/').filter(Boolean).at(-1) || path;
}

export function workspaceGroupParent(path: string): string {
  return path
    .replace(/\/$/, '')
    .slice(0, path.replace(/\/$/, '').lastIndexOf('/') + 1);
}
