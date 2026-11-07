"""Honesty tests for the cloud heartbeat. They do not call the public internet."""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from ops.contract import (  # noqa: E402
    STALE_SNAPSHOT_SECONDS,
    ContractError,
    FetchError,
    FileLock,
    LockTimeout,
    _Redirect,
    https_get,
    load_snapshot,
    parse_generated_at,
    run,
    run_sources,
    schedule_ict,
)
from ops.safety import (  # noqa: E402
    apply_public_ui_hook,
    header_line,
    logo_hashes,
    privacy_findings,
    public_diff_is_safe,
    three_hash,
)

NOW = datetime(2026, 11, 7, 1, 41, tzinfo=timezone.utc)
GENERATED = "06/11/2026 20:00 (UTC+7)"


def _html(log_line: str = "safe aggregate") -> str:
    snap = {
        "generated_at": GENERATED,
        "brain": {"status": "PASS", "sources": "12/12", "version": "5.0.3-repair2"},
        "legal_vault": {
            "pdfs": 43,
            "groups": 11,
            "as_of": "2026-11-06",
            "downloaded": 21,
            "linked": 15,
            "gaps": 5,
        },
        "kpis": [{"l": "Kho luật DX", "v": 43}],
        "log": [["05/11 13:38", "ok", "FEED", log_line]],
    }
    return (
        "<html><body><header><span class=\"pill\"><i></i>đang chạy · "
        "<span id=\"up\">00:00:00</span></span></header>"
        "<h3>Nhật ký · tail -f brain.log</h3>"
        '<script id="snap" type="application/json">'
        + json.dumps(snap, ensure_ascii=False)
        + "</script></body></html>"
    )


def _source(body_fails: int = 0) -> dict:
    return {
        "id": "fixture-bulletin",
        "approved": True,
        "official": True,
        "kind": "https-get",
        "url": "https://example.com/bulletin.json",
        "host": "example.com",
        "max_attempts": 3,
        "initial_backoff_seconds": 0.01,
    }


class _Resp:
    def __init__(self, data: bytes, status: int = 200):
        self._data = data
        self.status = status

    def read(self, _n):
        return self._data

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False


class ContractTests(unittest.TestCase):
    def test_snapshot_age_is_not_stale_at_the_observed_moment(self):
        generated = parse_generated_at(GENERATED)
        self.assertEqual(generated.isoformat(), "2026-11-06T20:00:00+07:00")
        age = int((NOW - generated.astimezone(timezone.utc)).total_seconds())
        self.assertEqual(age, 12 * 3600 + 41 * 60)
        self.assertLess(age, STALE_SNAPSHOT_SECONDS)

    def test_future_and_unparsed_snapshots_are_not_treated_as_fresh_success(self):
        self.assertIsNone(parse_generated_at("tomorrow"))
        self.assertIsNone(parse_generated_at(None))

    def test_empty_allowlist_wipes_a_poisoned_success_and_does_not_fetch(self):
        calls = []

        def fetcher(_source):
            calls.append(1)
            raise AssertionError("fetcher should not run")

        result = run_sources(
            [{"id": "news", "approved": False, "official": True, "kind": "https-get", "url": "https://example.com/a", "host": "example.com"}],
            now=NOW,
            sleep=lambda _seconds: calls.append("sleep"),
            fetcher=fetcher,
            prior_receipts=[
                {
                    "source_id": "news",
                    "body_sha256": "a" * 64,
                    "body_bytes": 4,
                    "verified_at": "2099-01-01T00:00:00+00:00",
                    "body": "person@example.com",
                }
            ],
            prior_last_verified_at="2099-01-01T00:00:00+00:00",
        )
        self.assertEqual(calls, [])
        self.assertFalse(result["complete"])
        self.assertFalse(result["attempted"])
        self.assertIsNone(result["last_verified_at"])
        self.assertEqual(result["receipts"], [])
        self.assertEqual(result["reason_code"], "no_approved_public_source")
        self.assertNotIn("person@example.com", json.dumps(result))

    def test_retry_backoff_then_one_idempotent_receipt_without_the_body(self):
        body = b'{"items":1,"marker":"bulletin-body"}'
        calls = {"n": 0}
        sleeps = []

        def fetcher(_source):
            calls["n"] += 1
            if calls["n"] < 3:
                raise FetchError("http_503")
            return 200, body

        first = run_sources(
            [_source()],
            now=NOW,
            sleep=sleeps.append,
            fetcher=fetcher,
            prior_receipts=[],
            prior_last_verified_at=None,
        )
        self.assertEqual(sleeps, [0.01, 0.02])
        self.assertTrue(first["complete"])
        self.assertEqual(first["receipt_count"], 1)
        self.assertEqual(first["last_verified_at"], NOW.astimezone(timezone.utc).isoformat())
        encoded = json.dumps(first)
        self.assertNotIn("bulletin-body", encoded)
        self.assertEqual(first["receipts"][0]["body_sha256"], hashlib.sha256(body).hexdigest())
        self.assertEqual(len(first["receipts"][0]["attempts_last_run"]), 3)

        later = NOW + timedelta(hours=6)

        def again(_source):
            calls["n"] += 1
            return 200, body

        second = run_sources(
            [_source()],
            now=later,
            sleep=lambda _seconds: None,
            fetcher=again,
            prior_receipts=first["receipts"],
            prior_last_verified_at=first["last_verified_at"],
        )
        self.assertEqual(second["receipt_count"], 1)
        self.assertEqual(second["receipts"][0]["verified_at"], first["receipts"][0]["verified_at"])
        self.assertEqual(second["receipts"][0]["reconfirmed_at"], later.astimezone(timezone.utc).isoformat())
        self.assertNotEqual(second["last_verified_at"], first["last_verified_at"])

    def test_failed_fetch_does_not_move_the_verified_timestamp(self):
        prior = "2026-11-01T03:00:00+00:00"
        sleeps = []

        def fetcher(_source):
            raise FetchError("http_404")

        result = run_sources(
            [_source()],
            now=NOW,
            sleep=sleeps.append,
            fetcher=fetcher,
            prior_receipts=[],
            prior_last_verified_at=prior,
        )
        self.assertEqual(sleeps, [])
        self.assertFalse(result["complete"])
        self.assertEqual(result["last_verified_at"], prior)
        self.assertNotEqual(result["last_verified_at"], NOW.isoformat())

    def test_attempt_cap_and_private_body_are_rejected(self):
        calls = {"n": 0}

        def fetcher(_source):
            calls["n"] += 1
            raise FetchError("http_503")

        source = _source()
        source["max_attempts"] = 20
        result = run_sources(
            [source],
            now=NOW,
            sleep=lambda _seconds: None,
            fetcher=fetcher,
            prior_receipts=[],
            prior_last_verified_at=None,
        )
        self.assertEqual(calls["n"], 4)
        self.assertFalse(result["complete"])
        self.assertIsNone(result["last_verified_at"])

        def leak(_source):
            return 200, b"contact person@example.com"

        leaked = run_sources(
            [_source()],
            now=NOW,
            sleep=lambda _seconds: None,
            fetcher=leak,
            prior_receipts=[],
            prior_last_verified_at="2099-01-01T00:00:00+00:00",
        )
        self.assertFalse(leaked["complete"])
        self.assertEqual(leaked["last_verified_at"], "2099-01-01T00:00:00+00:00")
        self.assertEqual(leaked["this_run_errors"][0]["error_code"], "privacy_rejected")
        self.assertNotIn("person@example.com", json.dumps(leaked))

    def test_https_guard_blocks_private_hosts_userinfo_and_foreign_redirects(self):
        used = []

        def transport(req, _timeout):
            used.append(req.full_url)
            raise AssertionError("transport should not run")

        with self.assertRaises(FetchError) as blocked:
            https_get("https://127.0.0.1/local", "127.0.0.1", transport=transport)
        self.assertEqual(blocked.exception.code, "non_public_address")
        self.assertEqual(used, [])

        with self.assertRaises(FetchError) as plain:
            https_get("http://example.com/a", "example.com", transport=transport)
        self.assertEqual(plain.exception.code, "url_rejected")

        with self.assertRaises(FetchError) as userinfo:
            https_get("https://user:pass@example.com/a", "example.com", transport=transport)
        self.assertEqual(userinfo.exception.code, "url_rejected")

        def redirect(_req, _timeout):
            raise _Redirect(302, "https://evil.example/steal")

        def resolver(host, _port, type=0):
            return [(2, 1, 6, "", ("93.184.216.34", 443))]

        with self.assertRaises(FetchError) as foreign:
            https_get(
                "https://example.com/a",
                "example.com",
                transport=redirect,
                resolver=resolver,
            )
        self.assertEqual(foreign.exception.code, "redirect_rejected")

        def ok(req, _timeout):
            self.assertFalse(any(name.lower() == "authorization" for name, _value in req.header_items()))
            return _Resp(b"{}")

        status, payload = https_get(
            "https://example.com/a",
            "example.com",
            transport=ok,
            resolver=resolver,
        )
        self.assertEqual(status, 200)
        self.assertEqual(payload, b"{}")

    def test_lock_times_out_instead_of_double_writing(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "writer.lock"
            started = threading.Event()

            def hold():
                with FileLock(path, timeout=2):
                    started.set()
                    time.sleep(0.3)

            thread = threading.Thread(target=hold)
            thread.start()
            self.assertTrue(started.wait(2))
            with self.assertRaises(LockTimeout):
                with FileLock(path, timeout=0.05):
                    pass
            thread.join(2)


class PageAndRunTests(unittest.TestCase):
    def test_hook_preserves_live_page_bytes_that_matter(self):
        head = subprocess.run(
            ["git", "show", "HEAD:index.html"],
            cwd=ROOT,
            check=True,
            capture_output=True,
            text=True,
        ).stdout
        hooked = apply_public_ui_hook(head)
        self.assertTrue(public_diff_is_safe(head, hooked))
        self.assertEqual(header_line(head), header_line(hooked))
        self.assertEqual(logo_hashes(head), logo_hashes(hooked))
        self.assertGreaterEqual(len(logo_hashes(head)), 2)
        self.assertTrue(three_hash(head))
        self.assertEqual(three_hash(head), three_hash(hooked))
        raw_before, snap_before = load_snapshot(head)
        raw_after, snap_after = load_snapshot(hooked)
        self.assertEqual(raw_before, raw_after)
        self.assertEqual(snap_before["legal_vault"], snap_after["legal_vault"])
        self.assertEqual(snap_before["kpis"], snap_after["kpis"])
        self.assertEqual(apply_public_ui_hook(hooked), hooked)
        tampered = hooked.replace('"pdfs": 43', '"pdfs": 99', 1)
        self.assertFalse(public_diff_is_safe(head, tampered))
        logo = logo_hashes(head)[0]
        self.assertTrue(logo)

    def test_nightly_rewrite_drops_the_hook_and_restore_keeps_the_new_snapshot(self):
        head = (ROOT / "index.html").read_text(encoding="utf-8")
        from ops.safety import HOOK, LOG_NEW, LOG_OLD

        rewritten = head.replace(HOOK, "", 1).replace(LOG_NEW, LOG_OLD, 1)
        self.assertNotIn(HOOK, rewritten)
        rewritten = rewritten.replace("06/11/2026 20:00 (UTC+7)", "07/11/2026 20:00 (UTC+7)", 1)
        restored = apply_public_ui_hook(rewritten)
        self.assertTrue(public_diff_is_safe(rewritten, restored))
        self.assertIn(HOOK, restored)
        self.assertEqual(load_snapshot(rewritten)[0], load_snapshot(restored)[0])
        self.assertEqual(load_snapshot(restored)[1]["generated_at"], "07/11/2026 20:00 (UTC+7)")
        self.assertEqual(load_snapshot(restored)[1]["legal_vault"]["pdfs"], 43)
        self.assertEqual(header_line(rewritten), header_line(restored))
        self.assertEqual(logo_hashes(rewritten), logo_hashes(restored))

    def test_worktree_page_stays_inside_the_safe_diff(self):
        head = subprocess.run(
            ["git", "show", "HEAD:index.html"],
            cwd=ROOT,
            check=True,
            capture_output=True,
            text=True,
        ).stdout
        work = (ROOT / "index.html").read_text(encoding="utf-8")
        self.assertTrue(public_diff_is_safe(head, work))

    def test_run_on_a_copy_does_not_invent_ingestion_or_copy_the_log(self):
        with tempfile.TemporaryDirectory() as tmp:
            repo = Path(tmp)
            (repo / "index.html").write_text(
                _html("D:\\\\PROJECT\\\\DX_ADVISORY\\\\secret customer@example.com b570cc9b"),
                encoding="utf-8",
            )
            poisoned = {
                "complete": True,
                "last_verified_at": "2099-01-01T00:00:00+00:00",
                "receipts": [{"body": "person@example.com", "source_id": "chatgpt"}],
            }
            status = repo / "status"
            status.mkdir()
            (status / "ingestion_receipts.json").write_text(json.dumps(poisoned), encoding="utf-8")
            (status / "source_allowlist.json").write_text(
                (ROOT / "status" / "source_allowlist.json").read_text(encoding="utf-8"),
                encoding="utf-8",
            )
            before = (repo / "index.html").read_bytes()

            def transport(_req, _timeout):
                raise AssertionError("network used")

            contract = run(
                repo,
                now=NOW,
                env={"DX_CLOUD_RUN_ID": "unit-1", "DX_CLOUD_RUN_ATTEMPT": "1"},
                transport=transport,
                lock_path=repo / "writer.lock",
            )
            self.assertEqual((repo / "index.html").read_bytes(), before)
            self.assertFalse(contract["clocks"]["cloud_heartbeat"]["means_ingestion"])
            self.assertFalse(contract["clocks"]["cloud_heartbeat"]["means_publish"])
            self.assertFalse(contract["clocks"]["cloud_heartbeat"]["means_snapshot_refresh"])
            self.assertTrue(contract["clocks"]["cloud_heartbeat"]["worker_ran"])
            self.assertFalse(contract["clocks"]["ingestion"]["complete"])
            self.assertFalse(contract["clocks"]["ingestion"]["attempted"])
            self.assertIsNone(contract["clocks"]["ingestion"]["last_verified_at"])
            self.assertEqual(contract["clocks"]["ingestion"]["reason_code"], "no_approved_public_source")
            self.assertEqual(contract["clocks"]["ingestion"]["conversation_access"], "not_inferred")
            self.assertIn("chatgpt", contract["clocks"]["ingestion"]["channels_not_read"])
            self.assertEqual(contract["clocks"]["source_snapshot"]["fields_observed"]["legal_pdfs"], 43)
            self.assertFalse(contract["clocks"]["source_snapshot"]["counts_are_live"])
            self.assertFalse(contract["clocks"]["source_snapshot"]["stale"])
            self.assertFalse(contract["laptop_catchup"]["cloud_can_read_powered_off_machine"])
            self.assertFalse(contract["laptop_catchup"]["probed_machine"])
            self.assertTrue(contract["laptop_catchup"]["local_ingestion_pending"])
            self.assertFalse(contract["laptop_catchup"]["preserved_tasks"][0]["duplicated_by_cloud"])
            self.assertFalse(contract["laptop_catchup"]["legal_monthly_scan_duplicated"])
            self.assertEqual(contract["governance"]["active_client"], "NONE_UNLESS_EXPLICIT")
            self.assertEqual(contract["governance"]["durable_authority"], "DX_HUMAN_MEMORY")
            self.assertFalse(contract["governance"]["auto_promote"])
            self.assertEqual(contract["clocks"]["cloud_heartbeat"]["schedule_ict"], schedule_ict())
            blob = (status / "cloud_contract.json").read_text(encoding="utf-8")
            blob += (status / "ingestion_receipts.json").read_text(encoding="utf-8")
            blob += (status / "heartbeat_log.jsonl").read_text(encoding="utf-8")
            self.assertEqual(privacy_findings(blob), [])
            self.assertNotIn("b570cc9b", blob)
            self.assertNotIn("PROJECT", blob)
            self.assertNotIn("@", blob)
            self.assertFalse(contract["execution"]["scheduled_run_completed"])
            codes = {item["code"] for item in contract["missing_for_full_sync"]}
            self.assertIn("publisher_script_absent", codes)
            self.assertIn("allowlist_empty", codes)
            self.assertIn("no_chat_exports", codes)
            self.assertIn("local_brain_unreachable", codes)
            self.assertIn("schedule_not_exercised_on_github", codes)

            second = run(
                repo,
                now=NOW + timedelta(hours=2),
                env={"DX_CLOUD_RUN_ID": "unit-1", "DX_CLOUD_RUN_ATTEMPT": "1"},
                transport=transport,
                lock_path=repo / "writer.lock",
            )
            self.assertEqual(
                second["clocks"]["cloud_heartbeat"]["recorded_at_utc"],
                contract["clocks"]["cloud_heartbeat"]["recorded_at_utc"],
            )
            log_lines = [line for line in (status / "heartbeat_log.jsonl").read_text(encoding="utf-8").splitlines() if line]
            self.assertEqual(len(log_lines), 1)
            self.assertFalse(json.loads(log_lines[0])["means_ingestion"])

    def test_real_snapshot_copy_keeps_counts_and_omits_replayed_log(self):
        with tempfile.TemporaryDirectory() as tmp:
            repo = Path(tmp)
            shutil.copy(ROOT / "index.html", repo / "index.html")
            shutil.copytree(ROOT / "status", repo / "status")
            for generated in (repo / "status").glob("cloud_contract.json"):
                generated.unlink()
            for generated in (repo / "status").glob("ingestion_receipts.json"):
                generated.unlink()
            for generated in (repo / "status").glob("heartbeat_log.jsonl"):
                generated.unlink()
            before_raw, before = load_snapshot((repo / "index.html").read_text(encoding="utf-8"))

            def transport(_req, _timeout):
                raise AssertionError("network used")

            contract = run(
                repo,
                now=NOW,
                env={"DX_CLOUD_RUN_ID": "real-copy", "DX_CLOUD_RUN_ATTEMPT": "1"},
                transport=transport,
                lock_path=repo / "writer.lock",
            )
            after_raw, after = load_snapshot((repo / "index.html").read_text(encoding="utf-8"))
            self.assertEqual(before_raw, after_raw)
            self.assertEqual(before["legal_vault"], after["legal_vault"])
            self.assertEqual(before["kpis"], after["kpis"])
            self.assertEqual(before["market"], after["market"])
            text = json.dumps(contract, ensure_ascii=False)
            self.assertNotIn("b570cc9b", text)
            self.assertNotIn("gói khách hàng", text)
            self.assertEqual(contract["clocks"]["source_snapshot"]["fields_observed"]["legal_pdfs"], 43)
            self.assertEqual(contract["clocks"]["source_snapshot"]["fields_observed"]["legal_gaps"], 5)
            self.assertFalse(contract["clocks"]["ingestion"]["complete"])

    def test_cli_prints_incomplete_ingestion(self):
        with tempfile.TemporaryDirectory() as tmp:
            repo = Path(tmp)
            (repo / "index.html").write_text(_html(), encoding="utf-8")
            env = os.environ.copy()
            env.pop("GITHUB_ACTIONS", None)
            env["DX_CLOUD_RUN_ID"] = "cli-exercise"
            completed = subprocess.run(
                [sys.executable, "-m", "ops.run_cloud_heartbeat", "--repo", str(repo)],
                cwd=ROOT,
                env=env,
                check=False,
                capture_output=True,
                text=True,
            )
            self.assertEqual(completed.returncode, 0, completed.stderr)
            self.assertIn("means_ingestion=false", completed.stdout)
            self.assertIn("INGESTION_COMPLETE=false", completed.stdout)
            self.assertIn("reason=no_approved_public_source", completed.stdout)
            self.assertIn("SCHEDULED_RUN_COMPLETED=false", completed.stdout)

    def test_missing_snapshot_is_an_error(self):
        with self.assertRaises(ContractError):
            load_snapshot("<html></html>")


class ScheduleAndPublishedStatusTests(unittest.TestCase):
    def test_cron_matches_the_code_and_leaves_the_laptop_hour_alone(self):
        text = (ROOT / ".github" / "workflows" / "cloud-heartbeat.yml").read_text(encoding="utf-8")
        import re

        crons = re.findall(r'cron:\s*"([^"]+)"', text)
        parsed = []
        for cron in crons:
            minute, hour, dom, month, dow = cron.split()
            self.assertEqual([dom, month, dow], ["*", "*", "*"])
            self.assertNotEqual(int(hour), 13)
            parsed.append((int(hour), int(minute)))
        self.assertEqual(parsed, [(0, 20), (6, 20), (10, 20), (18, 20)])
        self.assertEqual(schedule_ict(), ["07:20", "13:20", "17:20", "01:20 (ngày kế)"])
        self.assertNotIn("push --force", text)
        self.assertNotIn("push -f", text)
        self.assertNotIn("--no-verify", text)

    def test_published_status_files_stay_honest(self):
        contract = json.loads((ROOT / "status" / "cloud_contract.json").read_text(encoding="utf-8"))
        receipts = json.loads((ROOT / "status" / "ingestion_receipts.json").read_text(encoding="utf-8"))
        heartbeat = contract["clocks"]["cloud_heartbeat"]
        ingestion = contract["clocks"]["ingestion"]
        self.assertTrue(heartbeat["worker_ran"])
        self.assertFalse(heartbeat["means_ingestion"])
        self.assertFalse(heartbeat["means_publish"])
        self.assertFalse(ingestion["complete"])
        self.assertFalse(ingestion["attempted"])
        self.assertIsNone(ingestion["last_verified_at"])
        self.assertEqual(ingestion["receipt_count"], 0)
        self.assertEqual(ingestion["reason_code"], "no_approved_public_source")
        self.assertEqual(ingestion["conversation_access"], "not_inferred")
        self.assertEqual(contract["clocks"]["source_snapshot"]["fields_observed"]["legal_pdfs"], 43)
        self.assertFalse(contract["laptop_catchup"]["preserved_tasks"][0]["duplicated_by_cloud"])
        self.assertFalse(contract["laptop_catchup"]["legal_monthly_scan_duplicated"])
        self.assertFalse(receipts["complete"])
        self.assertFalse(receipts["observed_at_is_verification"])
        self.assertEqual(receipts["receipts"], [])
        allowlist = json.loads((ROOT / "status" / "source_allowlist.json").read_text(encoding="utf-8"))
        self.assertEqual(allowlist["sources"], [])
        blob = (ROOT / "status" / "cloud_contract.json").read_text(encoding="utf-8")
        blob += (ROOT / "status" / "ingestion_receipts.json").read_text(encoding="utf-8")
        blob += (ROOT / "status" / "heartbeat_log.jsonl").read_text(encoding="utf-8")
        self.assertEqual(privacy_findings(blob), [])
        if contract["execution"]["mode"] == "local-exercise":
            self.assertFalse(contract["execution"]["scheduled_run_completed"])
        ui = subprocess.run(
            ["node", str(ROOT / "tests" / "cloud_status.test.js")],
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
        )
        self.assertEqual(ui.returncode, 0, ui.stdout + ui.stderr)


if __name__ == "__main__":
    unittest.main()
