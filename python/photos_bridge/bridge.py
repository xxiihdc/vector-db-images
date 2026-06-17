#!/usr/bin/env python3

import argparse
import base64
import hashlib
import json
import platform
import sys
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional, Tuple

PHOTOS_ACCESS_LEVEL_READ_WRITE = 2
DEFAULT_PROBE_LIMIT = 5
DEFAULT_PROBE_BYTE_LIMIT = 64 * 1024
DEFAULT_PROBE_TIMEOUT_SECONDS = 30
DEFAULT_EXTRACT_LIMIT = 10
DEFAULT_THUMBNAIL_SIZE = 224
DEFAULT_EXTRACT_TIMEOUT_SECONDS = 30


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
        import Photos  # type: ignore
        from Photos import (  # type: ignore
            PHAsset,
            PHAssetResource,
            PHAssetResourceManager,
            PHAssetResourceRequestOptions,
            PHFetchOptions,
            PHImageManager,
            PHImageRequestOptions,
            PHPhotoLibrary,
            PHVideoRequestOptions,
        )
        from Foundation import NSSortDescriptor  # type: ignore

        runtime["photos_framework_available"] = True
        runtime["photos_runtime_loaded"] = True
        runtime["framework_connection"] = "connected"
        return runtime, {
            "objc": objc,
            "Photos": Photos,
            "PHAsset": PHAsset,
            "PHAssetResource": PHAssetResource,
            "PHAssetResourceManager": PHAssetResourceManager,
            "PHAssetResourceRequestOptions": PHAssetResourceRequestOptions,
            "PHFetchOptions": PHFetchOptions,
            "PHImageManager": PHImageManager,
            "PHImageRequestOptions": PHImageRequestOptions,
            "PHPhotoLibrary": PHPhotoLibrary,
            "PHVideoRequestOptions": PHVideoRequestOptions,
            "NSSortDescriptor": NSSortDescriptor,
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


def read_native_member(obj: object, name: str):
    value = getattr(obj, name, None)
    if callable(value):
        return value()
    return value


def read_native_key_value(obj: object, key: str):
    reader = getattr(obj, "valueForKey_", None)
    if not callable(reader):
        return None

    try:
        return reader(key)
    except Exception:
        return None


def isoformat_native_date(value: object) -> Optional[str]:
    if value is None:
        return None

    if hasattr(value, "timeIntervalSince1970"):
        timestamp = float(value.timeIntervalSince1970())
        return datetime.fromtimestamp(timestamp, tz=timezone.utc).isoformat(
            timespec="milliseconds"
        ).replace("+00:00", "Z")

    return str(value)


def build_asset_id(local_identifier: str) -> str:
    digest = hashlib.sha256(local_identifier.encode("utf-8")).hexdigest()
    return f"asset:{digest}"


def normalize_asset_type(asset: object, modules: Dict[str, object]) -> Optional[str]:
    photos_module = modules["Photos"]
    media_type = int(read_native_member(asset, "mediaType"))
    image_constant = int(getattr(photos_module, "PHAssetMediaTypeImage", 1))
    video_constant = int(getattr(photos_module, "PHAssetMediaTypeVideo", 2))

    if media_type == image_constant:
        return "image"

    if media_type == video_constant:
        return "video"

    return None


def normalize_media_subtypes(asset: object, modules: Dict[str, object]) -> List[str]:
    photos_module = modules["Photos"]
    raw_subtypes = int(read_native_member(asset, "mediaSubtypes"))

    subtype_labels = [
        ("PHAssetMediaSubtypePhotoPanorama", "panorama"),
        ("PHAssetMediaSubtypePhotoHDR", "hdr"),
        ("PHAssetMediaSubtypePhotoScreenshot", "screenshot"),
        ("PHAssetMediaSubtypePhotoLive", "live-photo"),
        ("PHAssetMediaSubtypePhotoDepthEffect", "depth-effect"),
        ("PHAssetMediaSubtypePhotoAnimated", "animated"),
        ("PHAssetMediaSubtypeVideoStreamed", "streamed"),
        ("PHAssetMediaSubtypeVideoHighFrameRate", "high-frame-rate"),
        ("PHAssetMediaSubtypeVideoTimelapse", "timelapse"),
    ]

    normalized = []
    recognized_mask = 0

    for constant_name, label in subtype_labels:
        constant_value = getattr(photos_module, constant_name, None)
        if constant_value is None:
            continue

        normalized_value = int(constant_value)
        if normalized_value and raw_subtypes & normalized_value:
            normalized.append(label)
            recognized_mask |= normalized_value

    remaining_mask = raw_subtypes & ~recognized_mask
    if remaining_mask:
        normalized.append(f"raw:{remaining_mask}")

    return normalized


def build_source_fingerprint(payload: dict) -> str:
    duration = (
        ""
        if payload["duration_seconds"] is None
        else f"{payload['duration_seconds']:.3f}".rstrip("0").rstrip(".")
    )
    return "|".join(
        [
            payload["modification_date"] or "",
            str(payload["pixel_width"] or ""),
            str(payload["pixel_height"] or ""),
            payload["asset_type"] or "",
            duration,
        ]
    )


def build_representation_digest(data_bytes: bytes) -> str:
    return hashlib.sha256(data_bytes).hexdigest()


def normalize_asset(asset: object, modules: Dict[str, object]) -> Optional[dict]:
    local_identifier = read_native_member(asset, "localIdentifier")
    if not local_identifier:
        return None

    asset_type = normalize_asset_type(asset, modules)
    if asset_type not in {"image", "video"}:
        return None

    duration_seconds = float(read_native_member(asset, "duration"))
    if asset_type != "video":
        duration_seconds = None

    payload = {
        "asset_id": build_asset_id(local_identifier),
        "local_identifier": local_identifier,
        "asset_type": asset_type,
        "media_subtypes": normalize_media_subtypes(asset, modules),
        "source": "photos",
        "favorite": bool(read_native_member(asset, "favorite")),
        "hidden": bool(read_native_member(asset, "hidden")),
        "pixel_width": int(read_native_member(asset, "pixelWidth")),
        "pixel_height": int(read_native_member(asset, "pixelHeight")),
        "duration_seconds": duration_seconds,
        "creation_date": isoformat_native_date(read_native_member(asset, "creationDate")),
        "modification_date": isoformat_native_date(
            read_native_member(asset, "modificationDate")
        ),
        "is_in_icloud": None,
    }
    payload["source_fingerprint"] = build_source_fingerprint(payload)
    return payload


def get_asset_resources(asset: object, modules: Dict[str, object]) -> List[object]:
    PHAssetResource = modules["PHAssetResource"]
    resources = PHAssetResource.assetResourcesForAsset_(asset)
    if resources is None:
        return []

    count = int(resources.count())
    return [resources.objectAtIndex_(index) for index in range(count)]


def normalize_resource_type_label(resource: object, modules: Dict[str, object]) -> str:
    photos_module = modules["Photos"]
    raw_type = int(read_native_member(resource, "type"))

    resource_labels = {
        int(getattr(photos_module, "PHAssetResourceTypePhoto", 1)): "photo",
        int(getattr(photos_module, "PHAssetResourceTypeVideo", 2)): "video",
        int(getattr(photos_module, "PHAssetResourceTypeAudio", 3)): "audio",
        int(getattr(photos_module, "PHAssetResourceTypeAlternatePhoto", 4)): "alternate-photo",
        int(getattr(photos_module, "PHAssetResourceTypeFullSizePhoto", 5)): "full-size-photo",
        int(getattr(photos_module, "PHAssetResourceTypeFullSizeVideo", 6)): "full-size-video",
        int(getattr(photos_module, "PHAssetResourceTypeAdjustmentData", 7)): "adjustment-data",
        int(getattr(photos_module, "PHAssetResourceTypeAdjustmentBasePhoto", 8)): "adjustment-base-photo",
        int(getattr(photos_module, "PHAssetResourceTypePairedVideo", 9)): "paired-video",
        int(getattr(photos_module, "PHAssetResourceTypeFullSizePairedVideo", 10)): "full-size-paired-video",
        int(getattr(photos_module, "PHAssetResourceTypeAdjustmentBasePairedVideo", 11)): "adjustment-base-paired-video",
    }
    return resource_labels.get(raw_type, f"unknown:{raw_type}")


def is_resource_locally_available(resource: object) -> Optional[bool]:
    for key in ("locallyAvailable", "isLocallyAvailable"):
        value = read_native_key_value(resource, key)
        if value is None:
            continue
        return bool(value)

    return None


def classify_asset_cloud_state(resources: List[object]) -> Optional[bool]:
    if not resources:
        return None

    local_flags = [is_resource_locally_available(resource) for resource in resources]
    known_flags = [flag for flag in local_flags if flag is not None]
    if not known_flags:
        return None

    return not all(known_flags)


def normalize_resource(resource: object, modules: Dict[str, object]) -> dict:
    return {
        "resource_type": normalize_resource_type_label(resource, modules),
        "original_filename": read_native_member(resource, "originalFilename"),
        "uniform_type_identifier": read_native_member(resource, "uniformTypeIdentifier"),
        "locally_available": is_resource_locally_available(resource),
    }


def select_primary_resource(
    asset_type: str, resources: List[object], modules: Dict[str, object]
) -> Optional[object]:
    preferred_by_type = {
        "image": [
            "full-size-photo",
            "photo",
            "alternate-photo",
        ],
        "video": [
            "full-size-video",
            "video",
            "paired-video",
            "full-size-paired-video",
        ],
    }
    preferred_labels = preferred_by_type.get(asset_type, [])

    for preferred_label in preferred_labels:
        for resource in resources:
            if normalize_resource_type_label(resource, modules) == preferred_label:
                return resource

    return resources[0] if resources else None


def build_recent_assets_fetch_result(modules: Dict[str, object]):
    PHFetchOptions = modules["PHFetchOptions"]
    PHAsset = modules["PHAsset"]
    NSSortDescriptor = modules["NSSortDescriptor"]

    fetch_options = PHFetchOptions.alloc().init()
    fetch_options.setSortDescriptors_(
        [NSSortDescriptor.sortDescriptorWithKey_ascending_("creationDate", False)]
    )
    return PHAsset.fetchAssetsWithOptions_(fetch_options)


def info_value(info: object, key: str):
    if info is None:
        return None

    try:
        return info.get(key)
    except Exception:
        return read_native_key_value(info, key)


def encode_bytes_payload(data_bytes: bytes) -> dict:
    return {
        "byte_length": len(data_bytes),
        "bytes_base64": base64.b64encode(data_bytes).decode("ascii"),
        "sha256": build_representation_digest(data_bytes),
    }


def nsdata_to_bytes(data: object) -> bytes:
    if data is None:
        return b""

    if isinstance(data, (bytes, bytearray)):
        return bytes(data)

    return bytes(data)


def encode_nsimage_to_jpeg_bytes(image: object) -> Tuple[bytes, int, int]:
    from AppKit import NSBitmapImageFileTypeJPEG, NSBitmapImageRep  # type: ignore

    if image is None:
        return b"", 0, 0

    tiff_data = image.TIFFRepresentation()
    if tiff_data is None:
        return b"", 0, 0

    bitmap = NSBitmapImageRep.imageRepWithData_(tiff_data)
    if bitmap is None:
        return b"", 0, 0

    jpeg_data = bitmap.representationUsingType_properties_(
        NSBitmapImageFileTypeJPEG, {}
    )
    return (
        nsdata_to_bytes(jpeg_data),
        int(bitmap.pixelsWide()),
        int(bitmap.pixelsHigh()),
    )


def encode_cgimage_to_jpeg_bytes(image: object) -> Tuple[bytes, int, int]:
    try:
        from Foundation import NSMutableData  # type: ignore
        from Quartz import (  # type: ignore
            CGImageDestinationAddImage,
            CGImageDestinationCreateWithData,
            CGImageDestinationFinalize,
            CGImageGetHeight,
            CGImageGetWidth,
        )

        mutable_data = NSMutableData.data()
        destination = CGImageDestinationCreateWithData(
            mutable_data, "public.jpeg", 1, None
        )
        CGImageDestinationAddImage(destination, image, None)
        CGImageDestinationFinalize(destination)

        return (
            nsdata_to_bytes(mutable_data),
            int(CGImageGetWidth(image)),
            int(CGImageGetHeight(image)),
        )
    except ImportError:
        from AppKit import NSImage  # type: ignore

        ns_image = NSImage.alloc().initWithCGImage_size_(image, (0, 0))
        return encode_nsimage_to_jpeg_bytes(ns_image)


def downsample_image_data_to_jpeg_bytes(
    image_data: object, thumbnail_size: int
) -> Tuple[bytes, int, int, str]:
    try:
        from Quartz import (  # type: ignore
            CGImageSourceCreateThumbnailAtIndex,
            CGImageSourceCreateWithData,
            kCGImageSourceCreateThumbnailFromImageAlways,
            kCGImageSourceCreateThumbnailWithTransform,
            kCGImageSourceThumbnailMaxPixelSize,
        )

        source = CGImageSourceCreateWithData(image_data, None)
        if source is not None:
            thumbnail = CGImageSourceCreateThumbnailAtIndex(
                source,
                0,
                {
                    kCGImageSourceCreateThumbnailFromImageAlways: True,
                    kCGImageSourceCreateThumbnailWithTransform: True,
                    kCGImageSourceThumbnailMaxPixelSize: int(thumbnail_size),
                },
            )
            if thumbnail is not None:
                jpeg_bytes, pixel_width, pixel_height = encode_cgimage_to_jpeg_bytes(
                    thumbnail
                )
                return (
                    jpeg_bytes,
                    pixel_width,
                    pixel_height,
                    "quartz-imageio-fallback",
                )
    except ImportError:
        pass

    from AppKit import (  # type: ignore
        NSBitmapImageFileTypeJPEG,
        NSBitmapImageRep,
        NSColor,
        NSCompositingOperationCopy,
        NSGraphicsContext,
        NSImage,
    )

    image = NSImage.alloc().initWithData_(image_data)
    if image is None:
        return b"", 0, 0, "appkit-image-data-fallback"

    bitmap = NSBitmapImageRep.alloc().initWithBitmapDataPlanes_pixelsWide_pixelsHigh_bitsPerSample_samplesPerPixel_hasAlpha_isPlanar_colorSpaceName_bitmapFormat_bytesPerRow_bitsPerPixel_(
        None,
        int(thumbnail_size),
        int(thumbnail_size),
        8,
        4,
        True,
        False,
        "NSCalibratedRGBColorSpace",
        0,
        0,
        0,
    )
    if bitmap is None:
        return b"", 0, 0

    context = NSGraphicsContext.graphicsContextWithBitmapImageRep_(bitmap)
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.setCurrentContext_(context)
    NSColor.clearColor().set()
    target_rect = ((0, 0), (float(thumbnail_size), float(thumbnail_size)))
    image.drawInRect_fromRect_operation_fraction_(
        target_rect,
        ((0, 0), image.size()),
        NSCompositingOperationCopy,
        1.0,
    )
    NSGraphicsContext.restoreGraphicsState()

    jpeg_data = bitmap.representationUsingType_properties_(
        NSBitmapImageFileTypeJPEG, {}
    )
    return (
        nsdata_to_bytes(jpeg_data),
        int(thumbnail_size),
        int(thumbnail_size),
        "appkit-image-data-fallback",
    )


def extract_image_thumbnail_representation(
    asset: object,
    normalized_asset: dict,
    modules: Dict[str, object],
    thumbnail_size: int,
    allow_network_access: bool,
    timeout_seconds: int,
) -> dict:
    photos_module = modules["Photos"]
    PHImageManager = modules["PHImageManager"]
    PHImageRequestOptions = modules["PHImageRequestOptions"]

    manager = PHImageManager.defaultManager()
    options = PHImageRequestOptions.alloc().init()
    options.setNetworkAccessAllowed_(bool(allow_network_access))
    if hasattr(options, "setSynchronous_"):
        options.setSynchronous_(True)
    if hasattr(options, "setResizeMode_"):
        resize_mode = getattr(photos_module, "PHImageRequestOptionsResizeModeExact", None)
        if resize_mode is not None:
            options.setResizeMode_(resize_mode)
    if hasattr(options, "setDeliveryMode_"):
        delivery_mode = getattr(
            photos_module, "PHImageRequestOptionsDeliveryModeHighQualityFormat", None
        )
        if delivery_mode is not None:
            options.setDeliveryMode_(delivery_mode)

    completion_event = threading.Event()
    state = {
        "status": "pending",
        "byte_length": 0,
        "bytes_base64": None,
        "sha256": None,
        "mime_type": "image/jpeg",
        "pixel_width": None,
        "pixel_height": None,
        "is_degraded": None,
        "error": None,
        "timed_out": False,
        "source_mode": "photos-thumbnail-request",
        "network_access_allowed": bool(allow_network_access),
        "thumbnail_size": int(thumbnail_size),
    }

    def apply_bytes_payload(
        jpeg_bytes: bytes, pixel_width: int, pixel_height: int, source_mode: str
    ) -> None:
        payload = encode_bytes_payload(jpeg_bytes)
        state.update(payload)
        state["pixel_width"] = pixel_width
        state["pixel_height"] = pixel_height
        state["source_mode"] = source_mode
        state["status"] = "ok" if payload["byte_length"] > 0 else "empty"
        if payload["byte_length"] > 0:
            state["error"] = None

    def result_handler(image: object, info: object) -> None:
        if image is not None:
            try:
                jpeg_bytes, pixel_width, pixel_height = encode_nsimage_to_jpeg_bytes(image)
                apply_bytes_payload(
                    jpeg_bytes,
                    pixel_width,
                    pixel_height,
                    "photos-thumbnail-request",
                )
            except Exception as error:  # pragma: no cover - native bridge failure path
                state["status"] = "error"
                state["error"] = f"Failed to encode image thumbnail in-memory: {error}"
        else:
            state["status"] = "missing-image"

        degraded_flag = info_value(info, "PHImageResultIsDegradedKey")
        if degraded_flag is not None:
            state["is_degraded"] = bool(degraded_flag)

        if state["status"] == "missing-image":
            state["error"] = str(info_value(info, "PHImageErrorKey") or "No thumbnail returned.")

        completion_event.set()

    content_mode = int(getattr(photos_module, "PHImageContentModeAspectFill", 1))
    manager.requestImageForAsset_targetSize_contentMode_options_resultHandler_(
        asset,
        (thumbnail_size, thumbnail_size),
        content_mode,
        options,
        result_handler,
    )

    if state["status"] == "pending" and not completion_event.wait(timeout=timeout_seconds):
        state["status"] = "timeout"
        state["timed_out"] = True
        state["error"] = "Timed out while waiting for thumbnail extraction."

    def fallback_data_handler(*handler_args) -> None:
        image_data = handler_args[0] if len(handler_args) > 0 else None
        info = handler_args[-1] if handler_args else None

        if image_data is None:
            state["error"] = str(
                info_value(info, "PHImageErrorKey")
                or state["error"]
                or "No image data returned for thumbnail fallback."
            )
            return

        try:
            (
                jpeg_bytes,
                pixel_width,
                pixel_height,
                source_mode,
            ) = downsample_image_data_to_jpeg_bytes(image_data, thumbnail_size)
            apply_bytes_payload(
                jpeg_bytes,
                pixel_width,
                pixel_height,
                source_mode,
            )
            state["timed_out"] = False
        except Exception as error:  # pragma: no cover - native bridge failure path
            state["status"] = "error"
            state["error"] = f"Failed to downsample image data in-memory: {error}"

    if state["status"] in {"pending", "missing-image", "timeout", "empty"}:
        if hasattr(manager, "requestImageDataAndOrientationForAsset_options_resultHandler_"):
            manager.requestImageDataAndOrientationForAsset_options_resultHandler_(
                asset,
                options,
                fallback_data_handler,
            )
        elif hasattr(manager, "requestImageDataForAsset_options_resultHandler_"):
            manager.requestImageDataForAsset_options_resultHandler_(
                asset,
                options,
                fallback_data_handler,
            )

    return create_representation_payload(
        normalized_asset,
        representation_kind="image-thumbnail",
        mime_type=state["mime_type"],
        byte_length=state["byte_length"],
        bytes_base64=state["bytes_base64"],
        sha256=state["sha256"],
        metadata={
            "status": state["status"],
            "pixel_width": state["pixel_width"],
            "pixel_height": state["pixel_height"],
            "thumbnail_size": int(thumbnail_size),
            "network_access_allowed": bool(allow_network_access),
            "timed_out": state["timed_out"],
            "is_degraded": state["is_degraded"],
            "error": state["error"],
            "source_mode": state["source_mode"],
        },
    )


def choose_video_frame_time_seconds(asset: object) -> float:
    duration_seconds = read_native_member(asset, "duration")
    if duration_seconds is None:
        return 0.0

    duration_value = float(duration_seconds)
    if duration_value <= 0:
        return 0.0

    return min(duration_value / 2.0, 3.0)


def extract_video_poster_frame_representation(
    asset: object,
    normalized_asset: dict,
    modules: Dict[str, object],
    thumbnail_size: int,
    allow_network_access: bool,
    timeout_seconds: int,
) -> dict:
    PHImageManager = modules["PHImageManager"]
    PHVideoRequestOptions = modules["PHVideoRequestOptions"]

    manager = PHImageManager.defaultManager()
    options = PHVideoRequestOptions.alloc().init()
    options.setNetworkAccessAllowed_(bool(allow_network_access))

    completion_event = threading.Event()
    state = {
        "status": "pending",
        "byte_length": 0,
        "bytes_base64": None,
        "sha256": None,
        "mime_type": "image/jpeg",
        "pixel_width": None,
        "pixel_height": None,
        "error": None,
        "timed_out": False,
        "source_mode": "avasset-poster-frame",
        "frame_time_seconds": choose_video_frame_time_seconds(asset),
    }

    def result_handler(av_asset: object, audio_mix: object, info: object) -> None:
        del audio_mix
        if av_asset is None:
            state["status"] = "missing-avasset"
            state["error"] = str(
                info_value(info, "PHImageErrorKey")
                or "No AVAsset returned for video representation."
            )
            completion_event.set()
            return

        try:
            from AVFoundation import AVAssetImageGenerator  # type: ignore
            from CoreMedia import CMTimeMakeWithSeconds  # type: ignore

            generator = AVAssetImageGenerator.alloc().initWithAsset_(av_asset)
            generator.setAppliesPreferredTrackTransform_(True)
            if hasattr(generator, "setMaximumSize_"):
                generator.setMaximumSize_((thumbnail_size, thumbnail_size))

            frame_time = CMTimeMakeWithSeconds(state["frame_time_seconds"], 600)
            image_result = generator.copyCGImageAtTime_actualTime_error_(
                frame_time, None, None
            )

            cg_image = None
            error = None
            if isinstance(image_result, tuple):
                cg_image = image_result[0] if len(image_result) > 0 else None
                error = image_result[-1] if len(image_result) > 2 else None
            else:
                cg_image = image_result

            if cg_image is None:
                state["status"] = "missing-frame"
                state["error"] = str(error or "Video frame extraction returned no CGImage.")
            else:
                jpeg_bytes, pixel_width, pixel_height = encode_cgimage_to_jpeg_bytes(
                    cg_image
                )
                payload = encode_bytes_payload(jpeg_bytes)
                state.update(payload)
                state["pixel_width"] = pixel_width
                state["pixel_height"] = pixel_height
                state["status"] = "ok" if payload["byte_length"] > 0 else "empty"
        except Exception as error:  # pragma: no cover - native bridge failure path
            state["status"] = "error"
            state["error"] = f"Failed to generate video poster frame in-memory: {error}"

        completion_event.set()

    manager.requestAVAssetForVideo_options_resultHandler_(asset, options, result_handler)

    if not completion_event.wait(timeout=timeout_seconds):
        state["status"] = "timeout"
        state["timed_out"] = True
        state["error"] = "Timed out while waiting for video representation extraction."

    return create_representation_payload(
        normalized_asset,
        representation_kind="video-poster-frame",
        mime_type=state["mime_type"],
        byte_length=state["byte_length"],
        bytes_base64=state["bytes_base64"],
        sha256=state["sha256"],
        metadata={
            "status": state["status"],
            "pixel_width": state["pixel_width"],
            "pixel_height": state["pixel_height"],
            "thumbnail_size": int(thumbnail_size),
            "network_access_allowed": bool(allow_network_access),
            "timed_out": state["timed_out"],
            "frame_time_seconds": state["frame_time_seconds"],
            "error": state["error"],
            "source_mode": state["source_mode"],
        },
    )


def create_representation_payload(
    normalized_asset: dict,
    representation_kind: str,
    mime_type: str,
    byte_length: int,
    bytes_base64: Optional[str],
    sha256: Optional[str],
    metadata: dict,
) -> dict:
    return {
        "asset_id": normalized_asset["asset_id"],
        "local_identifier": normalized_asset["local_identifier"],
        "asset_type": normalized_asset["asset_type"],
        "representation_kind": representation_kind,
        "mime_type": mime_type,
        "byte_length": int(byte_length),
        "bytes_base64": bytes_base64,
        "sha256": sha256,
        "metadata": metadata,
    }


def extract_recent_representations(
    modules: Optional[Dict[str, object]],
    permission_status: str,
    allow_network_access: bool,
    extract_limit: int,
    thumbnail_size: int,
    timeout_seconds: int,
) -> dict:
    if not modules:
        return {
            "implemented": False,
            "available_asset_count": 0,
            "representations": [],
            "representation_count": 0,
            "image_representation_count": 0,
            "video_representation_count": 0,
            "errors": ["Photos runtime unavailable; cannot extract representations."],
        }

    if permission_status not in {"authorized", "limited"}:
        return {
            "implemented": False,
            "available_asset_count": 0,
            "representations": [],
            "representation_count": 0,
            "image_representation_count": 0,
            "video_representation_count": 0,
            "errors": [
                "Photos permission must be authorized or limited before representation extraction."
            ],
        }

    fetch_result = build_recent_assets_fetch_result(modules)
    available_asset_count = int(fetch_result.count())
    representations = []
    image_representation_count = 0
    video_representation_count = 0

    for index in range(min(available_asset_count, extract_limit)):
        asset = fetch_result.objectAtIndex_(index)
        normalized_asset = normalize_asset(asset, modules)
        if normalized_asset is None:
            continue

        if normalized_asset["asset_type"] == "image":
            representation = extract_image_thumbnail_representation(
                asset,
                normalized_asset,
                modules,
                thumbnail_size,
                allow_network_access,
                timeout_seconds,
            )
            image_representation_count += 1
        elif normalized_asset["asset_type"] == "video":
            representation = extract_video_poster_frame_representation(
                asset,
                normalized_asset,
                modules,
                thumbnail_size,
                allow_network_access,
                timeout_seconds,
            )
            video_representation_count += 1
        else:
            continue

        representations.append(representation)

    return {
        "implemented": True,
        "available_asset_count": available_asset_count,
        "representation_count": len(representations),
        "image_representation_count": image_representation_count,
        "video_representation_count": video_representation_count,
        "representations": representations,
        "errors": [],
    }


def probe_original_resource_access(
    resource: object,
    modules: Dict[str, object],
    allow_network_access: bool,
    byte_limit: int,
    timeout_seconds: int,
) -> dict:
    PHAssetResourceManager = modules["PHAssetResourceManager"]
    PHAssetResourceRequestOptions = modules["PHAssetResourceRequestOptions"]

    manager = PHAssetResourceManager.defaultManager()
    options = PHAssetResourceRequestOptions.alloc().init()
    options.setNetworkAccessAllowed_(bool(allow_network_access))

    completion_event = threading.Event()
    state = {
        "bytes_received": 0,
        "chunk_count": 0,
        "completed": False,
        "timed_out": False,
        "cancelled_after_probe": False,
        "request_id": None,
        "error": None,
        "error_domain": None,
        "error_code": None,
    }

    def data_received_handler(data: object) -> None:
        if data is None:
            return

        length_reader = getattr(data, "length", None)
        if callable(length_reader):
            chunk_length = int(length_reader())
        else:
            chunk_length = len(data)

        state["bytes_received"] += chunk_length
        state["chunk_count"] += 1

        if (
            state["bytes_received"] >= byte_limit
            and not state["cancelled_after_probe"]
            and state["request_id"] is not None
        ):
            state["cancelled_after_probe"] = True
            manager.cancelDataRequest_(state["request_id"])

    def completion_handler(error: object) -> None:
        if error is not None:
            state["error"] = str(error)
            error_domain = read_native_member(error, "domain")
            error_code = read_native_member(error, "code")
            state["error_domain"] = None if error_domain is None else str(error_domain)
            state["error_code"] = None if error_code is None else int(error_code)

        state["completed"] = True
        completion_event.set()

    request_id = manager.requestDataForAssetResource_options_dataReceivedHandler_completionHandler_(
        resource,
        options,
        data_received_handler,
        completion_handler,
    )
    state["request_id"] = int(request_id)

    if not completion_event.wait(timeout=timeout_seconds):
        state["timed_out"] = True
        manager.cancelDataRequest_(state["request_id"])
        completion_event.wait(timeout=5)

    if state["bytes_received"] > 0:
        access_status = "accessible"
    elif state["timed_out"]:
        access_status = "retryable-timeout"
    elif allow_network_access:
        access_status = "retryable-error"
    else:
        access_status = "network-disabled"

    return {
        "status": access_status,
        "network_access_allowed": bool(allow_network_access),
        "probe_byte_limit": int(byte_limit),
        "timeout_seconds": int(timeout_seconds),
        "bytes_received": state["bytes_received"],
        "chunk_count": state["chunk_count"],
        "cancelled_after_probe": state["cancelled_after_probe"],
        "timed_out": state["timed_out"],
        "completed": state["completed"],
        "error": state["error"],
        "error_domain": state["error_domain"],
        "error_code": state["error_code"],
    }


def probe_original_access(
    modules: Optional[Dict[str, object]],
    permission_status: str,
    allow_network_access: bool,
    probe_limit: int,
    byte_limit: int,
    timeout_seconds: int,
) -> dict:
    if not modules:
        return {
            "implemented": False,
            "probe_asset_count": 0,
            "probed_assets": [],
            "accessible_asset_count": 0,
            "retryable_asset_count": 0,
            "errors": ["Photos runtime unavailable; cannot probe original asset access."],
        }

    if permission_status not in {"authorized", "limited"}:
        return {
            "implemented": False,
            "probe_asset_count": 0,
            "probed_assets": [],
            "accessible_asset_count": 0,
            "retryable_asset_count": 0,
            "errors": [
                "Photos permission must be authorized or limited before probing original asset access."
            ],
        }

    PHAsset = modules["PHAsset"]
    fetch_result = PHAsset.fetchAssetsWithOptions_(None)
    asset_count = int(fetch_result.count())
    probed_assets = []
    accessible_asset_count = 0
    retryable_asset_count = 0

    for index in range(asset_count):
        if len(probed_assets) >= probe_limit:
            break

        asset = fetch_result.objectAtIndex_(index)
        normalized_asset = normalize_asset(asset, modules)
        if normalized_asset is None:
            continue

        resources = get_asset_resources(asset, modules)
        normalized_resources = [normalize_resource(resource, modules) for resource in resources]
        normalized_asset["is_in_icloud"] = classify_asset_cloud_state(resources)

        primary_resource = select_primary_resource(
            normalized_asset["asset_type"], resources, modules
        )
        if primary_resource is None:
            original_access = {
                "status": "missing-resource",
                "network_access_allowed": bool(allow_network_access),
                "probe_byte_limit": int(byte_limit),
                "timeout_seconds": int(timeout_seconds),
                "bytes_received": 0,
                "chunk_count": 0,
                "cancelled_after_probe": False,
                "timed_out": False,
                "completed": False,
                "error": "No Photos asset resource was available for the selected asset.",
                "error_domain": None,
                "error_code": None,
            }
            primary_resource_payload = None
            retryable_asset_count += 1
        else:
            original_access = probe_original_resource_access(
                primary_resource,
                modules,
                allow_network_access,
                byte_limit,
                timeout_seconds,
            )
            primary_resource_payload = normalize_resource(primary_resource, modules)
            if original_access["status"] == "accessible":
                accessible_asset_count += 1
            else:
                retryable_asset_count += 1

        probed_assets.append(
            {
                **normalized_asset,
                "resource_count": len(normalized_resources),
                "resources": normalized_resources,
                "primary_resource": primary_resource_payload,
                "original_access": original_access,
            }
        )

    return {
        "implemented": True,
        "probe_asset_count": len(probed_assets),
        "probed_assets": probed_assets,
        "accessible_asset_count": accessible_asset_count,
        "retryable_asset_count": retryable_asset_count,
        "errors": [],
    }


def enumerate_assets(modules: Optional[Dict[str, object]], permission_status: str) -> dict:
    if not modules:
        return {
            "asset_count": 0,
            "valid_asset_count": 0,
            "assets": [],
            "skipped_asset_count": 0,
            "implemented": False,
            "errors": ["Photos runtime unavailable; cannot enumerate assets."],
        }

    if permission_status not in {"authorized", "limited"}:
        return {
            "asset_count": 0,
            "valid_asset_count": 0,
            "assets": [],
            "skipped_asset_count": 0,
            "implemented": False,
            "errors": [
                "Photos permission must be authorized or limited before asset enumeration."
            ],
        }

    PHAsset = modules["PHAsset"]
    fetch_result = PHAsset.fetchAssetsWithOptions_(None)
    asset_count = int(fetch_result.count())
    assets = []

    for index in range(asset_count):
        normalized_asset = normalize_asset(fetch_result.objectAtIndex_(index), modules)
        if normalized_asset is None:
            continue
        assets.append(normalized_asset)

    return {
        "asset_count": asset_count,
        "valid_asset_count": len(assets),
        "assets": assets,
        "skipped_asset_count": asset_count - len(assets),
        "implemented": True,
        "errors": [],
    }


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
    enumeration_state = enumerate_assets(modules, permission_status)

    payload.update(
        {
            "permission_status": permission_status,
            "permission_status_raw": raw_status,
            "library_access": library_access,
            "asset_count_probe": asset_count_probe,
            "asset_count": enumeration_state["asset_count"],
            "valid_asset_count": enumeration_state["valid_asset_count"],
            "skipped_asset_count": enumeration_state["skipped_asset_count"],
            "assets": enumeration_state["assets"],
            "implemented": enumeration_state["implemented"],
            "ok": enumeration_state["implemented"],
            "errors": payload["errors"] + enumeration_state["errors"],
            "notes": payload["notes"]
            + [
                "Asset enumeration returns normalized Photos asset candidates after permission is granted.",
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


def probe_native_capabilities() -> dict:
    capability_modules = {
        "appkit": ("AppKit", None),
        "quartz": ("Quartz", None),
        "avfoundation": ("AVFoundation", None),
    }
    capabilities = {}
    capability_errors = {}

    for capability_name, (module_name, symbol_name) in capability_modules.items():
        try:
            module = __import__(module_name)
            if symbol_name is not None:
                getattr(module, symbol_name)
            capabilities[capability_name] = True
        except Exception as error:  # pragma: no cover - environment probe
            capabilities[capability_name] = False
            capability_errors[capability_name] = str(error)

    capabilities["photos_framework"] = True
    return {
        "capabilities": capabilities,
        "capability_errors": capability_errors,
    }


def handle_capabilities() -> dict:
    payload = build_base_payload("capabilities")
    runtime, modules = load_photos_runtime()
    permission_status, raw_status = get_authorization_status(modules)
    library_access, asset_count_probe = probe_library_access(permission_status, modules)
    capability_state = probe_native_capabilities() if modules else {
        "capabilities": {
            "photos_framework": False,
            "appkit": False,
            "quartz": False,
            "avfoundation": False,
        },
        "capability_errors": {},
    }

    payload.update(
        {
            "permission_status": permission_status,
            "permission_status_raw": raw_status,
            "library_access": library_access,
            "asset_count_probe": asset_count_probe,
            "python_executable": sys.executable,
            "bridge_script": str(Path(__file__).resolve()),
            "runtime_errors": runtime["errors"],
            "capabilities": capability_state["capabilities"],
            "capability_errors": capability_state["capability_errors"],
            "notes": payload["notes"]
            + [
                "Use this capability probe as a preflight step before debugging extract, index, or search flows that depend on macOS native modules.",
            ],
        }
    )
    return payload


def handle_probe_original_access(
    allow_network_access: bool, probe_limit: int, byte_limit: int, timeout_seconds: int
) -> dict:
    payload = build_base_payload("probe-original-access")
    _, modules = load_photos_runtime()
    permission_status, raw_status = get_authorization_status(modules)
    library_access, asset_count_probe = probe_library_access(permission_status, modules)
    probe_state = probe_original_access(
        modules,
        permission_status,
        allow_network_access,
        probe_limit,
        byte_limit,
        timeout_seconds,
    )

    payload.update(
        {
            "permission_status": permission_status,
            "permission_status_raw": raw_status,
            "library_access": library_access,
            "asset_count_probe": asset_count_probe,
            "allow_network_access": bool(allow_network_access),
            "probe_limit": int(probe_limit),
            "probe_byte_limit": int(byte_limit),
            "probe_timeout_seconds": int(timeout_seconds),
            "probe_asset_count": probe_state["probe_asset_count"],
            "probed_assets": probe_state["probed_assets"],
            "accessible_asset_count": probe_state["accessible_asset_count"],
            "retryable_asset_count": probe_state["retryable_asset_count"],
            "implemented": probe_state["implemented"],
            "ok": probe_state["implemented"],
            "errors": payload["errors"] + probe_state["errors"],
            "notes": payload["notes"]
            + [
                "Original-access probing uses Photos-managed resource requests and keeps media bytes in RAM only.",
                "When network access is allowed, the bridge can trigger Photos-managed delivery for cloud-backed originals without exporting files to the app workspace.",
            ],
        }
    )
    return payload


def handle_extract_representations(
    allow_network_access: bool,
    extract_limit: int,
    thumbnail_size: int,
    timeout_seconds: int,
) -> dict:
    payload = build_base_payload("extract-representations")
    _, modules = load_photos_runtime()
    permission_status, raw_status = get_authorization_status(modules)
    library_access, asset_count_probe = probe_library_access(permission_status, modules)
    extraction_state = extract_recent_representations(
        modules,
        permission_status,
        allow_network_access,
        extract_limit,
        thumbnail_size,
        timeout_seconds,
    )

    payload.update(
        {
            "permission_status": permission_status,
            "permission_status_raw": raw_status,
            "library_access": library_access,
            "asset_count_probe": asset_count_probe,
            "allow_network_access": bool(allow_network_access),
            "extract_limit": int(extract_limit),
            "thumbnail_size": int(thumbnail_size),
            "extract_timeout_seconds": int(timeout_seconds),
            "available_asset_count": extraction_state["available_asset_count"],
            "representation_count": extraction_state["representation_count"],
            "image_representation_count": extraction_state["image_representation_count"],
            "video_representation_count": extraction_state["video_representation_count"],
            "representations": extraction_state["representations"],
            "implemented": extraction_state["implemented"],
            "ok": extraction_state["implemented"],
            "errors": payload["errors"] + extraction_state["errors"],
            "notes": payload["notes"]
            + [
                "Extraction samples the most recent Photos assets first and keeps the default debug batch at 10 assets.",
                "Image thumbnails and video poster frames are encoded in-memory and returned without writing temp files to disk.",
            ],
        }
    )
    return payload


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "command",
        choices=[
            "check-access",
            "request-access",
            "scan-assets",
            "debug-access",
            "capabilities",
            "probe-original-access",
            "extract-representations",
        ],
    )
    parser.add_argument("--json", action="store_true")
    parser.add_argument(
        "--allow-network-access",
        choices=["true", "false"],
        default="true",
    )
    parser.add_argument("--probe-limit", type=int, default=DEFAULT_PROBE_LIMIT)
    parser.add_argument(
        "--probe-byte-limit", type=int, default=DEFAULT_PROBE_BYTE_LIMIT
    )
    parser.add_argument(
        "--probe-timeout-seconds", type=int, default=DEFAULT_PROBE_TIMEOUT_SECONDS
    )
    parser.add_argument("--extract-limit", type=int, default=DEFAULT_EXTRACT_LIMIT)
    parser.add_argument("--thumbnail-size", type=int, default=DEFAULT_THUMBNAIL_SIZE)
    parser.add_argument(
        "--extract-timeout-seconds", type=int, default=DEFAULT_EXTRACT_TIMEOUT_SECONDS
    )
    args = parser.parse_args()

    handlers = {
        "check-access": handle_check_access,
        "request-access": handle_request_access,
        "scan-assets": handle_scan_assets,
        "debug-access": handle_debug_access,
        "capabilities": handle_capabilities,
        "probe-original-access": lambda: handle_probe_original_access(
            allow_network_access=args.allow_network_access == "true",
            probe_limit=max(1, args.probe_limit),
            byte_limit=max(1, args.probe_byte_limit),
            timeout_seconds=max(1, args.probe_timeout_seconds),
        ),
        "extract-representations": lambda: handle_extract_representations(
            allow_network_access=args.allow_network_access == "true",
            extract_limit=max(1, args.extract_limit),
            thumbnail_size=max(1, args.thumbnail_size),
            timeout_seconds=max(1, args.extract_timeout_seconds),
        ),
    }
    payload = handlers[args.command]()

    print(json.dumps(payload, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
