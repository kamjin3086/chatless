# Android folder organization acceptance (#219)

Use an ARM64 debug APK, a physical Android phone, and a tool-capable model. Record the build revision, Android and WebView versions, model, and the Documents provider tested. Picking uses Android's system folder chooser; supported roots depend on the OS and provider.

1. In chat A, open the attachment sheet and tap **Choose folder**. Press Back to cancel: no folder is selected and the directory tool is not offered. Pick a test folder containing nested folders, duplicate basenames, several file types, and files of differing sizes and modified dates. Keep a similarly named file in a sibling folder outside the selection. The composer shows the picked folder name as a chip and the attachment sheet carries the metadata-sharing notice. The act of picking, without sending a message, does not upload anything.
2. Ask chat A for a read-only organization proposal. Try requests such as “Group images by date and suggest an archive folder for each group” and “Group files at least 1 MiB by size and suggest which ones to review first.” Check file names and proposed destinations against the fixture, including identical names in different subfolders. Only the picked tree appears. There is no extra approval prompt for scoped inventory, and model-visible results contain opaque references, not Android paths, document IDs or content URIs. The proposal should name affected items, state omissions or limits, and clearly say nothing was changed. Compare the test folder before and after.
3. Try an unavailable child folder on a provider that supports this, or a folder with more than 200 provider rows. Check that unreadable branches or traversal limits appear in the chat proposal, not as a complete inventory. Unknown sizes/dates must not be presented as known values. Inventory is metadata-only; it does not prove file contents are readable.
4. Open chat B. With no folder of its own it attaches the last authorized one - see *Cross-conversation authorization* below - so its chip shows that folder and the directory tool is offered, while a conversation that detached one stays detached. A conversation must never see a folder the user never authorized at all. Attempt to use an absolute path or the earlier opaque handle as an input; it must not acquire scope. Return to A after relaunching the app to check that the retained read grant is still usable. Start **Choose folder** again and cancel; A's previous selection remains. Select a different folder and verify the inventory and item handles change.
5. Invalidate the selected grant (for example, remove the test folder via Android Files, disconnect the provider, or revoke its persisted grant on a test device). Return to chat and check the access-lost indication. The stale selection must not permit inventory or silently fall back to a broader root. Use **Choose folder** to pick it again without losing the conversation. Use **Forget folder** (in the attachment sheet) to clear it and confirm it stays cleared after relaunch. If A and B explicitly select the same URI, forgetting it in A must not revoke B's independent selection.
6. Repeat Back/cancel with the document and photo pickers, if present in this build, to check they do not capture the directory picker's result. Check a long folder name and enlarged text with the keyboard open. Desktop and iOS must not expose this Android directory tool or picker.

## Cross-conversation authorization

The grant Android hands back for a picked tree is app-wide and survives a new conversation and a
reboot, so a folder the user authorized once stays authorized. Chatless now reflects that: the
last authorized folder is attached to a conversation that has none of its own, and detaching one
only takes it away from that conversation - it never releases the system grant. Releasing happens
when a conversation switches to a different folder, and when the retained list passes eight trees.

To walk it on a device:

- Pick 下载 in a conversation: the chip shows 文件夹：Download.
- Create a new conversation and open the composer: the same chip is there without the picker.
- Send a question about the folder from that new conversation: the model reads it directly.
- Detach it in that conversation: the chip goes away, and stays away when the conversation is
  reopened. A different new conversation still gets it back.
- Revoke the grant in 系统设置 → 应用 → 权限: the chip reports 需重新授权 rather than failing mid-call.
- Pick a second folder in the same conversation, then create a new conversation: the newest one is
  what a fresh conversation attaches.

The registry with its own 已授权文件夹 surface (per-folder Agent switch, explicit revoke) is #227;
reading several folders in one call is #228.
