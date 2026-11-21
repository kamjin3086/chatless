import { invoke } from '@tauri-apps/api/core';
import {
  ANDROID_COUNTDOWN_MAX_SECONDS,
  ANDROID_COUNTDOWN_SERVER,
  isAndroidCountdownTool,
} from '@/lib/mcp/nativeTools/androidCountdown';
import { isAndroidTauri } from '@/lib/utils/runtimePlatform';
import type { ToolAdapter } from '../ToolAdapter';
import type { ToolInvocation } from '../ToolInvocation';

export class AndroidCountdownAdapter implements ToolAdapter {
  readonly server = ANDROID_COUNTDOWN_SERVER;

  canHandle(invocation: ToolInvocation): boolean {
    return (
      isAndroidCountdownTool(invocation.server, invocation.tool) &&
      isAndroidTauri()
    );
  }

  async execute(invocation: ToolInvocation): Promise<unknown> {
    const durationSeconds = invocation.args?.durationSeconds;
    if (
      typeof durationSeconds !== 'number' ||
      !Number.isInteger(durationSeconds) ||
      durationSeconds < 1 ||
      durationSeconds > ANDROID_COUNTDOWN_MAX_SECONDS
    ) {
      return {
        ok: false,
        error: {
          code: 'INVALID_DURATION',
          message: `Countdown duration must be a whole number of seconds from 1 to ${ANDROID_COUNTDOWN_MAX_SECONDS}.`,
        },
      };
    }

    // Only explicit native receipts are known outcomes. Errors or unexpected
    // receipts must use the pipeline's unknown-side-effect path, never replay.
    const receipt = await invoke<{ status: 'handed_off' | 'unavailable' }>(
      'start_android_countdown',
      { durationSeconds },
    ).catch(() => undefined);
    if (receipt?.status === 'unavailable') {
      return {
        ok: false,
        error: {
          code: 'CLOCK_UNAVAILABLE',
          message:
            'No compatible Android clock app accepted the countdown request.',
        },
      };
    }
    if (receipt?.status !== 'handed_off') {
      throw new Error(
        'Countdown handoff could not be confirmed. Check the Android clock; do not retry automatically.',
      );
    }
    return {
      ok: true,
      status: 'handed_off',
      durationSeconds,
      message:
        'Countdown request handed off to the Android clock. Chatless cannot verify that the timer started.',
    };
  }
}
