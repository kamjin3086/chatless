"""Line-protocol SQLite executor used by the acceptance harness.

Keeping one process per database means the TypeScript side can drive the
production query text against a real SQLite file without paying a process
spawn per query.

Protocol (one JSON object per line, in and out):
  {"sql": "...", "params": [...]}  ->  {"rows": [...], "ms": 0.42}
  {"op": "close"}                  ->  {"ok": true}
"""
import json
import sqlite3
import sys
import time


def main() -> None:
    # Windows defaults stdin/stdout to the ANSI code page, which mangles the
    # UTF-8 JSON the harness writes for Chinese queries.
    sys.stdin.reconfigure(encoding="utf-8")
    sys.stdout.reconfigure(encoding="utf-8")
    db = sqlite3.connect(sys.argv[1])
    db.row_factory = sqlite3.Row
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        request = json.loads(line)
        if request.get("op") == "close":
            print(json.dumps({"ok": True}), flush=True)
            return
        started = time.perf_counter()
        try:
            rows = [dict(row) for row in db.execute(request["sql"], request.get("params") or [])]
            elapsed = (time.perf_counter() - started) * 1000
            print(json.dumps({"rows": rows, "ms": elapsed}), flush=True)
        except Exception as error:  # surfaced to the harness instead of hanging
            print(json.dumps({"error": str(error)}), flush=True)


if __name__ == "__main__":
    main()
