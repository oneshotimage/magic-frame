#!/usr/bin/env sh
set -eu

#python3 -m uvicorn backend.main:app --host 0.0.0.0 --port "${PORT:-80}"

KL_API_TOKEN='sk-BJSYXeru9ZW3Y6GGuT36WfpU8tGmJkh4nvASph4QSV4vxoYZ' \
PUBLIC_BASE_URL='http://192.168.2.65:8000' \
python3 -m uvicorn backend.main:app --host 0.0.0.0 --port 8000 --reload
