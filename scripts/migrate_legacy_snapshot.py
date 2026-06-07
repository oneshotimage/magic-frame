#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.core import STORE  # noqa: E402


def snapshot_summary(snapshot: dict[str, Any] | None) -> dict[str, int]:
    if not snapshot:
        return {}
    return {
        "users": len(snapshot.get("users", {})),
        "tokens": len(snapshot.get("tokens", {})),
        "refresh_tokens": len(snapshot.get("refresh_tokens", {})),
        "credits": len(snapshot.get("credits", {})),
        "credit_logs": len(snapshot.get("credit_logs", [])),
        "uploads": len(snapshot.get("uploads", {})),
        "tasks": len(snapshot.get("tasks", {})),
        "orders": len(snapshot.get("orders", {})),
        "feedback": len(snapshot.get("feedback", [])),
        "ad_rewards": len(snapshot.get("ad_rewards", [])),
        "generated_assets": len(snapshot.get("generated_assets", {})),
        "admin_tokens": len(snapshot.get("admin_tokens", [])),
        "debug_logs": len(snapshot.get("debug_logs", [])),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Migrate legacy app_snapshots payload into relational business tables.")
    parser.add_argument("--key", default="default", help="legacy snapshot key, default: default")
    parser.add_argument("--dry-run", action="store_true", help="only print status and do not write business tables")
    parser.add_argument("--force", action="store_true", help="overwrite existing business table data")
    parser.add_argument("--drop-legacy", action="store_true", help="drop legacy app_snapshots table after migration checks")
    parser.add_argument("--drop-without-migration", action="store_true", help="allow dropping app_snapshots when business tables already contain data")
    parser.add_argument("--json", action="store_true", help="print machine-readable JSON")
    args = parser.parse_args()

    status = STORE.status()
    legacy = STORE.load_legacy_snapshot(args.key)
    before_counts = STORE.table_counts()
    existing_rows = sum(value for value in before_counts.values() if value > 0)
    result: dict[str, Any] = {
        "database": {
            "kind": status.get("kind"),
            "available": status.get("available"),
            "schema": status.get("schema"),
            "error": status.get("error"),
        },
        "legacySnapshotFound": bool(legacy),
        "legacySummary": snapshot_summary(legacy),
        "businessTableCountsBefore": before_counts,
        "existingBusinessRows": existing_rows,
        "dryRun": args.dry_run,
        "force": args.force,
        "dropLegacy": args.drop_legacy,
        "dropWithoutMigration": args.drop_without_migration,
        "migrated": False,
        "legacyDropped": False,
        "reason": "",
    }

    if not status.get("available"):
        result["reason"] = "database unavailable"
    elif not legacy:
        result["reason"] = "legacy snapshot not found"
    elif args.dry_run:
        result["reason"] = "dry run"
    elif existing_rows and not args.force:
        result["reason"] = "business tables are not empty; rerun with --force to overwrite"
    else:
        migration = STORE.migrate_legacy_snapshot(key=args.key, overwrite=args.force)
        result.update(migration)
        result["businessTableCountsAfter"] = STORE.table_counts()

    if args.drop_legacy and not args.dry_run:
        can_drop = bool(result.get("migrated")) or (args.drop_without_migration and existing_rows > 0)
        if can_drop:
            STORE.drop_legacy_snapshot_table()
            result["legacyDropped"] = True
        elif not result["reason"]:
            result["reason"] = "legacy table not dropped; migrate first or pass --drop-without-migration"

    if args.json:
        print(json.dumps(result, ensure_ascii=False, indent=2))
    else:
        print(f"database: {result['database']}")
        print(f"legacy snapshot found: {result['legacySnapshotFound']}")
        print(f"legacy summary: {result['legacySummary']}")
        print(f"business table rows before: {result['businessTableCountsBefore']}")
        if "businessTableCountsAfter" in result:
            print(f"business table rows after: {result['businessTableCountsAfter']}")
        print(f"migrated: {result['migrated']}")
        print(f"legacy dropped: {result['legacyDropped']}")
        if result["reason"]:
            print(f"reason: {result['reason']}")
    return 0 if result["migrated"] or result["legacyDropped"] or args.dry_run else 1


if __name__ == "__main__":
    raise SystemExit(main())
