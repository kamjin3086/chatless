export type AndroidPhotoSource = 'capture' | 'pick';
export type AndroidPhoto = { dataUrl: string };

type NativePhotoOutcome =
  | { status: 'selected'; jpegBase64: string }
  | {
      status: 'cancelled' | 'unavailable' | 'unreadable' | 'too_large' | 'busy';
    };

type AndroidPhotoOutcome =
  | { status: 'selected'; photo: AndroidPhoto }
  | { status: Exclude<NativePhotoOutcome['status'], 'selected'> };

async function openAndroidPhotoSurface(
  source: AndroidPhotoSource,
): Promise<NativePhotoOutcome> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke('acquire_android_photo', { source });
}

export async function acquireAndroidPhoto(
  source: AndroidPhotoSource,
  openSurface = openAndroidPhotoSurface,
): Promise<AndroidPhotoOutcome> {
  try {
    const result = await openSurface(source);
    if (result.status !== 'selected') return result;
    if (result.jpegBase64) {
      return {
        status: 'selected',
        photo: { dataUrl: `data:image/jpeg;base64,${result.jpegBase64}` },
      };
    }
  } catch {
    // A rejected native invocation is a local read failure, not a cancellation.
  }
  return { status: 'unreadable' };
}
