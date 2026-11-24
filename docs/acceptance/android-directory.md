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

## A folder of thousands (#212 follow-up)

A folder is a tree and can hold five thousand files, so reading it has three shapes and each one is
checked separately. The case these guard: a model given one flat listing of a big folder answers
from whatever the walk happened to reach, and says "没有子目录" about a folder full of them.

- `inventory` walks with the filters applied *during* the walk, returns a page (`limit`, `offset`)
  and `totals` saying how far it got. On an emulator folder of 1,982 files, asking for files over
  3 KiB answered 410 - the same number a local `find` over the same files gives, where the old
  post-cap filter could only see the first 200 rows.
- Every entry carries a `path` under its folder, and `under` reads one subfolder by name path or
  handle; a wrong name answers with the subfolders that exist.
- `summarize` walks the whole folder and returns counts: 1,989 files / 3.69 MB / 8 subfolders, and
  a per-kind table whose every number matched a local recount. It answers "what kinds of files are
  in here" in one call instead of paging for a minute.
- `export` writes a listing into 下载 instead of reciting it into the chat. Exporting the same
  1,982 files produced a CSV whose rows matched the source exactly - 0 missing, 0 size mismatches,
  181 of them nested paths - with raw bytes and ISO dates for a spreadsheet to read.
- A walk that stopped says so: `totals.stopped` and a hint pointing at `offset`, `under` or
  `summarize`, so a partial page is never read as the whole folder.

## Reading and writing files (#212 follow-up)

Reading a listing is not the job; the user wants a file read and a note written. Two tools do that,
and both address files by the `path` names a listing shows - a device path is not what the folder
grant means.

- `read_file` returns text with an offset and `nextOffset`, so a long file can be read in parts.
  A photo answers `NOT_TEXT` instead of a page of noise; a path that matches nothing says how to
  find it (`NO_SUCH_FILE`).
- `write_file` has `create` / `overwrite` / `append`, creates missing folders on the way, and never
  replaces a file silently: `create` on an existing name answers `EXISTS` and the model asks first.
  Text is capped at 500k characters, because a write is the model typing, not the tool copying.
- Writing needs a write grant, which Android only hands over when the person picks the folder again.
  New picks ask for read and write together; a folder authorized before this answers
  `FOLDER_IS_READ_ONLY`, and the attachment sheet offers 已授权文件夹 → 开启写入 to fix it.
- `read_file` and `read`/`inventory`/`summarize` are read-only to the policy; `write_file` and
  `export` create and are gated by the approval mode.

Emulator, `Qwen3.8-Flash-Next`, `Download/整理测试`:

- 说明.txt read back whole (13 bytes), card titled 读取文件内容 · 说明.txt.
- First write attempt on a read-only folder: `FOLDER_IS_READ_ONLY`, and the model asked the user to
  turn writing on and offered the Downloads alternative instead of failing silently.
- Tapping 开启写入 reopened the picker inside that folder (USE THIS FOLDER → ALLOW); the row lost its
  只读 badge, and the same write then landed: `cat` on `/sdcard/Download/整理测试/测试笔记.md` shows
  exactly `写入测试`, and after an append `写入测试\n第二行`.
- `笔记/2026/周报.md` with create wrote both missing folders and the file, and `cat` confirms it.
  A second `create` answered `EXISTS` and left the file alone; `overwrite` replaced it in place with
  `created: false` and no duplicate folder. An early build created `2026 (1)` beside `2026`: the path
  walker handed the previous level to the next child query, so nested lookups missed and a write
  created a fresh folder; the walker now hands the folder it just matched.

### Renaming and sorting files (`a83c89f`)

Writing a file is half of organising; the other half is that `IMG_20240101_混乱文件1.txt` stops
being called that. `rename` takes a new name, `move` takes a destination folder path inside the same
authorized folder and creates missing folders on the way. Both need the write grant, both refuse a
name that is already taken (`EXISTS`) rather than displacing it, and neither is read-only to the
policy, so plan mode holds them back.

- Rename `测试笔记.md` → `周记.md`: on disk after the call, and a rename onto a taken name
  (`笔记/2026/周报.md` → `周记.md`, where `周记.md` already lived there) answered `EXISTS` and left
  both files alone - the model then listed the ways out instead of guessing.
- Move `周记.md` → `笔记/2026/周记.md`, then `说明.txt` → `归档/11月/说明.txt`: `归档` and
  `归档/11月` did not exist and were created; `ls` shows the file in the new place and gone from the
  old one.
