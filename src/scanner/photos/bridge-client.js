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
