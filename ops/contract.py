"""Build the public heartbeat contract from the sanitized snapshot already in git.

A run of this module records that the worker was invoked. It does not read the
laptop disk, the loopback brain, or chat exports, and it does not promote a
heartbeat into an ingestion receipt.
"""

from __future__ import annotations

import hashlib
import ipaddress
import json
import os
import re
import socket
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

from ops.safety import SafetyError, assert_public_text, privacy_findings

ICT = timezone(timedelta(hours=7))
STALE_SNAPSHOT_SECONDS = 26 * 3600
HEARTBEAT_STALE_SECONDS = 8 * 3600
RUNS_UTC = ((0, 20), (6, 20), (10, 20), (18, 20))
MAX_ATTEMPTS_CAP = 4
RECEIPT_CAP = 20
HEARTBEAT_LOG_CAP = 48
MAX_BODY = 200_000
SCHEMA = "dx-cloud-contract/v1"

SNAP_RE = re.compile(
    r'<script id="snap" type="application/json">(.*?)</script>',
    re.DOTALL,
)
GENERATED_RE = re.compile(r"^(\d{2})/(\d{2})/(\d{4}) (\d{2}):(\d{2})")
SOURCE_ID_RE = re.compile(r"^[a-z0-9-]{1,64}$")
SHA_RE = re.compile(r"^[a-f0-9]{64}$")
HOST_RE = re.compile(r"^[A-Za-z0-9.-]{1,253}$")

RETRYABLE_HTTP = {408, 429, 500, 502, 503, 504}


class FetchError(Exception):
    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


class LockTimeout(Exception):
    pass


class ContractError(Exception):
    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


class _Redirect(Exception):
    def __init__(self, code: int, location: str):
        super().__init__(location)
        self.code = code
        self.location = location


class _CaptureRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise _Redirect(code, newurl)


try:
    import fcntl
except ImportError:  # pragma: no cover - GitHub runners are Linux
    fcntl = None


def ict_label(hour: int, minute: int) -> str:
    total = hour * 60 + minute + 7 * 60
    extra_day = total // (24 * 60)
    total %= 24 * 60
    label = f"{total // 60:02d}:{total % 60:02d}"
    if extra_day:
        label += " (ngày kế)"
    return label


def schedule_ict() -> list[str]:
    return [ict_label(hour, minute) for hour, minute in RUNS_UTC]


def schedule_utc() -> list[str]:
    return [f"{hour:02d}:{minute:02d}" for hour, minute in RUNS_UTC]


def ip_is_blocked(ip: str) -> bool:
    addr = ipaddress.ip_address(ip)
    return bool(
        addr.is_private
        or addr.is_loopback
        or addr.is_link_local
        or addr.is_reserved
        or addr.is_multicast
        or addr.is_unspecified
    )


def load_snapshot(html: str) -> tuple[str, dict]:
    match = SNAP_RE.search(html)
    if not match:
        raise ContractError("snapshot_missing")
    raw = match.group(1)
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise ContractError("snapshot_json") from exc
    if not isinstance(data, dict):
        raise ContractError("snapshot_json")
    return raw, data


def parse_generated_at(raw: object) -> datetime | None:
    if not isinstance(raw, str):
        return None
    match = GENERATED_RE.match(raw.strip())
    if not match:
        return None
    day, month, year, hour, minute = (int(part) for part in match.groups())
    try:
        return datetime(year, month, day, hour, minute, tzinfo=ICT)
    except ValueError:
        return None


def _iso(moment: datetime) -> str:
    return moment.astimezone(timezone.utc).isoformat()


def _ict_iso(moment: datetime) -> str:
    return moment.astimezone(ICT).isoformat()


def execution_from_env(env: dict[str, str]) -> dict:
    if env.get("GITHUB_ACTIONS") == "true":
        event = env.get("GITHUB_EVENT_NAME") or ""
        return {
            "mode": "github-actions",
            "event": event,
            "scheduled_run_completed": event == "schedule",
            "run_id": env.get("GITHUB_RUN_ID") or "unknown",
            "run_attempt": env.get("GITHUB_RUN_ATTEMPT") or "1",
            "repository": env.get("GITHUB_REPOSITORY") or "",
            "ref": env.get("GITHUB_REF_NAME") or "",
        }
    return {
        "mode": "local-exercise",
        "event": "local",
        "scheduled_run_completed": False,
        "run_id": env.get("DX_CLOUD_RUN_ID") or "local-exercise",
        "run_attempt": env.get("DX_CLOUD_RUN_ATTEMPT") or "1",
        "repository": "DX-ADVISORY/dx-brain-live",
        "ref": "local",
    }


def snapshot_git_identity(repo: Path, snap_raw: str) -> dict:
    identity = {
        "commit_sha": None,
        "commit_subject": None,
        "commit_committed_at": None,
    }
    try:
        import subprocess

        head = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            cwd=repo,
            check=True,
            capture_output=True,
            text=True,
        ).stdout.strip()
        show = subprocess.run(
            ["git", "show", "HEAD:index.html"],
            cwd=repo,
            check=True,
            capture_output=True,
            text=True,
        ).stdout
        match = SNAP_RE.search(show)
        if not match or match.group(1) != snap_raw:
            return identity
        meta = subprocess.run(
            ["git", "log", "-1", "--format=%s%n%cI"],
            cwd=repo,
            check=True,
            capture_output=True,
            text=True,
        ).stdout.splitlines()
        identity["commit_sha"] = head
        identity["commit_subject"] = meta[0] if meta else None
        identity["commit_committed_at"] = meta[1] if len(meta) > 1 else None
    except Exception:
        return identity
    subject = identity["commit_subject"] or ""
    if privacy_findings(subject):
        identity["commit_subject"] = None
    return identity


def load_allowlist(path: Path) -> dict:
    if not path.exists():
        return {"schema": "dx-cloud-source-allowlist/v1", "sources": [], "missing": True}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise ContractError("allowlist_json") from exc
    if data.get("schema") != "dx-cloud-source-allowlist/v1":
        raise ContractError("allowlist_schema")
    if not isinstance(data.get("sources"), list):
        raise ContractError("allowlist_sources")
    return data


def _int_field(value: object) -> int | None:
    return value if isinstance(value, int) else None


def _observed_snapshot(data: dict, raw: str, now: datetime, git_identity: dict) -> dict:
    generated_raw = data.get("generated_at")
    generated = parse_generated_at(generated_raw)
    legal = data.get("legal_vault") if isinstance(data.get("legal_vault"), dict) else {}
    brain = data.get("brain") if isinstance(data.get("brain"), dict) else {}
    age = None
    stale = None
    anomaly = None
    if generated is not None:
        age = int((now.astimezone(timezone.utc) - generated.astimezone(timezone.utc)).total_seconds())
        if age < -300:
            anomaly = "snapshot_in_future"
            stale = False
        else:
            stale = age >= STALE_SNAPSHOT_SECONDS
    return {
        "generated_at_raw": generated_raw if isinstance(generated_raw, str) else None,
        "generated_at_ict": _ict_iso(generated) if generated else None,
        "parse_ok": generated is not None,
        "age_seconds": age,
        "stale": stale,
        "stale_after_seconds": STALE_SNAPSHOT_SECONDS,
        "anomaly": anomaly,
        "content_sha256": hashlib.sha256(raw.encode("utf-8")).hexdigest(),
        "commit_sha": git_identity.get("commit_sha"),
        "commit_subject": git_identity.get("commit_subject"),
        "commit_committed_at": git_identity.get("commit_committed_at"),
        "counts_are_live": False,
        "fields_observed": {
            "brain_status_field": brain.get("status") if isinstance(brain.get("status"), str) else None,
            "brain_version": brain.get("version") if isinstance(brain.get("version"), str) else None,
            "brain_sources_field": brain.get("sources") if isinstance(brain.get("sources"), str) else None,
            "legal_pdfs": _int_field(legal.get("pdfs")),
            "legal_groups": _int_field(legal.get("groups")),
            "legal_as_of": legal.get("as_of") if isinstance(legal.get("as_of"), str) else None,
            "legal_downloaded": _int_field(legal.get("downloaded")),
            "legal_linked": _int_field(legal.get("linked")),
            "legal_gaps": _int_field(legal.get("gaps")),
            "note": "Copied from the sanitized snapshot already in this repo. Not re-counted.",
        },
    }


def validate_source(source: dict) -> None:
    if not isinstance(source, dict):
        raise FetchError("invalid_source")
    if source.get("approved") is not True or source.get("official") is not True:
        raise FetchError("not_approved")
    source_id = source.get("id")
    if not isinstance(source_id, str) or not SOURCE_ID_RE.fullmatch(source_id):
        raise FetchError("invalid_source_id")
    if source.get("kind") != "https-get":
        raise FetchError("unsupported_kind")
    url = source.get("url")
    host = source.get("host")
    if not isinstance(url, str) or not isinstance(host, str):
        raise FetchError("url_rejected")
    parsed = urllib.parse.urlparse(url)
    if (
        parsed.scheme != "https"
        or parsed.username
        or parsed.password
        or parsed.hostname != host
        or parsed.port not in (None, 443)
    ):
        raise FetchError("url_rejected")
    try:
        if ip_is_blocked(host):
            raise FetchError("non_public_address")
    except ValueError:
        if host in {"localhost"} or not HOST_RE.fullmatch(host):
            raise FetchError("url_rejected")


def assert_public_dns(host: str, resolver=socket.getaddrinfo) -> None:
    try:
        if ip_is_blocked(host):
            raise FetchError("non_public_address")
        return
    except ValueError:
        pass
    except FetchError:
        raise
    try:
        infos = resolver(host, 443, type=socket.SOCK_STREAM)
    except socket.gaierror as exc:
        raise FetchError("dns_failed") from exc
    seen = False
    for info in infos:
        ip = info[4][0]
        seen = True
        if ip_is_blocked(ip):
            raise FetchError("non_public_address")
    if not seen:
        raise FetchError("dns_failed")


def next_url(current: str, location: str, allowed_host: str) -> str:
    nxt = urllib.parse.urljoin(current, location)
    parsed = urllib.parse.urlparse(nxt)
    if (
        parsed.scheme != "https"
        or parsed.hostname != allowed_host
        or parsed.port not in (None, 443)
        or parsed.username
        or parsed.password
    ):
        raise FetchError("redirect_rejected")
    return nxt


def default_transport(req: urllib.request.Request, timeout: float):
    opener = urllib.request.build_opener(_CaptureRedirect)
    return opener.open(req, timeout=timeout)


def _check_fetch_url(url: str, allowed_host: str) -> None:
    parsed = urllib.parse.urlparse(url)
    if (
        parsed.scheme != "https"
        or parsed.username
        or parsed.password
        or parsed.hostname != allowed_host
        or parsed.port not in (None, 443)
    ):
        raise FetchError("url_rejected")


def https_get(
    url: str,
    allowed_host: str,
    *,
    timeout: float = 20,
    max_bytes: int = MAX_BODY,
    transport=None,
    resolver=socket.getaddrinfo,
) -> tuple[int, bytes]:
    transport = transport or default_transport
    current = url
    for _hop in range(4):
        _check_fetch_url(current, allowed_host)
        assert_public_dns(urllib.parse.urlparse(current).hostname or "", resolver)
        req = urllib.request.Request(
            current,
            headers={
                "User-Agent": "dx-brain-cloud-heartbeat/1.0",
                "Accept": "application/json, text/plain;q=0.9, */*;q=0.1",
            },
            method="GET",
        )
        if any(name.lower() == "authorization" for name, _value in req.header_items()):
            raise FetchError("auth_header_forbidden")
        try:
            with transport(req, timeout) as resp:
                status = int(getattr(resp, "status", 200))
                if status != 200:
                    raise FetchError(f"http_{status}")
                data = resp.read(max_bytes + 1)
        except _Redirect as redirect:
            current = next_url(current, redirect.location, allowed_host)
            continue
        except FetchError:
            raise
        except urllib.error.HTTPError as exc:
            raise FetchError(f"http_{exc.code}") from exc
        except urllib.error.URLError as exc:
            raise FetchError("network") from exc
        if not isinstance(data, (bytes, bytearray)):
            raise FetchError("bad_body")
        if len(data) > max_bytes:
            raise FetchError("too_large")
        return status, bytes(data)
    raise FetchError("too_many_redirects")


def retryable(code: str) -> bool:
    if code in {"network", "dns_failed"}:
        return True
    if code.startswith("http_"):
        try:
            number = int(code.split("_", 1)[1])
        except ValueError:
            return False
        return number in RETRYABLE_HTTP
    return False


def _fetcher_for(source: dict, transport, resolver) -> tuple[int, bytes]:
    timeout = float(source.get("timeout_seconds", 20))
    return https_get(
        source["url"],
        source["host"],
        timeout=timeout,
        transport=transport,
        resolver=resolver,
    )


def sanitize_receipt(receipt: object) -> dict | None:
    if not isinstance(receipt, dict):
        return None
    source_id = receipt.get("source_id")
    digest = receipt.get("body_sha256")
    body_bytes = receipt.get("body_bytes")
    if not isinstance(source_id, str) or not SOURCE_ID_RE.fullmatch(source_id):
        return None
    if not isinstance(digest, str) or not SHA_RE.fullmatch(digest):
        return None
    if not isinstance(body_bytes, int) or body_bytes < 0 or body_bytes > MAX_BODY:
        return None
    verified_at = receipt.get("verified_at")
    if verified_at is not None and not isinstance(verified_at, str):
        return None
    clean = {
        "source_id": source_id,
        "body_sha256": digest,
        "body_bytes": body_bytes,
        "verified_at": verified_at,
    }
    host = receipt.get("official_host")
    if isinstance(host, str) and HOST_RE.fullmatch(host):
        clean["official_host"] = host
    status = receipt.get("http_status")
    if isinstance(status, int):
        clean["http_status"] = status
    if privacy_findings(json.dumps(clean, ensure_ascii=False)):
        return None
    return clean


def run_sources(
    sources: list,
    *,
    now: datetime,
    sleep,
    fetcher,
    prior_receipts: list,
    prior_last_verified_at: str | None,
) -> dict:
    approved = [item for item in sources if isinstance(item, dict) and item.get("approved") is True]
    if not approved:
        return {
            "complete": False,
            "attempted": False,
            "reason_code": "no_approved_public_source",
            "receipt_count": 0,
            "last_verified_at": None,
            "receipts": [],
            "this_run_errors": [],
            "prior_receipts_ignored": bool(prior_receipts) or bool(prior_last_verified_at),
        }

    kept = []
    approved_ids = set()
    for source in approved:
        try:
            validate_source(source)
        except FetchError:
            continue
        approved_ids.add(source["id"])
    for item in prior_receipts:
        clean = sanitize_receipt(item)
        if clean and clean["source_id"] in approved_ids:
            kept.append(clean)
    by_key = {(item["source_id"], item["body_sha256"]): item for item in kept}

    errors = []
    verified_ids = []
    for source in approved:
        source_id = source.get("id") if isinstance(source, dict) else None
        try:
            validate_source(source)
        except FetchError as exc:
            errors.append({"source_id": source_id if isinstance(source_id, str) else None, "error_code": exc.code})
            continue
        attempts_limit = min(int(source.get("max_attempts", 3)), MAX_ATTEMPTS_CAP)
        backoff = float(source.get("initial_backoff_seconds", 1))
        body = None
        status = None
        attempts = []
        for number in range(1, attempts_limit + 1):
            try:
                status, body = fetcher(source)
                attempts.append({"attempt": number, "error_code": None, "backoff_seconds_next": 0})
                break
            except FetchError as exc:
                will_retry = retryable(exc.code) and number < attempts_limit
                attempts.append(
                    {
                        "attempt": number,
                        "error_code": exc.code,
                        "backoff_seconds_next": backoff if will_retry else 0,
                    }
                )
                if not will_retry:
                    body = None
                    break
                sleep(backoff)
                backoff = min(backoff * 2, 30)
        if body is None:
            errors.append({"source_id": source["id"], "error_code": attempts[-1]["error_code"]})
            continue
        if privacy_findings(body.decode("utf-8", "replace")):
            errors.append({"source_id": source["id"], "error_code": "privacy_rejected"})
            continue
        digest = hashlib.sha256(body).hexdigest()
        stamped = _iso(now)
        existing = by_key.get((source["id"], digest))
        if existing:
            existing["reconfirmed_at"] = stamped
            existing["attempts_last_run"] = attempts
            existing["http_status"] = status
        else:
            receipt = sanitize_receipt(
                {
                    "source_id": source["id"],
                    "official_host": source["host"],
                    "body_sha256": digest,
                    "body_bytes": len(body),
                    "verified_at": stamped,
                    "http_status": status,
                }
            )
            if receipt is None:
                errors.append({"source_id": source["id"], "error_code": "privacy_rejected"})
                continue
            receipt["reconfirmed_at"] = stamped
            receipt["attempts_last_run"] = attempts
            kept.append(receipt)
            by_key[(source["id"], digest)] = receipt
        verified_ids.append(source["id"])

    kept = kept[-RECEIPT_CAP:]
    complete = bool(approved_ids) and not errors and all(source_id in verified_ids for source_id in approved_ids)
    if complete:
        last_verified = _iso(now)
        reason = "verified"
    else:
        last_verified = prior_last_verified_at if isinstance(prior_last_verified_at, str) else None
        reason = "partial" if verified_ids else "source_failed"
    return {
        "complete": complete,
        "attempted": True,
        "reason_code": reason,
        "receipt_count": len(kept),
        "last_verified_at": last_verified,
        "receipts": kept,
        "this_run_errors": errors,
        "prior_receipts_ignored": False,
    }


def _missing_pieces(repo: Path, allowlist: dict, execution: dict) -> list[dict]:
    missing = []
    publisher = repo / "Runtime" / "BrainMap_v5" / "publish_brain_v6r3.py"
    if not publisher.exists():
        missing.append(
            {
                "code": "publisher_script_absent",
                "detail": "Runtime/BrainMap_v5/publish_brain_v6r3.py is not in this repo.",
            }
        )
    sources = allowlist.get("sources") or []
    approved = [item for item in sources if isinstance(item, dict) and item.get("approved") is True]
    if not approved:
        missing.append(
            {
                "code": "allowlist_empty",
                "detail": "status/source_allowlist.json has no approved official source.",
            }
        )
    export_dirs = [repo / "exports", repo / "sanitized-exports"]
    has_exports = any(path.is_dir() and any(path.iterdir()) for path in export_dirs)
    if not has_exports:
        missing.append(
            {
                "code": "no_chat_exports",
                "detail": "No sanitized ChatGPT, Claude, or Grok export is in this repo.",
            }
        )
    missing.append(
        {
            "code": "local_brain_unreachable",
            "detail": "The source machine and its loopback brain are not inputs to this worker.",
        }
    )
    if execution.get("mode") != "github-actions":
        missing.append(
            {
                "code": "schedule_not_exercised_on_github",
                "detail": "This file was written outside GitHub Actions. The cron is configured and has not completed here.",
            }
        )
    return missing


def _catchup(snapshot: dict) -> dict:
    refresh_pending = snapshot.get("stale") is True or snapshot.get("parse_ok") is not True
    return {
        "source_of_truth": "laptop-local",
        "cloud_can_read_powered_off_machine": False,
        "probed_machine": False,
        "local_ingestion_pending": True,
        "snapshot_refresh_pending": refresh_pending,
        "preserved_tasks": [
            {
                "name": "DX_BrainMap_v6_Refresh",
                "cadence_ict": "daily 20:00",
                "relative_script": "Runtime/BrainMap_v5/publish_brain_v6r3.py",
                "duplicated_by_cloud": False,
            }
        ],
        "legal_monthly_scan_duplicated": False,
        "on_reconnect": [
            "Kéo repo này trước khi xuất bản để giữ thư mục status và cloud-status.js.",
            "Giữ task DX_BrainMap_v6_Refresh chạy hằng ngày lúc 20:00 UTC+7.",
            "Giữ lần quét luật hằng tháng trên máy nguồn. Worker này không làm thay việc đó.",
            "Nếu chương trình xuất bản ghi đè index.html, giữ thẻ script dx-cloud-status-hook.",
            "Giữ giờ nhịp cloud ở mục nhịp. Giờ thu thập chỉ đến từ biên nhận thu thập.",
            "Chỉ xuất ảnh tổng hợp đã gạn. Thu hoạch hội thoại vẫn ở máy nguồn.",
        ],
    }


def build_contract(
    *,
    repo: Path,
    now: datetime,
    execution: dict,
    allowlist: dict,
    snap_raw: str,
    snap: dict,
    ingestion: dict,
    git_identity: dict,
    heartbeat_recorded_at: datetime,
) -> dict:
    snapshot = _observed_snapshot(snap, snap_raw, now, git_identity)
    contract = {
        "schema": SCHEMA,
        "governance": {
            "active_client": "NONE_UNLESS_EXPLICIT",
            "durable_authority": "DX_HUMAN_MEMORY",
            "memory_mode": "reference-only",
            "lessons_mode": "candidate-only",
            "auto_promote": False,
            "public_surface": "safe_aggregate_snapshots_only",
        },
        "execution": {
            "mode": execution.get("mode"),
            "event": execution.get("event"),
            "scheduled_run_completed": bool(execution.get("scheduled_run_completed")),
            "run_id": execution.get("run_id"),
            "run_attempt": str(execution.get("run_attempt")),
            "repository": execution.get("repository"),
            "ref": execution.get("ref"),
        },
        "clocks": {
            "browser_session": {
                "owner": "browser-tab",
                "recorded_by_cloud": False,
                "resets_on": "tab-open",
                "animation_is_processing": False,
            },
            "cloud_heartbeat": {
                "recorded_at_utc": _iso(heartbeat_recorded_at),
                "recorded_at_ict": _ict_iso(heartbeat_recorded_at),
                "worker_ran": True,
                "means_ingestion": False,
                "means_publish": False,
                "means_snapshot_refresh": False,
                "stale_after_seconds": HEARTBEAT_STALE_SECONDS,
                "runner": execution.get("mode"),
                "scheduled_run_completed": bool(execution.get("scheduled_run_completed")),
                "schedule_utc": schedule_utc(),
                "schedule_ict": schedule_ict(),
                "schedule_note": (
                    "GitHub Actions cron uses UTC and can start late. "
                    "DX_BrainMap_v6_Refresh stays at 20:00 UTC+7 on the source machine."
                ),
            },
            "source_snapshot": snapshot,
            "ingestion": {
                "complete": bool(ingestion["complete"]),
                "attempted": bool(ingestion["attempted"]),
                "reason_code": ingestion["reason_code"],
                "receipt_count": ingestion["receipt_count"],
                "last_verified_at": ingestion["last_verified_at"],
                "conversation_access": "not_inferred",
                "this_run_errors": ingestion["this_run_errors"],
                "channels_not_read": [
                    "chatgpt",
                    "claude",
                    "grok",
                    "x",
                    "onedrive",
                    "gdrive",
                    "obsidian",
                    "local-brain",
                    "laptop-disk",
                ],
            },
        },
        "laptop_catchup": _catchup(snapshot),
        "missing_for_full_sync": _missing_pieces(repo, allowlist, execution),
        "privacy": {"scan_passed": True},
    }
    if contract["clocks"]["ingestion"]["complete"]:
        # A real receipt may complete ingestion. A heartbeat flag never does.
        contract["clocks"]["cloud_heartbeat"]["means_ingestion"] = False
    return contract


def receipts_document(now: datetime, ingestion: dict) -> dict:
    return {
        "schema": "dx-ingestion-receipts/v1",
        "observed_at_utc": _iso(now),
        "observed_at_is_verification": False,
        "complete": ingestion["complete"],
        "attempted": ingestion["attempted"],
        "reason_code": ingestion["reason_code"],
        "last_verified_at": ingestion["last_verified_at"],
        "prior_receipts_ignored": ingestion.get("prior_receipts_ignored", False),
        "this_run_errors": ingestion["this_run_errors"],
        "receipts": ingestion["receipts"],
    }


def existing_heartbeat(log_text: str, run_id: str, run_attempt: str) -> dict | None:
    for line in log_text.splitlines():
        if not line.strip():
            continue
        try:
            row = json.loads(line)
        except json.JSONDecodeError:
            continue
        if row.get("run_id") == run_id and str(row.get("run_attempt")) == str(run_attempt):
            return row
    return None


def append_heartbeat(log_text: str, entry: dict) -> str:
    rows = []
    for line in log_text.splitlines():
        if not line.strip():
            continue
        rows.append(json.loads(line))
    if any(
        row.get("run_id") == entry["run_id"] and str(row.get("run_attempt")) == str(entry["run_attempt"])
        for row in rows
    ):
        if log_text and not log_text.endswith("\n"):
            return log_text + "\n"
        return log_text
    rows.append(entry)
    rows = rows[-HEARTBEAT_LOG_CAP:]
    return "".join(json.dumps(row, ensure_ascii=False, sort_keys=True) + "\n" for row in rows)


def _dump(data: dict) -> str:
    return json.dumps(data, ensure_ascii=False, indent=2, sort_keys=True) + "\n"


def atomic_write(path: Path, text: str) -> None:
    assert_public_text(text)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + ".tmp")
    temporary.write_text(text, encoding="utf-8")
    os.replace(temporary, path)


class FileLock:
    def __init__(self, path: Path, timeout: float = 5):
        self.path = path
        self.timeout = timeout
        self._handle = None

    def __enter__(self):
        if fcntl is None:
            raise LockTimeout("fcntl_unavailable")
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._handle = open(self.path, "a+")
        deadline = time.monotonic() + self.timeout
        while True:
            try:
                fcntl.flock(self._handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
                return self
            except BlockingIOError:
                if time.monotonic() >= deadline:
                    self._handle.close()
                    self._handle = None
                    raise LockTimeout(str(self.path))
                time.sleep(0.02)

    def __exit__(self, exc_type, exc, tb):
        if self._handle is not None:
            fcntl.flock(self._handle.fileno(), fcntl.LOCK_UN)
            self._handle.close()
            self._handle = None
        return False


def _load_prior_receipts(path: Path) -> dict:
    if not path.exists():
        return {"receipts": [], "last_verified_at": None}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {"receipts": [], "last_verified_at": None, "prior_unreadable": True}
    if not isinstance(data, dict):
        return {"receipts": [], "last_verified_at": None, "prior_unreadable": True}
    receipts = data.get("receipts")
    if not isinstance(receipts, list):
        receipts = []
    last = data.get("last_verified_at")
    if not isinstance(last, str):
        last = None
    return {"receipts": receipts, "last_verified_at": last}


def run(
    repo: Path,
    *,
    now: datetime | None = None,
    env: dict[str, str] | None = None,
    fetcher=None,
    sleep=time.sleep,
    lock_path: Path | None = None,
    transport=None,
    resolver=socket.getaddrinfo,
) -> dict:
    repo = repo.resolve()
    now = now or datetime.now(timezone.utc)
    if now.tzinfo is None:
        raise ContractError("naive_clock")
    env = env if env is not None else dict(os.environ)
    execution = execution_from_env(env)
    lock_path = lock_path or (Path(os.getenv("TMPDIR", "/tmp")) / "dx-brain-cloud-heartbeat.lock")
    with FileLock(lock_path):
        index = (repo / "index.html").read_text(encoding="utf-8")
        snap_raw, snap = load_snapshot(index)
        allowlist = load_allowlist(repo / "status" / "source_allowlist.json")
        prior = _load_prior_receipts(repo / "status" / "ingestion_receipts.json")
        log_path = repo / "status" / "heartbeat_log.jsonl"
        log_text = log_path.read_text(encoding="utf-8") if log_path.exists() else ""
        previous = existing_heartbeat(log_text, execution["run_id"], str(execution["run_attempt"]))
        heartbeat_at = now
        if previous and isinstance(previous.get("recorded_at_utc"), str):
            parsed = datetime.fromisoformat(previous["recorded_at_utc"])
            if parsed.tzinfo is not None:
                heartbeat_at = parsed

        def default_fetcher(source: dict) -> tuple[int, bytes]:
            return _fetcher_for(source, transport, resolver)

        ingestion = run_sources(
            list(allowlist.get("sources") or []),
            now=now,
            sleep=sleep,
            fetcher=fetcher or default_fetcher,
            prior_receipts=list(prior.get("receipts") or []),
            prior_last_verified_at=prior.get("last_verified_at"),
        )
        contract = build_contract(
            repo=repo,
            now=now,
            execution=execution,
            allowlist=allowlist,
            snap_raw=snap_raw,
            snap=snap,
            ingestion=ingestion,
            git_identity=snapshot_git_identity(repo, snap_raw),
            heartbeat_recorded_at=heartbeat_at,
        )
        receipts = receipts_document(now, ingestion)
        entry = {
            "ingestion_complete": False if not ingestion["complete"] else True,
            "means_ingestion": False,
            "means_publish": False,
            "reason_code": ingestion["reason_code"],
            "recorded_at_utc": _iso(heartbeat_at),
            "run_attempt": str(execution["run_attempt"]),
            "run_id": execution["run_id"],
            "snapshot_sha256": contract["clocks"]["source_snapshot"]["content_sha256"],
        }
        # Heartbeat log must not inherit a true ingestion flag from a publish event.
        entry["means_ingestion"] = False
        entry["means_publish"] = False
        new_log = append_heartbeat(log_text, entry)
        contract_text = _dump(contract)
        receipts_text = _dump(receipts)
        assert_public_text(contract_text)
        assert_public_text(receipts_text)
        assert_public_text(new_log)
        status = repo / "status"
        atomic_write(status / "cloud_contract.json", contract_text)
        atomic_write(status / "ingestion_receipts.json", receipts_text)
        atomic_write(log_path, new_log)
        return contract
