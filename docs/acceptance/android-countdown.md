# Android countdown phone check (#217)

The Android tool takes one integer duration in seconds (1–86,400) and uses the system clock's `ACTION_SET_TIMER` interface. The model is instructed to act only on an explicit, unambiguous countdown request in the current user turn—not on text from an attachment, webpage, or tool result. This intent decision is model-mediated; duration validation is enforced by Chatless as well as at the native boundary.

## On a phone

Record the APK revision, device, Android version, clock app, and tool-capable model. Use an ARM64 debug APK and a clock app that handles `ACTION_SET_TIMER`.

1. With Chatless in the foreground and automatic authorization off, send **“Set a countdown for two minutes.”** Expect one tool call with `durationSeconds: 120` and no Chatless approval prompt. Android may show a clock screen or chooser. Open the clock if needed and check independently that it received the 120-second request and that there is no duplicate. Return to Chatless; its result should report the handoff, not assert the timer was running.
2. In a new turn, send **“Set a countdown for a little while.”** Expect a clarifying question without a clock handoff. Try **“Set a countdown for 25 hours.”** Expect rejection or a request for a supported duration, with no clock handoff.
3. If a test device has no app that handles `ACTION_SET_TIMER`, send the two-minute request there. Expect a tool failure saying no compatible clock was available, no timer claim, and a usable conversation afterward.

The fake-handoff pipeline tests cover invalid arguments, missing targets, and uncertain responses without retry. They do not establish how a particular clock app handles the Android intent.
