#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from sync_cloudrun_env import masked, parse_env_file, risk_checks, selected_env


def main() -> int:
    parser = argparse.ArgumentParser(description="Convert .env to a JSON object for cloud platform copy/paste.")
    parser.add_argument("--env-file", default=".env", help="dotenv file path, default: .env")
    parser.add_argument("--include-extra", action="store_true", help="include non-whitelisted variables from env file")
    parser.add_argument("--show-secrets", action="store_true", help="print secret values in plaintext")
    parser.add_argument("--pretty", action="store_true", help="pretty-print JSON")
    args = parser.parse_args()

    env_path = Path(args.env_file)
    if not env_path.exists():
        print(f"[error] env file not found: {env_path}", file=sys.stderr)
        return 2

    env = selected_env(parse_env_file(env_path), args.include_extra)
    risks = risk_checks(env)
    output = env if args.show_secrets else {key: masked(key, value) for key, value in env.items()}

    if risks:
        print("Risk warnings:", file=sys.stderr)
        for item in risks:
            print(f"  - {item}", file=sys.stderr)
        print("", file=sys.stderr)
    if not args.show_secrets:
        print("[info] secrets are redacted. Add --show-secrets when you are ready to copy plaintext JSON.", file=sys.stderr)

    print(json.dumps(output, ensure_ascii=False, indent=2 if args.pretty else None))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
