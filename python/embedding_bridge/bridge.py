#!/usr/bin/env python3

import argparse
import base64
import json
import platform
import sys
from io import BytesIO
from typing import Any, Dict, List, Optional


def read_stdin_payload() -> Dict[str, Any]:
    raw = sys.stdin.read().strip()
    if not raw:
        return {}
    return json.loads(raw)


def build_base_payload(command: str, provider: str, model: str, pretrained: str) -> Dict[str, Any]:
    return {
        "ok": False,
        "command": command,
        "provider": provider,
        "model": model,
        "pretrained": pretrained,
        "model_identity": f"{provider}:{model}:{pretrained}",
        "platform": platform.system(),
        "embeddings": [],
        "errors": [],
        "requirements": [],
        "notes": [
            "Embedding bridge keeps representation bytes in-memory through stdin/stdout JSON payloads.",
            "OpenCLIP can download pretrained weights on first use, so no separate local model bundle is required.",
        ],
    }


def load_runtime() -> Dict[str, Any]:
    runtime: Dict[str, Any] = {
        "torch_available": False,
        "open_clip_available": False,
        "pillow_available": False,
        "errors": [],
    }

    try:
        import torch  # type: ignore

        runtime["torch_available"] = True
        runtime["torch"] = torch
    except ImportError as error:
        runtime["errors"].append(f"PyTorch import failed: {error}")

    try:
        import open_clip  # type: ignore

        runtime["open_clip_available"] = True
        runtime["open_clip"] = open_clip
    except ImportError as error:
        runtime["errors"].append(f"open_clip import failed: {error}")

    try:
        from PIL import Image  # type: ignore

        runtime["pillow_available"] = True
        runtime["Image"] = Image
    except ImportError as error:
        runtime["errors"].append(f"Pillow import failed: {error}")

    return runtime


def select_runtime_device(runtime: Dict[str, Any], requested_device: str) -> str:
    if requested_device and requested_device != "auto":
        return requested_device

    if runtime.get("torch_available"):
        torch = runtime["torch"]
        if getattr(torch.backends, "mps", None) and torch.backends.mps.is_available():
            return "mps"
        if torch.cuda.is_available():
            return "cuda"

    return "cpu"


def build_runtime_requirements(runtime: Dict[str, Any]) -> List[Dict[str, Any]]:
    requirements: List[Dict[str, Any]] = []

    if not runtime["torch_available"]:
        requirements.append(
            {
                "kind": "python-library",
                "name": "torch",
                "status": "missing",
                "install_command": "python3 -m pip install torch",
                "message": "Install PyTorch so OpenCLIP can run local embeddings.",
            }
        )

    if not runtime["open_clip_available"]:
        requirements.append(
            {
                "kind": "python-library",
                "name": "open_clip_torch",
                "status": "missing",
                "install_command": "python3 -m pip install open_clip_torch",
                "message": "Install OpenCLIP so the provider can auto-download and run pretrained CLIP checkpoints.",
            }
        )

    if not runtime["pillow_available"]:
        requirements.append(
            {
                "kind": "python-library",
                "name": "Pillow",
                "status": "missing",
                "install_command": "python3 -m pip install Pillow",
                "message": "Install Pillow so the bridge can decode in-memory image bytes before embedding.",
            }
        )

    return requirements


def decode_representation_image(runtime: Dict[str, Any], bytes_base64: str):
    image_bytes = base64.b64decode(bytes_base64)
    image = runtime["Image"].open(BytesIO(image_bytes))
    return image.convert("RGB")


def build_failed_embedding(
    representation: Dict[str, Any],
    provider: str,
    model: str,
    pretrained: str,
    error_code: str,
    error_message: str,
) -> Dict[str, Any]:
    return {
        "local_identifier": representation.get("local_identifier"),
        "representation_kind": representation.get("representation_kind"),
        "status": "failed",
        "embedding_provider": provider,
        "embedding_model": model,
        "model_identity": f"{provider}:{model}:{pretrained}",
        "vector": None,
        "error_code": error_code,
        "error_message": error_message,
    }


def embed_image_batch(payload: Dict[str, Any]) -> Dict[str, Any]:
    provider = str(payload.get("provider") or "open-clip")
    model = str(payload.get("model") or "ViT-B-32")
    pretrained = str(payload.get("pretrained") or "laion2b_s34b_b79k")
    device = str(payload.get("device") or "auto")
    normalize = bool(payload.get("normalize", True))
    result = build_base_payload("embed-image-batch", provider, model, pretrained)
    runtime = load_runtime()
    result["errors"].extend(runtime["errors"])
    result["requirements"] = build_runtime_requirements(runtime)
    result["capabilities"] = {
      "torch_available": runtime["torch_available"],
      "open_clip_available": runtime["open_clip_available"],
      "pillow_available": runtime["pillow_available"],
      "runtime_device": select_runtime_device(runtime, device),
      "downloads_model_on_first_run": True,
    }

    if result["requirements"]:
        return result

    torch = runtime["torch"]
    open_clip = runtime["open_clip"]
    runtime_device = result["capabilities"]["runtime_device"]

    try:
        model_instance, _, preprocess = open_clip.create_model_and_transforms(
            model, pretrained=pretrained, device=runtime_device
        )
        model_instance.eval()
    except Exception as error:
        result["errors"].append(f"OpenCLIP model load failed: {error}")
        result["requirements"].append(
            {
                "kind": "network-or-cache",
                "name": "pretrained model download",
                "status": "missing",
                "install_command": None,
                "message": "Ensure the machine has internet access on first run so OpenCLIP can download pretrained weights, or warm the cache ahead of time.",
            }
        )
        return result

    embeddings = []
    prepared_batch = []
    for representation in payload.get("representations") or []:
        try:
            image = decode_representation_image(runtime, representation["bytes_base64"])
            prepared_batch.append(
                {
                    "representation": representation,
                    "image_tensor": preprocess(image),
                }
            )
        except Exception as error:
            embeddings.append(
                build_failed_embedding(
                    representation,
                    provider,
                    model,
                    pretrained,
                    "OPEN_CLIP_IMAGE_DECODE_FAILED",
                    str(error),
                )
            )

    if prepared_batch:
        try:
            image_tensor_batch = torch.stack(
                [item["image_tensor"] for item in prepared_batch]
            ).to(runtime_device)
            with torch.no_grad():
                image_features = model_instance.encode_image(image_tensor_batch)
                if normalize:
                    image_features = image_features / image_features.norm(dim=-1, keepdim=True)

            vectors = image_features.detach().cpu().tolist()
            for item, vector in zip(prepared_batch, vectors):
                representation = item["representation"]
                embeddings.append(
                    {
                        "local_identifier": representation.get("local_identifier"),
                        "representation_kind": representation.get("representation_kind"),
                        "status": "ready",
                        "embedding_provider": provider,
                        "embedding_model": model,
                        "model_identity": f"{provider}:{model}:{pretrained}",
                        "vector": vector,
                        "error_code": None,
                        "error_message": None,
                    }
                )
        except Exception as error:
            embeddings.extend(
                [
                    build_failed_embedding(
                        item["representation"],
                        provider,
                        model,
                        pretrained,
                        "OPEN_CLIP_EMBED_FAILED",
                        str(error),
                    )
                    for item in prepared_batch
                ]
            )

    result["embeddings"] = embeddings
    result["notes"].append(
        f"Embedded {len(prepared_batch)} image-like representation(s) in a single in-memory batch."
    )
    result["ok"] = all(item.get("status") == "ready" for item in embeddings)
    return result


def handle_capabilities(payload: Dict[str, Any]) -> Dict[str, Any]:
    provider = str(payload.get("provider") or "open-clip")
    model = str(payload.get("model") or "ViT-B-32")
    pretrained = str(payload.get("pretrained") or "laion2b_s34b_b79k")
    device = str(payload.get("device") or "auto")
    result = build_base_payload("capabilities", provider, model, pretrained)
    runtime = load_runtime()
    result["errors"].extend(runtime["errors"])
    result["requirements"] = build_runtime_requirements(runtime)
    result["capabilities"] = {
        "platform": platform.system(),
        "torch_available": runtime["torch_available"],
        "open_clip_available": runtime["open_clip_available"],
        "pillow_available": runtime["pillow_available"],
        "runtime_device": select_runtime_device(runtime, device),
        "downloads_model_on_first_run": True,
    }
    result["ok"] = len(result["requirements"]) == 0
    return result


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=["capabilities", "embed-image-batch"])
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()
    payload = read_stdin_payload()

    handlers = {
        "capabilities": handle_capabilities,
        "embed-image-batch": embed_image_batch,
    }
    result = handlers[args.command](payload)
    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
