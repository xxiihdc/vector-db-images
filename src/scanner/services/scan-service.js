import { scanPhotosAssets } from "../photos/bridge-client.js";
import { createAssetCandidate } from "../contracts/asset-candidate.js";

export async function scanLibrary() {
  const scanState = await scanPhotosAssets();

  return {
    ...scanState,
    assets: (scanState.assets ?? []).map((asset) => createAssetCandidate(asset)),
  };
}
