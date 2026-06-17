#!/usr/bin/env python3

import argparse
import json
import platform
import sys
import threading
from pathlib import Path
from typing import Dict, Optional, Tuple

PHOTOS_ACCESS_LEVEL_READ_WRITE = 2


def load_photos_runtime() -> Tuple[dict, Optional[Dict[str, object]]]:
    runtime = {
        "platform": platform.system(),
        "pyobjc_available": False,
        "photos_framework_available": False,
        "photos_runtime_loaded": False,
        "framework_connection": "unavailable",
        "errors": [],
    }

    if runtime["platform"] != "Darwin":
        runtime["errors"].append("Apple Photos framework is only available on macOS.")
        return runtime, None

    try:
        import objc  # type: ignore

        runtime["pyobjc_available"] = True
    except ImportError as error:
        runtime["errors"].append(f"PyObjC import failed: {error}")
        return runtime, None

    try:
        from Photos import PHAsset, PHPhotoLibrary  # type: ignore

        runtime["photos_framework_available"] = True
        runtime["photos_runtime_loaded"] = True
        runtime["framework_connection"] = "connected"
        return runtime, {
            "objc": objc,
            "PHAsset": PHAsset,
            "PHPhotoLibrary": PHPhotoLibrary,
        }
    except ImportError as error:
        runtime["errors"].append(f"Photos framework import failed: {error}")
        runtime["framework_connection"] = "pyobjc-loaded-framework-missing"
        return runtime, None


def build_base_payload(command: str) -> dict:
    runtime, modules = load_photos_runtime()
    connect_ready = bool(modules)
    payload = {
        "ok": connect_ready,
        "phase": "ingestion",
        "implemented": True,
        "command": command,
        "bridge": "python-photos-bridge",
        "bridge_mode": "native-runtime",
        "notes": [
            "Phase 3 runtime probes the native Photos framework directly through PyObjC when available.",
            "Permission request now runs inside the Python bridge so TCC prompting stays on the native Photos access path.",
            "Asset enumeration, iCloud-backed extraction, and album mutation continue as separate checklist steps.",
        ],
        "direct_api_calls_implemented": connect_ready,
        "platform": runtime["platform"],
        "pyobjc_available": runtime["pyobjc_available"],
        "photos_framework_available": runtime["photos_framework_available"],
        "photos_runtime_loaded": runtime["photos_runtime_loaded"],
        "framework_connection": runtime["framework_connection"],
        "errors": runtime["errors"],
    }
    return payload


def normalize_permission_status(raw_status: int) -> str:
    status_map = {
        0: "not_determined",
        1: "restricted",
        2: "denied",
        3: "authorized",
        4: "limited",
    }
    return status_map.get(raw_status, f"unknown:{raw_status}")


def get_authorization_status(modules: Optional[Dict[str, object]]) -> Tuple[str, Optional[int]]:
    if not modules:
        return "unavailable", None

    PHPhotoLibrary = modules["PHPhotoLibrary"]

    if hasattr(PHPhotoLibrary, "authorizationStatusForAccessLevel_"):
        raw_status = int(
            PHPhotoLibrary.authorizationStatusForAccessLevel_(
                PHOTOS_ACCESS_LEVEL_READ_WRITE
            )
        )
    else:
        raw_status = int(PHPhotoLibrary.authorizationStatus())

    return normalize_permission_status(raw_status), raw_status


def probe_library_access(
    permission_status: str, modules: Optional[Dict[str, object]]
) -> Tuple[str, Optional[int]]:
    if not modules:
        return "unavailable", None

    if permission_status not in {"authorized", "limited"}:
        return "blocked_by_permission", None

    PHAsset = modules["PHAsset"]
    fetch_result = PHAsset.fetchAssetsWithOptions_(None)
    return "connected", int(fetch_result.count())


def request_authorization(modules: Optional[Dict[str, object]]) -> dict:
    if not modules:
        return {
            "request_supported": False,
            "request_invoked": False,
            "prompt_eligible": False,
            "status_before": "unavailable",
            "raw_status_before": None,
            "status_after": "unavailable",
            "raw_status_after": None,
            "timeout": False,
            "errors": ["Photos runtime unavailable; cannot request authorization."],
        }

    PHPhotoLibrary = modules["PHPhotoLibrary"]
    status_before, raw_status_before = get_authorization_status(modules)
    prompt_eligible = status_before == "not_determined"

    result = {
        "request_supported": True,
        "request_invoked": False,
        "prompt_eligible": prompt_eligible,
        "status_before": status_before,
        "raw_status_before": raw_status_before,
        "status_after": status_before,
        "raw_status_after": raw_status_before,
        "timeout": False,
        "errors": [],
    }

    completion_event = threading.Event()
    callback_state = {"raw_status": raw_status_before}

    def handler(raw_status: int) -> None:
        callback_state["raw_status"] = int(raw_status)
        completion_event.set()

    try:
        if hasattr(PHPhotoLibrary, "requestAuthorizationForAccessLevel_handler_"):
            PHPhotoLibrary.requestAuthorizationForAccessLevel_handler_(
                PHOTOS_ACCESS_LEVEL_READ_WRITE, handler
            )
        elif hasattr(PHPhotoLibrary, "requestAuthorization_"):
            PHPhotoLibrary.requestAuthorization_(handler)
        else:
            result["request_supported"] = False
            result["errors"].append(
                "PHPhotoLibrary authorization request API is unavailable in this runtime."
            )
            return result

        result["request_invoked"] = True
    except Exception as error:  # pragma: no cover - native bridge failure path
        result["errors"].append(f"Authorization request failed: {error}")
        return result

    if not completion_event.wait(timeout=30):
        result["timeout"] = True
        result["errors"].append(
            "Timed out while waiting for Photos authorization callback."
        )

    status_after, raw_status_after = get_authorization_status(modules)
    callback_raw_status = callback_state["raw_status"]
    if raw_status_after is None and callback_raw_status is not None:
        raw_status_after = callback_raw_status
        status_after = normalize_permission_status(callback_raw_status)

    result.update(
        {
            "status_after": status_after,
            "raw_status_after": raw_status_after,
        }
    )
    return result


def handle_check_access() -> dict:
    payload = build_base_payload("check-access")
    _, modules = load_photos_runtime()
    permission_status, raw_status = get_authorization_status(modules)
    library_access, asset_count_probe = probe_library_access(permission_status, modules)

    payload.update(
        {
            "permission_status": permission_status,
            "permission_status_raw": raw_status,
            "library_access": library_access,
            "asset_count_probe": asset_count_probe,
        }
    )
    return payload


def handle_request_access() -> dict:
    payload = build_base_payload("request-access")
    _, modules = load_photos_runtime()
    request_state = request_authorization(modules)
    library_access_after, asset_count_probe_after = probe_library_access(
        request_state["status_after"], modules
    )

    payload.update(
        {
            "ok": request_state["status_after"] in {"authorized", "limited"},
            "permission_status": request_state["status_after"],
            "permission_status_raw": request_state["raw_status_after"],
            "permission_status_before": request_state["status_before"],
            "permission_status_raw_before": request_state["raw_status_before"],
            "permission_status_after": request_state["status_after"],
            "permission_status_raw_after": request_state["raw_status_after"],
            "tcc_prompt_eligible": request_state["prompt_eligible"],
            "tcc_prompt_requested": request_state["request_invoked"],
            "authorization_request_supported": request_state["request_supported"],
            "authorization_request_timed_out": request_state["timeout"],
            "library_access": library_access_after,
            "library_access_after": library_access_after,
            "asset_count_probe": asset_count_probe_after,
            "asset_count_probe_after": asset_count_probe_after,
            "errors": payload["errors"] + request_state["errors"],
            "notes": payload["notes"]
            + [
                "A native TCC popup is only expected when permission status was not_determined before the request.",
                "If status was already authorized, denied, restricted, or limited, macOS usually reuses the stored decision without showing a new popup.",
            ],
        }
    )
    return payload


def handle_scan_assets() -> dict:
    payload = build_base_payload("scan-assets")
    _, modules = load_photos_runtime()
    permission_status, raw_status = get_authorization_status(modules)
    library_access, asset_count_probe = probe_library_access(permission_status, modules)

    payload.update(
        {
            "permission_status": permission_status,
            "permission_status_raw": raw_status,
            "library_access": library_access,
            "asset_count_probe": asset_count_probe,
            "asset_count": 0,
            "valid_asset_count": 0,
            "assets": [],
            "implemented": False,
            "notes": payload["notes"]
            + [
                "Asset enumeration remains a separate Phase 3 checklist step; scan currently reports connection readiness only.",
            ],
        }
    )
    return payload


def handle_debug_access() -> dict:
    payload = build_base_payload("debug-access")
    runtime, modules = load_photos_runtime()
    permission_status, raw_status = get_authorization_status(modules)
    library_access, asset_count_probe = probe_library_access(permission_status, modules)

    payload.update(
        {
            "permission_status": permission_status,
            "permission_status_raw": raw_status,
            "library_access": library_access,
            "asset_count_probe": asset_count_probe,
            "python_executable": sys.executable,
            "bridge_script": str(Path(__file__).resolve()),
            "runtime_errors": runtime["errors"],
        }
    )
    return payload


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "command",
        choices=["check-access", "request-access", "scan-assets", "debug-access"],
    )
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()

    handlers = {
        "check-access": handle_check_access,
        "request-access": handle_request_access,
        "scan-assets": handle_scan_assets,
        "debug-access": handle_debug_access,
    }
    payload = handlers[args.command]()

    print(json.dumps(payload, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
