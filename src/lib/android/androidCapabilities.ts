/**
 * The Android capabilities this build can offer, and what each one needs.
 *
 * A single table answers both questions the tool surface asks: which tools the chat
 * advertises to the model, and which calls the approval gate recognises. Both iterate
 * this list, so a capability cannot be advertised without also being allowed, or the
 * reverse - adding one is this list plus its probe, nothing else.
 */
import { hasAndroidPhotoBatchSelection } from '@/lib/android/androidPhotoBatch';
import { hasAndroidAuthorizedFolders } from '@/lib/documents/android/androidAuthorizedRoots';
import { hasAndroidDocumentAttachment } from '@/lib/documents/android/androidDocumentAttachment';
import type { McpTool } from '@/lib/mcp/McpClient';
import {
  ANDROID_COUNTDOWN_SERVER,
  ANDROID_COUNTDOWN_TOOL,
  isAndroidCountdownTool,
} from '@/lib/mcp/nativeTools/androidCountdown';
import {
  ANDROID_DIRECTORY_SERVER,
  ANDROID_DIRECTORY_TOOL,
  isAndroidDirectoryTool,
} from '@/lib/mcp/nativeTools/androidDirectory';
import {
  ANDROID_DOCUMENT_SERVER,
  ANDROID_DOCUMENT_TOOLS,
  isAndroidDocumentTool,
} from '@/lib/mcp/nativeTools/androidDocument';
import {
  ANDROID_PHOTOS_SERVER,
  ANDROID_PHOTOS_TOOL,
  isAndroidPhotosTool,
} from '@/lib/mcp/nativeTools/androidPhotos';
import { isAndroidTauri } from '@/lib/utils/runtimePlatform';

export type AndroidCapabilityId =
  | 'countdown'
  | 'document'
  | 'directory'
  | 'photos';

/** Which capabilities are on. One object instead of one boolean per capability. */
export type AndroidCapabilities = Record<AndroidCapabilityId, boolean>;

export type AndroidToolSpec = { server: string; tool: McpTool };

type AndroidCapability = {
  id: AndroidCapabilityId;
  server: string;
  tools: McpTool[];
  /** The name rule the adapter also uses, so a call is recognised exactly where it runs. */
  matches: (server: string, tool: string) => boolean;
  /** Whether this chat holds the state the capability needs. */
  present: (conversationId?: string) => boolean | Promise<boolean>;
};

export const ANDROID_CAPABILITIES: readonly AndroidCapability[] = [
  {
    // The clock handoff needs no chat state: it is offered wherever the platform is.
    id: 'countdown',
    server: ANDROID_COUNTDOWN_SERVER,
    tools: [ANDROID_COUNTDOWN_TOOL],
    matches: isAndroidCountdownTool,
    present: () => isAndroidTauri(),
  },
  {
    id: 'document',
    server: ANDROID_DOCUMENT_SERVER,
    tools: ANDROID_DOCUMENT_TOOLS,
    matches: isAndroidDocumentTool,
    present: hasAndroidDocumentAttachment,
  },
  {
    id: 'directory',
    server: ANDROID_DIRECTORY_SERVER,
    tools: [ANDROID_DIRECTORY_TOOL],
    matches: isAndroidDirectoryTool,
    // Authorized folders belong to the app, not to one chat: a folder the user authorized once
    // is readable from any conversation unless they switched it off (#228).
    present: () => hasAndroidAuthorizedFolders(),
  },
  {
    id: 'photos',
    server: ANDROID_PHOTOS_SERVER,
    tools: [ANDROID_PHOTOS_TOOL],
    matches: isAndroidPhotosTool,
    present: hasAndroidPhotoBatchSelection,
  },
];

function everyCapability(value: boolean): AndroidCapabilities {
  return Object.fromEntries(
    ANDROID_CAPABILITIES.map(({ id }) => [id, value]),
  ) as AndroidCapabilities;
}

/** Desktop, iOS, or an Android chat that holds no document, folder or photo batch. */
export const NO_ANDROID_CAPABILITIES: AndroidCapabilities =
  everyCapability(false);

/** What the current chat holds. The advertised list and the catalog both read this. */
export async function androidCapabilities(
  conversationId?: string,
): Promise<AndroidCapabilities> {
  const entries = await Promise.all(
    ANDROID_CAPABILITIES.map(
      async ({ id, present }) =>
        [id, Boolean(await present(conversationId))] as const,
    ),
  );
  return Object.fromEntries(entries) as AndroidCapabilities;
}

/**
 * Everything the platform offers, ignoring what the current chat holds.
 *
 * The approval gate asks this one rather than `androidCapabilities` on purpose: a call
 * outside the chat's scope is refused by the executor with a specific error
 * (`DOCUMENT_UNAVAILABLE`, `PHOTOS_NOT_SELECTED`, ...) after it has looked, so a tool
 * the model was never offered must not first become an approval card the user cannot
 * act on.
 */
export function androidPlatformCapabilities(): AndroidCapabilities {
  return everyCapability(isAndroidTauri());
}

/** The tools of the capabilities that are on. */
export function androidTools(
  capabilities: AndroidCapabilities,
): AndroidToolSpec[] {
  return ANDROID_CAPABILITIES.filter(({ id }) => capabilities[id]).flatMap(
    ({ server, tools }) => tools.map((tool) => ({ server, tool })),
  );
}

/** Whether a call belongs to one of the capabilities that are on. */
export function androidAllowsCall(
  capabilities: AndroidCapabilities,
  server: string,
  tool: string,
): boolean {
  return ANDROID_CAPABILITIES.some(
    ({ id, matches }) => capabilities[id] && matches(server, tool),
  );
}
