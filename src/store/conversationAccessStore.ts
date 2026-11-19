import { create } from 'zustand';
import { isPathWithinDirectory } from '@/lib/filesystemAllowlist/allowlist';
import { isShellServer, normalizeServerName } from '@/lib/mcp/toolNaming';

export type FileOperation = 'read' | 'write' | 'create' | 'delete';
type AccessLevel = 'ask' | 'unrestricted';
export type DirectoryGrant = {
  path: string;
  operations: FileOperation[];
  recursive: boolean;
};
export interface ConversationAccess {
  automatic: boolean;
  tools: string[];
  directories: DirectoryGrant[];
  levels: Partial<Record<'fs' | 'shell', AccessLevel>>;
}
const empty = (): ConversationAccess => ({
  automatic: false,
  tools: [],
  directories: [],
  levels: {},
});

/** Native Knowledge read grants do not cover any future mutating tools. */
export function conversationToolKey(server: string, tool: string): string {
  const name = normalizeServerName(server);
  if (name === 'knowledge' && ['list', 'search', 'read'].includes(tool))
    return 'knowledge:read';
  if (isShellServer(name)) return 'shell';
  return JSON.stringify([name, tool]);
}

interface State {
  conversations: Record<string, ConversationAccess>;
  revisions: Record<string, number>;
  setAutomatic: (id: string, value: boolean) => void;
  grantTool: (id: string, key: string, revision?: number) => void;
  grantDirectory: (
    id: string,
    grant: DirectoryGrant,
    revision?: number,
  ) => void;
  setLevel: (id: string, scope: 'fs' | 'shell', level?: AccessLevel) => void;
  revoke: (id: string) => void;
}

export const useConversationAccessStore = create<State>((set, get) => {
  const update = (
    id: string,
    change: (value: ConversationAccess) => ConversationAccess,
  ) => {
    if (!id.trim()) return;
    set((state) => ({
      conversations: {
        ...state.conversations,
        [id]: change(state.conversations[id] || empty()),
      },
    }));
  };
  return {
    conversations: {},
    revisions: {},
    setAutomatic: (id, value) =>
      update(id, (current) => ({ ...current, automatic: value })),
    grantTool: (id, key, revision) => {
      if (revision !== undefined && revision !== (get().revisions[id] || 0))
        return;
      update(id, (current) => ({
        ...current,
        tools: [...new Set([...current.tools, key])],
      }));
    },
    grantDirectory: (id, grant, revision) => {
      if (revision !== undefined && revision !== (get().revisions[id] || 0))
        return;
      update(id, (current) => ({
        ...current,
        directories: [...current.directories, grant],
      }));
    },
    setLevel: (id, scope, level) =>
      update(id, (current) => {
        const levels = { ...current.levels };
        if (level) levels[scope] = level;
        else delete levels[scope];
        return { ...current, levels };
      }),
    revoke: (id) =>
      set((state) => {
        const conversations = { ...state.conversations };
        delete conversations[id];
        return {
          conversations,
          revisions: {
            ...state.revisions,
            [id]: (state.revisions[id] || 0) + 1,
          },
        };
      }),
  };
});

export function hasConversationToolGrant(
  id: string,
  server: string,
  tool: string,
): boolean {
  return !!useConversationAccessStore
    .getState()
    .conversations[id]?.tools.includes(conversationToolKey(server, tool));
}
export function isConversationAutomatic(id: string): boolean {
  return (
    useConversationAccessStore.getState().conversations[id]?.automatic === true
  );
}
export function getConversationDirectoryGrant(
  id: string,
  path: string,
  op: FileOperation,
): DirectoryGrant | undefined {
  if (
    path
      .replace(/\\/g, '/')
      .split('/')
      .some((part) => part === '.' || part === '..')
  )
    return undefined;
  return useConversationAccessStore
    .getState()
    .conversations[id]?.directories.find(
      (grant) =>
        grant.operations.includes(op) &&
        (grant.recursive
          ? isPathWithinDirectory({
              absolutePath: path,
              directoryPath: grant.path,
            })
          : isPathWithinDirectory({
              absolutePath: path,
              directoryPath: grant.path,
            }) &&
            isPathWithinDirectory({
              absolutePath: grant.path,
              directoryPath: path,
            })),
    );
}
