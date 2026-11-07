"""Guards for the public snapshot page and for text this worker writes."""

from __future__ import annotations

import hashlib
import re

HOOK = (
    '<!-- dx-cloud-status-hook -->'
    '<script src="cloud-status.js" defer></script>'
)
LOG_OLD = "Nhật ký · tail -f brain.log"
LOG_NEW = "Nhật ký trong ảnh đã xuất"

_PRIVACY = (
    re.compile(r"D:\\"),
    re.compile(r"D:/"),
    re.compile(r"[A-Za-z]:\\"),
    re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----"),
    re.compile(r"(?i)\b(api[_-]?key|secret|password|token)\s*[:=]\s*\S+"),
    re.compile(r"sk-[A-Za-z0-9]{10,}"),
    re.compile(r"AKIA[0-9A-Z]{16}"),
    re.compile(r"xox[baprs]-"),
    re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}"),
)
_HOOK_RE = re.compile(re.escape(HOOK))


class SafetyError(Exception):
    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


def privacy_findings(text: str) -> list[str]:
    findings = []
    for pattern in _PRIVACY:
        if pattern.search(text):
            findings.append(pattern.pattern)
    return findings


def assert_public_text(text: str) -> None:
    findings = privacy_findings(text)
    if findings:
        raise SafetyError("privacy")


def logo_hashes(html: str) -> list[str]:
    found = re.findall(r"data:image/png;base64,[A-Za-z0-9+/=]+", html)
    return [hashlib.sha256(item.encode("ascii")).hexdigest() for item in found]


def three_hash(html: str) -> str:
    marker = "Copyright 2010-2023 Three.js Authors"
    start = html.find(marker)
    if start < 0:
        return ""
    end = html.find("</script>", start)
    if end < 0:
        return ""
    return hashlib.sha256(html[start:end].encode("utf-8")).hexdigest()


def header_line(html: str) -> str:
    for line in html.splitlines():
        if line.startswith("<header>"):
            return line
    return ""


def apply_public_ui_hook(html: str) -> str:
    """Insert the status script and rename the replayed log heading.

    The header line carries both HopNhat logos and is left untouched.
    The pill label is corrected at runtime by cloud-status.js.
    """
    if html.count("</body>") != 1:
        raise SafetyError("body_close")
    if html.count(HOOK) > 1:
        raise SafetyError("hook_repeated")
    if HOOK not in html:
        html = html.replace("</body>", HOOK + "</body>", 1)
    if (
        html.count(LOG_OLD) > 1
        or html.count(LOG_NEW) > 1
        or (LOG_OLD in html and LOG_NEW in html)
    ):
        raise SafetyError("log_label")
    if LOG_OLD in html:
        html = html.replace(LOG_OLD, LOG_NEW, 1)
    return html


def _normalize(reference: str, html: str) -> str:
    html = _HOOK_RE.sub("", html, count=1)
    if LOG_OLD in reference and LOG_NEW in html:
        html = html.replace(LOG_NEW, LOG_OLD, 1)
    return html


def public_diff_is_safe(before: str, after: str) -> bool:
    """True when the only page edits are the status hook and log caption."""
    if header_line(before) != header_line(after):
        return False
    if logo_hashes(before) != logo_hashes(after):
        return False
    if three_hash(before) != three_hash(after):
        return False
    return _normalize(before, before) == _normalize(before, after)
