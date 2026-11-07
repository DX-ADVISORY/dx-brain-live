"""Re-apply the public status hook without rewriting snapshot data."""

from __future__ import annotations

import argparse
from pathlib import Path

from ops.safety import SafetyError, apply_public_ui_hook, public_diff_is_safe


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Insert the cloud status hook into index.html.")
    parser.add_argument("--repo", default=".")
    args = parser.parse_args(argv)
    path = Path(args.repo) / "index.html"
    before = path.read_text(encoding="utf-8")
    try:
        after = apply_public_ui_hook(before)
    except SafetyError as exc:
        print(f"HOOK_REJECTED code={exc.code}")
        return 2
    if not public_diff_is_safe(before, after):
        print("HOOK_UNSAFE")
        return 2
    if after != before:
        path.write_text(after, encoding="utf-8")
        print("HOOK_UPDATED")
    else:
        print("HOOK_UNCHANGED")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
