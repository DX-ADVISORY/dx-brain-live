"""Write the heartbeat contract. Exit 0 when ingestion did not run."""

from __future__ import annotations

import argparse
import hashlib
from pathlib import Path

from ops.contract import ContractError, LockTimeout, run
from ops.safety import SafetyError


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Record a cloud heartbeat without claiming ingestion.")
    parser.add_argument("--repo", default=".")
    args = parser.parse_args(argv)
    repo = Path(args.repo)
    index = repo / "index.html"
    before = hashlib.sha256(index.read_bytes()).hexdigest() if index.exists() else ""
    try:
        contract = run(repo)
    except SafetyError as exc:
        print(f"PRIVACY_BLOCKED code={exc.code}")
        return 2
    except LockTimeout as exc:
        print(f"LOCK_TIMEOUT {exc}")
        return 3
    except ContractError as exc:
        print(f"CONTRACT_ERROR code={exc.code}")
        return 1
    after = hashlib.sha256(index.read_bytes()).hexdigest() if index.exists() else ""
    if before != after:
        print("INDEX_MUTATED")
        return 4
    ingestion = contract["clocks"]["ingestion"]
    heartbeat = contract["clocks"]["cloud_heartbeat"]
    snapshot = contract["clocks"]["source_snapshot"]
    print(
        "HEARTBEAT_RECORDED "
        f"worker_ran={str(heartbeat['worker_ran']).lower()} "
        f"means_ingestion={str(heartbeat['means_ingestion']).lower()} "
        f"means_publish={str(heartbeat['means_publish']).lower()}"
    )
    print(
        "INGESTION_COMPLETE="
        f"{str(ingestion['complete']).lower()} "
        f"reason={ingestion['reason_code']} "
        f"receipts={ingestion['receipt_count']} "
        f"last_verified_at={ingestion['last_verified_at']}"
    )
    print(f"SNAPSHOT_STALE={str(snapshot.get('stale')).lower()} generated_at={snapshot.get('generated_at_raw')}")
    print(f"SCHEDULED_RUN_COMPLETED={str(heartbeat['scheduled_run_completed']).lower()} mode={contract['execution']['mode']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
