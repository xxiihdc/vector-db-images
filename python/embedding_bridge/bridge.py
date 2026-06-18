#!/usr/bin/env python3

import argparse
import base64
import importlib.util
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


def has_optional_module(module_name: str) -> bool:
    return importlib.util.find_spec(module_name) is not None


def build_candidate_requirements(payload: Dict[str, Any]) -> List[Dict[str, Any]]:
    requirements: List[Dict[str, Any]] = []

    if bool(payload.get("requires_timm")) and not has_optional_module("timm"):
        requirements.append(
            {
                "kind": "python-library",
                "name": "timm",
                "status": "missing",
                "install_command": "python3 -m pip install timm",
                "message": "Install timm because this OpenCLIP candidate depends on timm-backed vision model components.",
            }
        )

    if bool(payload.get("requires_transformers")) and not has_optional_module("transformers"):
        requirements.append(
            {
                "kind": "python-library",
                "name": "transformers",
                "status": "missing",
                "install_command": "python3 -m pip install transformers",
                "message": "Install transformers because this candidate uses a text tower that requires Hugging Face transformers.",
            }
        )

    return requirements


def build_candidate_metadata(payload: Dict[str, Any], provider: str, model: str, pretrained: str) -> Dict[str, Any]:
    target_resolution = int(payload.get("target_resolution") or 224)
    candidate_id = payload.get("candidate_id") or f"{provider}:{model}:{pretrained}:{target_resolution}"

    return {
        "candidate_id": candidate_id,
        "candidate_preset": payload.get("candidate_preset"),
        "target_resolution": target_resolution,
        "recommended_extractor_size": target_resolution,
        "requires_timm": bool(payload.get("requires_timm")),
        "requires_transformers": bool(payload.get("requires_transformers")),
    }


def classify_model_load_failure(error: Exception) -> List[Dict[str, Any]]:
    message = str(error)
    normalized = message.lower()
    requirements: List[Dict[str, Any]] = []

    if "timm" in normalized:
        requirements.append(
            {
                "kind": "python-library",
                "name": "timm",
                "status": "missing",
                "install_command": "python3 -m pip install timm",
                "message": "This model load failed because timm-backed components are unavailable.",
            }
        )

    if "transformers" in normalized:
        requirements.append(
            {
                "kind": "python-library",
                "name": "transformers",
                "status": "missing",
                "install_command": "python3 -m pip install transformers",
                "message": "This model load failed because transformers-backed text components are unavailable.",
            }
        )

    if not requirements:
        requirements.append(
            {
                "kind": "network-or-cache",
                "name": "pretrained model download",
                "status": "missing",
                "install_command": None,
                "message": "Ensure the machine has internet access on first run so OpenCLIP can download pretrained weights, or warm the cache ahead of time.",
            }
        )

    return requirements


def try_load_open_clip_model(
    runtime: Dict[str, Any],
    *,
    model: str,
    pretrained: str,
    runtime_device: str,
) -> Dict[str, Any]:
    open_clip = runtime["open_clip"]

    try:
        model_instance, _, _ = open_clip.create_model_and_transforms(
            model, pretrained=pretrained, device=runtime_device
        )
        model_instance.eval()
        return {
            "load_ok": True,
            "load_error": None,
            "requirements": [],
        }
    except Exception as error:
        return {
            "load_ok": False,
            "load_error": str(error),
            "requirements": classify_model_load_failure(error),
        }


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


def build_text_embedding_result(
    *,
    text: str,
    provider: str,
    model: str,
    pretrained: str,
    vector: Optional[List[float]],
    status: str,
    error_code: Optional[str] = None,
    error_message: Optional[str] = None,
) -> Dict[str, Any]:
    return {
        "text": text,
        "status": status,
        "embedding_provider": provider,
        "embedding_model": model,
        "model_identity": f"{provider}:{model}:{pretrained}",
        "vector": vector,
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
    result["requirements"] = build_runtime_requirements(runtime) + build_candidate_requirements(payload)
    result["candidate"] = build_candidate_metadata(payload, provider, model, pretrained)
    result["capabilities"] = {
      "torch_available": runtime["torch_available"],
      "open_clip_available": runtime["open_clip_available"],
      "pillow_available": runtime["pillow_available"],
      "runtime_device": select_runtime_device(runtime, device),
      "downloads_model_on_first_run": True,
      "recommended_extractor_size": result["candidate"]["recommended_extractor_size"],
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


def embed_text_query(payload: Dict[str, Any]) -> Dict[str, Any]:
    provider = str(payload.get("provider") or "open-clip")
    model = str(payload.get("model") or "ViT-B-32")
    pretrained = str(payload.get("pretrained") or "laion2b_s34b_b79k")
    device = str(payload.get("device") or "auto")
    normalize = bool(payload.get("normalize", True))
    query_text = str(payload.get("text") or "").strip()
    result = build_base_payload("embed-text-query", provider, model, pretrained)
    runtime = load_runtime()
    result["errors"].extend(runtime["errors"])
    result["requirements"] = build_runtime_requirements(runtime) + build_candidate_requirements(payload)
    result["candidate"] = build_candidate_metadata(payload, provider, model, pretrained)
    result["capabilities"] = {
        "torch_available": runtime["torch_available"],
        "open_clip_available": runtime["open_clip_available"],
        "pillow_available": runtime["pillow_available"],
        "runtime_device": select_runtime_device(runtime, device),
        "downloads_model_on_first_run": True,
        "recommended_extractor_size": result["candidate"]["recommended_extractor_size"],
    }

    if result["requirements"]:
        return result

    if not query_text:
        result["errors"].append("Query text is required for text embedding.")
        result["embedding"] = build_text_embedding_result(
            text=query_text,
            provider=provider,
            model=model,
            pretrained=pretrained,
            vector=None,
            status="failed",
            error_code="QUERY_TEXT_REQUIRED",
            error_message="Query text is required for text embedding.",
        )
        return result

    torch = runtime["torch"]
    open_clip = runtime["open_clip"]
    runtime_device = result["capabilities"]["runtime_device"]

    try:
        model_instance, _, _ = open_clip.create_model_and_transforms(
            model, pretrained=pretrained, device=runtime_device
        )
        tokenizer = open_clip.get_tokenizer(model)
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

    try:
        text_tokens = tokenizer([query_text]).to(runtime_device)
        with torch.no_grad():
            text_features = model_instance.encode_text(text_tokens)
            if normalize:
                text_features = text_features / text_features.norm(dim=-1, keepdim=True)

        vector = text_features[0].detach().cpu().tolist()
        result["embedding"] = build_text_embedding_result(
            text=query_text,
            provider=provider,
            model=model,
            pretrained=pretrained,
            vector=vector,
            status="ready",
        )
        result["notes"].append("Embedded the normalized text query in-memory without writing temp files.")
        result["ok"] = True
        return result
    except Exception as error:
        result["embedding"] = build_text_embedding_result(
            text=query_text,
            provider=provider,
            model=model,
            pretrained=pretrained,
            vector=None,
            status="failed",
            error_code="OPEN_CLIP_TEXT_EMBED_FAILED",
            error_message=str(error),
        )
        result["errors"].append(f"OpenCLIP text embedding failed: {error}")
        return result


def handle_capabilities(payload: Dict[str, Any]) -> Dict[str, Any]:
    provider = str(payload.get("provider") or "open-clip")
    model = str(payload.get("model") or "ViT-B-32")
    pretrained = str(payload.get("pretrained") or "laion2b_s34b_b79k")
    device = str(payload.get("device") or "auto")
    result = build_base_payload("capabilities", provider, model, pretrained)
    runtime = load_runtime()
    result["errors"].extend(runtime["errors"])
    result["requirements"] = build_runtime_requirements(runtime) + build_candidate_requirements(payload)
    result["candidate"] = build_candidate_metadata(payload, provider, model, pretrained)
    runtime_device = select_runtime_device(runtime, device)
    result["capabilities"] = {
        "platform": platform.system(),
        "torch_available": runtime["torch_available"],
        "open_clip_available": runtime["open_clip_available"],
        "pillow_available": runtime["pillow_available"],
        "runtime_device": runtime_device,
        "downloads_model_on_first_run": True,
        "recommended_extractor_size": result["candidate"]["recommended_extractor_size"],
        "load_ok": False,
        "load_error": None,
    }

    if len(result["requirements"]) == 0:
        load_state = try_load_open_clip_model(
            runtime,
            model=model,
            pretrained=pretrained,
            runtime_device=runtime_device,
        )
        result["capabilities"]["load_ok"] = load_state["load_ok"]
        result["capabilities"]["load_error"] = load_state["load_error"]
        result["requirements"].extend(load_state["requirements"])

    result["ok"] = len(result["requirements"]) == 0 and result["capabilities"]["load_ok"] is True
    return result


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=["capabilities", "embed-image-batch", "embed-text-query"])
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()
    payload = read_stdin_payload()

    handlers = {
        "capabilities": handle_capabilities,
        "embed-image-batch": embed_image_batch,
        "embed-text-query": embed_text_query,
    }
    result = handlers[args.command](payload)
    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
