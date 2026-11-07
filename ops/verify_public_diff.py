"""Fail if index.html changes anything except the status hook and log caption."""

from __future__ import annotations

import argparse
import subprocess
from pathlib import Path

from ops.safety import public_diff_is_safe


def head_index(repo: Path) -> str:
    try:
        return subprocess.run(
            ["git", "show", "HEAD:index.html"],
            cwd=repo,
            check=True,
            capture_output=True,
            text=True,
        ).stdout
    except subprocess.CalledProcessError as exc:
        raise SystemExit("CANNOT_READ_HEAD_INDEX") from exc


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Check index.html against HEAD.")
    parser.add_argument("--repo", default=".")
    args = parser.parse_args(argv)
    repo = Path(args.repo)
    before = head_index(repo)
    after = (repo / "index.html").read_text(encoding="utf-8")
    if not public_diff_is_safe(before, after):
        print("PUBLIC_DIFF_UNSAFE")
        return 2
    print("PUBLIC_DIFF_OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
