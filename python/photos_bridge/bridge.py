#!/usr/bin/env python3

import argparse
import json
import sys
from pathlib import Path


def build_base_payload(command: str) -> dict:
    return {
        "ok": True,
        "phase": "scaffold",
        "implemented": False,
        "command": command,
        "bridge": "python-photos-bridge",
        "bridge_mode": "placeholder",
        "notes": [
            "Phase 2 scaffold is wired end-to-end, but direct Photos framework access starts in Phase 3.",
            "This bridge intentionally returns diagnostics-only payloads until PyObjC integration is implemented.",
        ],
    }


def handle_check_access() -> dict:
    payload = build_base_payload("check-access")
    payload.update(
        {
            "permission_status": "unknown",
            "library_access": "not-implemented",
            "direct_api_calls_implemented": False,
        }
    )
    return payload


def handle_scan_assets() -> dict:
    payload = build_base_payload("scan-assets")
    payload.update(
        {
            "permission_status": "unknown",
            "library_access": "not-implemented",
            "asset_count": 0,
            "valid_asset_count": 0,
            "assets": [],
        }
    )
    return payload


def handle_debug_access() -> dict:
    payload = build_base_payload("debug-access")
    payload.update(
        {
            "permission_status": "unknown",
            "library_access": "not-implemented",
            "python_executable": sys.executable,
            "bridge_script": str(Path(__file__).resolve()),
            "direct_api_calls_implemented": False,
        }
    )
    return payload


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "command",
        choices=["check-access", "scan-assets", "debug-access"],
    )
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()

    handlers = {
        "check-access": handle_check_access,
        "scan-assets": handle_scan_assets,
        "debug-access": handle_debug_access,
    }
    payload = handlers[args.command]()

    print(json.dumps(payload, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
