import { loadConfig } from "../../config/load-config.js";
import { probeOriginalPhotosAccess } from "../../scanner/photos/bridge-client.js";

export async function runPhotosProbeOriginalsCommand({ cwd }) {
  const configState = await loadConfig(cwd);
  const allowNetworkAccess =
    configState.config.extractor?.allow_network_access ?? true;
  const probeState = probeOriginalPhotosAccess({
    allowNetworkAccess,
  });
  const sampleAssets = (probeState.probed_assets ?? []).slice(0, 3);

  return {
    ...probeState,
    config_path: configState.configPath,
    config_exists: configState.exists,
    summary: "Photos original access probe completed.",
    lines: [
      `Config present: ${configState.exists ? "yes" : "no"}`,
      `Framework connection: ${probeState.framework_connection}`,
      `Permission status: ${probeState.permission_status}`,
      `Library access: ${probeState.library_access}`,
      `Network-backed access allowed: ${allowNetworkAccess ? "yes" : "no"}`,
      `Probed assets: ${probeState.probe_asset_count}`,
      `Accessible originals: ${probeState.accessible_asset_count}`,
      `Retryable originals: ${probeState.retryable_asset_count}`,
      ...sampleAssets.map((asset, index) => {
        const originalAccess = asset.original_access ?? {};
        return `Sample probe ${index + 1}: ${asset.local_identifier} (${asset.asset_type}) -> ${originalAccess.status}`;
      }),
    ],
  };
}
