"""Generate retained conflict/cancellation fixtures, separate from the 16-query corpus.

Usage: python3 scripts/e2e/fixtures/make-knowledge-lifecycle-corpus.py /outside/repo/lifecycle
Existing files are checked, never overwritten. Uses only the Python standard library.
"""
from pathlib import Path
import sys


def main():
    if len(sys.argv) != 2:
        raise SystemExit(__doc__)
    root = Path(sys.argv[1])
    files = {
        f"conflict-policy-{suffix}.txt": (
            f"HELIOS-CONFLICT-2481 inspection policy {suffix.upper()}\n"
            f"This active policy states an inspection interval of {days} days.\n"
            "No revision date or priority is provided.\n"
        )
        for suffix, days in [("a", 13), ("b", 29)]
    }
    files["semantic-cancel-stress.txt"] = (
        "CANCEL-STRESS-7710\n校验值：索引重试应保留完整源文。\n"
        + "\n背景记录：此段用于真实模型的取消和恢复验收，包含 Unicode 表情🪐，不代表额外政策；所有向量均由当前真实嵌入模型计算。" * 1200
        + "\nEND-CANCEL-STRESS-7710\n"
    )
    for name, content in files.items():
        existing = root / name
        if existing.exists() and existing.read_text(encoding="utf-8") != content:
            raise SystemExit(f"Retained fixture differs: {existing}. Choose another directory.")
    root.mkdir(parents=True, exist_ok=True)
    for name, content in files.items():
        target = root / name
        if not target.exists():
            with target.open("x", encoding="utf-8") as output:
                output.write(content)
    print(f"Retained lifecycle fixtures: {root}")


if __name__ == "__main__":
    main()
