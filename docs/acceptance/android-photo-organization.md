# Android photo organization acceptance (#218)

Use an ARM64 debug APK, a physical Android phone, and a tool-capable model. Record the build
revision, Android and WebView versions, model, whether the system photo picker or the AndroidX
fallback opened, and the fixtures used. Fake-native tests do not cover the picker or the device.

1. In chat A, open the attachment sheet and tap **Organize photos**, then press Back. No batch is
   selected, the chat states it, and the `android_photos` tool is not offered. Pick a test batch containing two byte-identical copies
   under different names, a screenshot, ordinary camera photos, and one photo you can make
   unreadable (for example an unsupported or removed file). The composer shows the selected count as
   a chip and the attachment sheet carries the metadata-sharing notice. Picking alone, without a
   message, makes no model request.
2. Ask chat A for a read-only organization proposal. Try requests such as “Which of these are
   duplicates, and can I delete all but one?” and “Group the screenshots and suggest an album.”
   Only the picked batch may appear, and only items whose bytes are identical may be called
   duplicates. Photos that match no signal must be listed as ungrouped. Ask again in the same chat:
   no second picker interaction and no new approval prompt. The result must contain names and
   opaque handles only — no content URI, no Android path, no photo data — and the proposal must say
   that nothing was moved, renamed or deleted. Compare the device gallery before and after.
3. Check the honest edges: a resized copy next to its original is not identical and must not be
   grouped as a duplicate; a screenshot with a localized file name should still be recognised; a
   photo too large to compare must be reported as “duplicate check skipped”, not guessed; selecting
   more than 20 photos must be impossible or truncated with the limit stated. Unreadable photos must
   appear as omissions, never as a complete grouping.
4. Open chat B. It must not see A's batch, its count, or the photo tool. Attempt to use an absolute
   path, a `content://` URI, or A's opaque handle as the tool input; the call must be refused
   before any local read. Return to A and confirm the batch is still usable.
5. Force-stop and relaunch Chatless. A no longer reports a selection and the tool is not offered
   until photos are chosen again; the app keeps no photo grant across restarts. Reselect and cancel
   the picker: the earlier batch remains. Use **Forget photos** in the attachment sheet and confirm
   the chip disappears and the tool stops being offered.
6. Interleave the pickers: start the single-photo **Choose a photo**, the **Attach document** picker
   and **Choose folder**, cancelling each in turn, then select a photo batch. No picker may receive
   another picker's result. Single-photo Q&A must be unchanged: preview, recipient, unsupported
   model warning, send and remove still work and do not share state with the batch.
7. Check touch targets and contrast in light/dark mode with larger text and the keyboard open. A
   text-only model or a run without the photo batch must show no `android_photos` tool; desktop and
   iOS must expose neither the picker nor the tool.

## Compatibility and reuse

- The batch reuses the Android photo picker, AndroidX `PickMultipleVisualMedia`, with its own
  activity-result key so the single-photo, document and directory pickers cannot capture its
  result. One picker interaction selects the batch; there is no full-library scan and no `READ_MEDIA_*`
  permission.
- Content is read once, at selection time, only for the chosen URIs, bounded by the same 32 MiB
  source ceiling as the single-photo import. A SHA-256 digest of those bytes is the only duplicate
  signal and stays inside the app; the model receives names, sizes, group membership and omissions.
  Screenshot grouping is a file-name signal only and is reported as such.
- The selection lives in app memory under the conversation id, with opaque task-scoped handles and
  no retained URI or persisted grant; force-stop ends it. The tool exposes no mutating operation,
  and no photo is uploaded by selection, preview or grouping.
- Results are bounded: at most 20 photos per selection, one duplicate group per set of identical
  bytes plus one screenshot group, and every ungrouped photo, unreadable photo and uncompared photo
  named in the result.
