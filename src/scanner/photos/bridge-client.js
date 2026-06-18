import { PHOTOS_COMMANDS } from "../../shared/types/runtime.js";
import { runPythonPhotosBridge } from "./python-bridge.js";

export async function checkPhotosAccess() {
  return runPythonPhotosBridge(PHOTOS_COMMANDS.CHECK_ACCESS);
}

export async function requestPhotosAccess() {
  return runPythonPhotosBridge(PHOTOS_COMMANDS.REQUEST_ACCESS);
}

export async function scanPhotosAssets() {
  return runPythonPhotosBridge(PHOTOS_COMMANDS.SCAN_ASSETS);
}

export async function debugPhotosAccess() {
  return runPythonPhotosBridge(PHOTOS_COMMANDS.DEBUG_ACCESS);
}

export async function probePhotosCapabilities() {
  return runPythonPhotosBridge(PHOTOS_COMMANDS.CAPABILITIES);
}

export async function probeOriginalPhotosAccess({
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

export async function extractPhotosRepresentations({
  allowNetworkAccess = true,
  limit = 10,
  offset = 0,
  thumbnailSize = 224,
  timeoutSeconds = 30,
} = {}) {
  return runPythonPhotosBridge(PHOTOS_COMMANDS.EXTRACT_REPRESENTATIONS, {
    args: [
      "--allow-network-access",
      allowNetworkAccess ? "true" : "false",
      "--extract-limit",
      String(limit),
      "--extract-offset",
      String(offset),
      "--thumbnail-size",
      String(thumbnailSize),
      "--extract-timeout-seconds",
      String(timeoutSeconds),
    ],
  });
}

export async function ensurePhotosResultsAlbum({
  albumName = "AI Search Results",
} = {}) {
  return runPythonPhotosBridge(PHOTOS_COMMANDS.ENSURE_RESULTS_ALBUM, {
    args: ["--album-name", String(albumName)],
  });
}

export async function writePhotosResultsAlbum({
  albumName = "AI Search Results",
  albumWriteMode = "replace",
  localIdentifiers = [],
} = {}) {
  return runPythonPhotosBridge(PHOTOS_COMMANDS.WRITE_RESULTS_ALBUM, {
    args: ["--payload-stdin"],
    input: JSON.stringify({
      album_name: String(albumName),
      album_write_mode: String(albumWriteMode),
      local_identifiers: Array.isArray(localIdentifiers) ? localIdentifiers : [],
    }),
  });
}
