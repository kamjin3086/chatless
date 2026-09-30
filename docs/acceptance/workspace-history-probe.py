"""Real Rust command probes for the workspace and file-history work.

Build the bridge first, then pass its path:

    cargo build --example cmd_bridge --manifest-path src-tauri/Cargo.toml
    python docs/acceptance/workspace-history-probe.py src-tauri/target/debug/examples/cmd_bridge.exe

Everything runs against a fresh temporary data directory and the production
command functions; no user files, no Tauri IPC, no desktop clicks.
"""
import json
from pathlib import Path
import subprocess
import sys
import tempfile


def run_bridge(bridge, data_dir, requests):
    """Send one JSON request per line and return the decoded replies."""
    payloads = "\n".join(
        json.dumps({"id": index, "command": command, "args": {"payload": payload}})
        for index, (command, payload) in enumerate(requests)
    ) + "\n"
    result = subprocess.run(
        [str(bridge), str(data_dir)], input=payloads, text=True,
        encoding="utf-8", capture_output=True, timeout=60, check=True,
    )
    replies = [json.loads(line) for line in result.stdout.splitlines() if line.startswith("{")]
    assert len(replies) == len(requests), f"bridge returned {len(replies)} of {len(requests)} replies"
    return replies


def grant(path, run_id, call_id, write=True, read=True, create=True):
    return {
        "run_id": run_id, "call_id": call_id, "path": str(path),
        "read": read, "write": write, "create": create,
    }


def history_case(bridge, backup_failure=False):
    """Overwrite protection, and the grant the history UI relies on."""
    with tempfile.TemporaryDirectory(prefix="chatless-history-probe-") as folder:
        root = Path(folder).resolve()
        data = root / "data"
        work = root / "work"
        data.mkdir()
        work.mkdir()
        if backup_failure:
            # A regular file where the history directory belongs blocks backups.
            (data / "file-history").write_text("blocked", encoding="utf-8")
        target = work / "output.txt"

        replies = run_bridge(bridge, data, [
            ("filesystem_grant_call_scope", grant(work, "audit", "w")),
            ("filesystem_write_file", {"path": str(target), "content": "version one"}),
            ("filesystem_write_file", {"path": str(target), "content": "version two"}),
            ("filesystem_revoke_call_scope", {"run_id": "audit", "call_id": "w"}),
            # No grant for this path any more: the backend must refuse.
            ("filesystem_file_history", {"path": str(target)}),
            # This is what the history button does: one grant, used immediately.
            ("filesystem_grant_call_scope", grant(target, "ui-history:1", "h", write=False, create=False)),
            ("filesystem_file_history", {"path": str(target)}),
        ])

        overwrite = replies[2].get("result", {})
        history_without_grant = replies[4]
        history_with_grant = replies[6]
        versions = history_with_grant.get("result", {}).get("versions", [])
        # Sample the file before any restore, so "was the original kept?" is
        # answered by the overwrite itself and not by a later undo.
        content_after_overwrite = target.read_bytes()

        restored = None
        if versions:
            version_id = versions[0]["id"]
            restore_replies = run_bridge(bridge, data, [
                ("filesystem_grant_call_scope", grant(target, "ui-restore:1", "r")),
                ("filesystem_restore_file_version", {"path": str(target), "version_id": version_id}),
            ])
            restored = {
                "ok": "result" in restore_replies[1],
                "bytes": target.read_bytes().hex(),
            }

        return {
            "backupFailureInjected": backup_failure,
            "overwriteReportedSuccess": overwrite.get("ok"),
            "historyVersionRecorded": bool(overwrite.get("history_id")),
            "contentAfterOverwrite": content_after_overwrite.decode("utf-8", "replace"),
            "originalStillPresent": content_after_overwrite == b"version one",
            "historyWithoutGrantRefused": "error" in history_without_grant,
            "historyWithOneShotGrant": "result" in history_with_grant,
            "historyVersions": len(versions),
            "restore": restored,
        }


def workspace_case(bridge):
    """Identity, export counting and recycle-bin cleanup through the real commands."""
    with tempfile.TemporaryDirectory(prefix="chatless-workspace-probe-") as folder:
        root = Path(folder).resolve()
        data = root / "data"
        export_dir = root / "export"
        data.mkdir()
        export_dir.mkdir()

        # A chat-only conversation must not leave anything in the documents folder,
        # and a title change must not move the path it will eventually use.
        lazy = run_bridge(bridge, data, [
            ("workspace_ensure", {"conversation_id": "conv-lazy", "title": "Chat only"}),
            ("workspace_ensure", {"conversation_id": "conv-lazy", "title": "Renamed"}),
        ])
        lazy_first, lazy_second = lazy[0]["result"], lazy[1]["result"]
        empty_export = run_bridge(bridge, data, [
            ("workspace_export", {"conversation_id": "conv-lazy", "destination_dir": str(export_dir)}),
        ])[0].get("result", {})
        chat_only = {
            "exists": lazy_first["exists"],
            "folderAbsent": not Path(lazy_first["root"]).exists(),
            "documentsFolderAbsent": not (data / "documents").exists(),
            "samePathAfterRename": lazy_first["root"] == lazy_second["root"],
            "exportOfUnusedWorkspaceIsEmpty": empty_export.get("source_missing") is True
                                              and empty_export.get("files") == 0,
        }

        # A conversation that really works gets its folder on first use.
        replies = run_bridge(bridge, data, [
            ("workspace_ensure", {"conversation_id": "conv-probe", "title": "Probe", "materialize": True}),
        ])
        first = replies[0]["result"]
        source = Path(first["root"])
        (source / "src").mkdir(parents=True, exist_ok=True)
        (source / "index.html").write_text("hello", encoding="utf-8")
        (source / "src" / "app.js").write_text("console.log(1)", encoding="utf-8")

        replies = run_bridge(bridge, data, [
            ("workspace_ensure", {"conversation_id": "conv-probe", "title": "A different title", "materialize": True}),
            ("workspace_export", {"conversation_id": "conv-probe", "destination_dir": str(export_dir)}),
            ("workspace_export", {"conversation_id": "conv-probe", "destination_dir": str(source / "nested")}),
            ("workspace_trash", {"conversation_id": "conv-probe"}),
        ])
        second = replies[0]["result"]
        exported = replies[1].get("result", {})
        inside_refused = replies[2]
        trashed = replies[3].get("result", {})
        folder_gone_after_trash = not source.exists()

        # Asking again after a cleanup must land on the same path, not a new one.
        recreated = run_bridge(bridge, data, [
            ("workspace_ensure", {"conversation_id": "conv-probe", "title": "Probe", "materialize": True}),
        ])[0]["result"]

        return {
            "chatOnlyConversation": chat_only,
            "firstUseCreatesTheFolder": first["created"] is True and first["exists"] is True,
            "titleChangeKeepsTheSamePath": first["root"] == second["root"],
            # The bridge sees raw Rust field names; the renderer camel-cases them.
            "manifestCreated": Path(first["manifest_path"]).is_file(),
            "exportedFiles": exported.get("files"),
            "exportedNestedFileExists": bool(exported.get("destination"))
                                        and (Path(exported["destination"]) / "src" / "app.js").is_file(),
            "exportInsideSourceRefused": "error" in inside_refused,
            "exportRefusalCode": str(inside_refused.get("error", "")).split(":")[0],
            "trashMovedToRecycleBin": trashed.get("moved_to_trash"),
            "folderGoneAfterTrash": folder_gone_after_trash,
            "recreatedAtTheSamePath": recreated["root"] == first["root"],
        }


def main():
    bridge = Path(sys.argv[1]).resolve(strict=True)
    print(json.dumps({
        "history": history_case(bridge),
        "historyBackupFailure": history_case(bridge, backup_failure=True),
        "workspace": workspace_case(bridge),
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
