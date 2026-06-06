#!/usr/bin/env python3
from __future__ import annotations

import argparse
import re
import shlex
import sys
from pathlib import Path

from sync_cloudrun_env import DEFAULT_KEYS, masked, parse_env_file, risk_checks, selected_env


def docker_quote(value: str) -> str:
    return shlex.quote(value)


def render_env_lines(env: dict[str, str]) -> str:
    lines: list[str] = []
    for key, value in env.items():
        if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", key):
            raise ValueError(f"invalid env key: {key}")
        lines.append(f"ENV {key}={docker_quote(value)}")
    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser(description="Render a local Dockerfile with ENV values from .env.")
    parser.add_argument("--env-file", default=".env", help="dotenv file path, default: .env")
    parser.add_argument("--base-dockerfile", default="Dockerfile", help="base Dockerfile path")
    parser.add_argument("--output", default="Dockerfile.env", help="output Dockerfile path, default: Dockerfile.env")
    parser.add_argument("--include-extra", action="store_true", help="include non-whitelisted variables from env file")
    parser.add_argument("--allow-risk", action="store_true", help="allow risky local/dev values")
    args = parser.parse_args()

    env_path = Path(args.env_file)
    base_path = Path(args.base_dockerfile)
    output_path = Path(args.output)
    if not env_path.exists():
        print(f"[error] env file not found: {env_path}", file=sys.stderr)
        return 2
    if not base_path.exists():
        print(f"[error] base Dockerfile not found: {base_path}", file=sys.stderr)
        return 2

    env = selected_env(parse_env_file(env_path), args.include_extra)
    risks = risk_checks(env)
    if risks and not args.allow_risk:
        print("[error] risky values detected; fix .env or add --allow-risk to render anyway.", file=sys.stderr)
        for item in risks:
            print(f"  - {item}", file=sys.stderr)
        return 3

    base = base_path.read_text(encoding="utf-8")
    marker = "WORKDIR /app"
    if marker not in base:
        print(f"[error] marker not found in Dockerfile: {marker}", file=sys.stderr)
        return 2
    env_block = "\n# Runtime environment baked from local .env. Do not commit this file.\n" + render_env_lines(env) + "\n"
    rendered = base.replace(marker, marker + env_block, 1)
    output_path.write_text(rendered, encoding="utf-8")

    print(f"Rendered {output_path} with {len(env)} ENV entries:")
    for key, value in env.items():
        print(f"  {key}={masked(key, value)}")
    print("\nUse this Dockerfile path in WeChat CloudBase Run:")
    print(f"  {output_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
