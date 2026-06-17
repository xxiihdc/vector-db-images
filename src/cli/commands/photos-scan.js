import { loadConfig } from "../../config/load-config.js";
import { scanLibrary } from "../../scanner/services/scan-service.js";

export async function runPhotosScanCommand({ cwd }) {
  const configState = await loadConfig(cwd);
  const scanState = scanLibrary();
  const sampleAssets = (scanState.assets ?? []).slice(0, 5);

  return {
    ...scanState,
    config_path: configState.configPath,
    config_exists: configState.exists,
    summary: "Photos asset scan completed.",
    lines: [
      `Config present: ${configState.exists ? "yes" : "no"}`,
      `Framework connection: ${scanState.framework_connection}`,
      `Permission status: ${scanState.permission_status}`,
      `Library access: ${scanState.library_access}`,
      `Scanned assets: ${scanState.asset_count}`,
      `Valid assets returned: ${scanState.valid_asset_count}`,
      `Skipped assets: ${scanState.skipped_asset_count ?? 0}`,
      ...sampleAssets.map(
        (asset, index) =>
          `Sample asset ${index + 1}: ${asset.local_identifier} (${asset.asset_type})`
      ),
    ],
  };
}
