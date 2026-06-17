import { scanPhotosAssets } from "../photos/bridge-client.js";
import { createAssetCandidate } from "../contracts/asset-candidate.js";

export function scanLibrary() {
  const scanState = scanPhotosAssets();

  return {
    ...scanState,
    assets: (scanState.assets ?? []).map((asset) => createAssetCandidate(asset)),
  };
}
