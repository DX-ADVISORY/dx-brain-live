"""Paste-in hook for the laptop publisher. This file is not installed on the laptop.

``Runtime/BrainMap_v5/publish_brain_v6r3.py`` is not in this repo. The nightly
job rewrites ``index.html``, which removes the cloud status hook until the
next GitHub run puts it back. Paste the function and the call below into that
script so the hook is already in the file the laptop commits.

Do not point this module at the laptop, and do not delete ``status/``,
``cloud-status.js``, ``ops/``, or ``.github/`` from the clone.
"""

from __future__ import annotations

HOOK = (
    "<!-- dx-cloud-status-hook -->"
    '<script src="cloud-status.js" defer></script>'
)
LOG_OLD = "Nhật ký · tail -f brain.log"
LOG_NEW = "Nhật ký trong ảnh đã xuất"


def keep_cloud_status_hook(html: str) -> str:
    """Return generated dashboard HTML with the public status hook kept."""
    if html.count("</body>") != 1:
        raise RuntimeError("expected one </body> before writing index.html")
    if html.count(HOOK) > 1:
        raise RuntimeError("cloud status hook is repeated")
    if HOOK not in html:
        html = html.replace("</body>", HOOK + "</body>", 1)
    if html.count(LOG_OLD) == 1 and LOG_NEW not in html:
        html = html.replace(LOG_OLD, LOG_NEW, 1)
    return html


# Minimal edit inside publish_brain_v6r3.py, after the HTML string exists
# and before it is written:
#
#   from laptop_publish_hook import keep_cloud_status_hook
#   html = keep_cloud_status_hook(html)
#   path.write_text(html, encoding="utf-8")
#
# In the dx-brain-live clone, before committing that file:
#
#   git pull --rebase origin main
#   git add -- index.html
#   git commit -m "refresh v6r3 ..."
#   git push origin main
#
# Stage only index.html. A full ``git add -A`` from an old tree can delete
# status/cloud_contract.json and cloud-status.js.
