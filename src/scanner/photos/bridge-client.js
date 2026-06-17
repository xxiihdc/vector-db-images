import { PHOTOS_COMMANDS } from "../../shared/types/runtime.js";
import { runPythonPhotosBridge } from "./python-bridge.js";

export function checkPhotosAccess() {
  return runPythonPhotosBridge(PHOTOS_COMMANDS.CHECK_ACCESS);
}

export function requestPhotosAccess() {
  return runPythonPhotosBridge(PHOTOS_COMMANDS.REQUEST_ACCESS);
}

export function scanPhotosAssets() {
  return runPythonPhotosBridge(PHOTOS_COMMANDS.SCAN_ASSETS);
}

export function debugPhotosAccess() {
  return runPythonPhotosBridge(PHOTOS_COMMANDS.DEBUG_ACCESS);
}

export function probePhotosCapabilities() {
  return runPythonPhotosBridge(PHOTOS_COMMANDS.CAPABILITIES);
}

export function probeOriginalPhotosAccess({
  allowNetworkAccess = true,
  probeLimit = 5,
  probeByteLimit = 64 * 1024,
  probeTimeoutSeconds = 30,
} = {}) {
  return runPythonPhotosBridge(PHOTOS_COMMANDS.PROBE_ORIGINAL_ACCESS, {
    args: [
      "--allow-network-access",
      allowNetworkAccess ? "true" : "false",
      "--probe-limit",
      String(probeLimit),
      "--probe-byte-limit",
      String(probeByteLimit),
      "--probe-timeout-seconds",
      String(probeTimeoutSeconds),
    ],
  });
}

export function extractPhotosRepresentations({
  allowNetworkAccess = true,
  limit = 10,
  thumbnailSize = 224,
  timeoutSeconds = 30,
} = {}) {
  return runPythonPhotosBridge(PHOTOS_COMMANDS.EXTRACT_REPRESENTATIONS, {
    args: [
      "--allow-network-access",
      allowNetworkAccess ? "true" : "false",
      "--extract-limit",
      String(limit),
      "--thumbnail-size",
      String(thumbnailSize),
      "--extract-timeout-seconds",
      String(timeoutSeconds),
    ],
  });
}
