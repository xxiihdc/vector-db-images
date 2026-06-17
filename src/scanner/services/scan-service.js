import { scanPhotosAssets } from "../photos/bridge-client.js";

export function scanLibrary() {
  return scanPhotosAssets();
}
