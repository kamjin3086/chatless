import { inventoryAndroidPhotoBatch } from '@/lib/android/androidPhotoBatch';
import { groupAndroidPhotoBatch } from '@/lib/android/androidPhotoGrouping';
import {
  ANDROID_PHOTOS_SERVER,
  isAndroidPhotosTool,
} from '@/lib/mcp/nativeTools/androidPhotos';
import { isAndroidTauri } from '@/lib/utils/runtimePlatform';
import type { ToolAdapter } from '../ToolAdapter';
import type { ToolInvocation } from '../ToolInvocation';

function failure(code: string, message: string) {
  return { ok: false, error: { code, message } };
}

export class AndroidPhotosAdapter implements ToolAdapter {
  readonly server = ANDROID_PHOTOS_SERVER;

  canHandle(invocation: ToolInvocation): boolean {
    return (
      isAndroidTauri() &&
      isAndroidPhotosTool(invocation.server, invocation.tool)
    );
  }

  async execute(invocation: ToolInvocation): Promise<unknown> {
    if (Object.keys(invocation.args ?? {}).length > 0)
      return failure(
        'INVALID_ARGUMENT',
        'This tool takes no arguments. The photo batch comes from the current chat, not from paths, URIs or handles.',
      );
    const receipt = await inventoryAndroidPhotoBatch(
      invocation.conversationId,
    ).catch(() => undefined);
    if (receipt?.status === 'none')
      return failure(
        'PHOTOS_NOT_SELECTED',
        'Ask the user to choose photos in this chat.',
      );
    if (receipt?.status !== 'ready')
      return failure(
        'PHOTOS_UNAVAILABLE',
        'The selected photos could not be read. Ask the user to choose them again.',
      );
    return { ok: true, ...groupAndroidPhotoBatch(receipt) };
  }
}
