#!/usr/bin/env python3
from __future__ import annotations

import argparse
import os
import re
import shlex
import subprocess
import sys
from pathlib import Path
from urllib.parse import quote_plus


SECRET_MARKERS = ("SECRET", "TOKEN", "KEY", "PASSWORD", "DATABASE_URL")

DEFAULT_KEYS = [
    "PUBLIC_BASE_URL",
    "KL_API_BASE_URL",
    "KL_API_TOKEN",
    "KL_API_KEY",
    "KL_IMAGE_MODEL",
    "KL_IMAGE_ENDPOINT",
    "KL_IMAGE_SIZE",
    "KL_TIMEOUT_SECONDS",
    "KL_PROXY_URL",
    "KL_PROXY_ACCESS_TOKEN",
    "KL_FORCE_IPV4",
    "AI_MOCK_GENERATION",
    "AI_UNLIMITED_CREDITS",
    "LOG_LEVEL",
    "ADMIN_USERNAME",
    "ADMIN_PASSWORD",
    "DATABASE_URL",
    "MYSQL_ADDRESS",
    "MYSQL_HOST",
    "MYSQL_PORT",
    "MYSQL_USERNAME",
    "MYSQL_USER",
    "MYSQL_PASSWORD",
    "MYSQL_DATABASE",
    "MYSQL_DB",
    "COS_SECRET_ID",
    "COS_SECRET_KEY",
    "TENCENTCLOUD_SECRET_ID",
    "TENCENTCLOUD_SECRET_KEY",
    "COS_BUCKET",
    "TENCENT_COS_BUCKET",
    "COS_REGION",
    "TENCENT_COS_REGION",
    "COS_PREFIX",
    "COS_PUBLIC_BASE_URL",
    "OBJECT_STORAGE_PUBLIC_BASE_URL",
    "OBJECT_STORAGE_STRICT",
    "OBJECT_STORAGE_REMOTE_TIMEOUT_SECONDS",
    "OBJECT_STORAGE_REMOTE_MAX_BYTES",
]


def parse_env_file(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    for lineno, raw in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        match = re.match(r"^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*([=:])\s*(.*)$", line)
        if not match:
            print(f"[warn] skip malformed line {lineno}: {raw}", file=sys.stderr)
            continue
        key, sep, value = match.groups()
        if sep == ":":
            print(f"[warn] line {lineno} uses ':'; parsed as {key}=... but .env should use '='", file=sys.stderr)
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
            value = value[1:-1]
        values[key] = value
    return values


def is_secret(key: str) -> bool:
    upper = key.upper()
    return any(marker in upper for marker in SECRET_MARKERS)


def masked(key: str, value: str) -> str:
    if not value:
        return ""
    if is_secret(key):
        return f"<redacted:{len(value)} chars>"
    return value


def risk_checks(env: dict[str, str]) -> list[str]:
    risks: list[str] = []
    public_base = env.get("PUBLIC_BASE_URL", "")
    kl_proxy = env.get("KL_PROXY_URL", "")
    admin_password = env.get("ADMIN_PASSWORD", "")
    if public_base.startswith(("http://127.", "http://localhost", "http://0.0.0.0", "http://192.168.", "http://10.")):
        risks.append("PUBLIC_BASE_URL points to local/LAN address; cloud hosting and real devices should use HTTPS cloud domain.")
    elif public_base.startswith("http://"):
        risks.append("PUBLIC_BASE_URL is not HTTPS; official mini-program requests may be blocked.")
    if kl_proxy.startswith(("http://127.", "http://localhost", "http://0.0.0.0")):
        risks.append("KL_PROXY_URL points to localhost; cloud container cannot reach your laptop proxy.")
    if env.get("AI_MOCK_GENERATION") == "1":
        risks.append("AI_MOCK_GENERATION=1; cloud will return mock images instead of real KL generation.")
    if env.get("AI_UNLIMITED_CREDITS") == "1":
        risks.append("AI_UNLIMITED_CREDITS=1; production billing/credit consumption is disabled.")
    if admin_password == "admin123":
        risks.append("ADMIN_PASSWORD is default admin123; change it before exposing admin page.")
    if env.get("OBJECT_STORAGE_STRICT") != "1":
        risks.append("OBJECT_STORAGE_STRICT is not 1; COS failures may fall back to container local files.")
    cos_public_base = env.get("COS_PUBLIC_BASE_URL") or env.get("OBJECT_STORAGE_PUBLIC_BASE_URL") or ""
    if cos_public_base.startswith("http://"):
        risks.append("COS public base URL is not HTTPS; mini-program image loading may fail.")
    return risks


def selected_env(values: dict[str, str], include_extra: bool) -> dict[str, str]:
    result = {key: values[key] for key in DEFAULT_KEYS if values.get(key, "") != ""}
    if include_extra:
        for key, value in values.items():
            if key not in result and value != "":
                result[key] = value
    return result


def build_env_params(env: dict[str, str]) -> str:
    return "&".join(f"{quote_plus(key)}={quote_plus(value)}" for key, value in env.items())


def print_preview(env: dict[str, str], risks: list[str]) -> None:
    print("Cloud Run environment variables to sync:")
    for key in env:
        print(f"  {key}={masked(key, env[key])}")
    if risks:
        print("\nRisk warnings:")
        for item in risks:
            print(f"  - {item}")


def main() -> int:
    parser = argparse.ArgumentParser(description="Sync local .env variables to WeChat CloudBase Run service config.")
    parser.add_argument("--env-file", default=".env", help="dotenv file path, default: .env")
    parser.add_argument("--env-id", help="CloudBase environment ID")
    parser.add_argument("--service-name", help="CloudBase Run service name")
    parser.add_argument("--apply", action="store_true", help="Apply with tcb run service:config")
    parser.add_argument("--allow-risk", action="store_true", help="Allow applying risky local/dev values")
    parser.add_argument("--include-extra", action="store_true", help="Include non-whitelisted variables from env file")
    parser.add_argument("--print-envparams", action="store_true", help="Print raw envParams string; contains secrets")
    args = parser.parse_args()

    env_path = Path(args.env_file)
    if not env_path.exists():
        print(f"[error] env file not found: {env_path}", file=sys.stderr)
        return 2

    values = parse_env_file(env_path)
    env = selected_env(values, args.include_extra)
    risks = risk_checks(env)
    print_preview(env, risks)

    if args.print_envparams:
        print("\nRaw envParams, contains secrets:")
        print(build_env_params(env))

    if not args.apply:
        print("\nDry run only. To apply:")
        print("  python3 scripts/sync_cloudrun_env.py --env-id <envId> --service-name <serviceName> --apply")
        return 0

    if risks and not args.allow_risk:
        print("\n[error] risky values detected; fix .env or add --allow-risk to apply anyway.", file=sys.stderr)
        return 3
    if not args.env_id or not args.service_name:
        print("[error] --env-id and --service-name are required with --apply", file=sys.stderr)
        return 2

    cmd = [
        "tcb",
        "run",
        "service:config",
        "-e",
        args.env_id,
        "-s",
        args.service_name,
        "--envParams",
        build_env_params(env),
        "--json",
    ]
    print("\nApplying with command:")
    print("  " + " ".join(shlex.quote(part) if part != cmd[-2] else "'<redacted-envParams>'" for part in cmd))
    completed = subprocess.run(cmd, check=False)
    return completed.returncode


if __name__ == "__main__":
    raise SystemExit(main())
