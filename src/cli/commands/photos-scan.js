import { loadConfig } from "../../config/load-config.js";
import { scanLibrary } from "../../scanner/services/scan-service.js";

export async function runPhotosScanCommand({ cwd }) {
  const configState = await loadConfig(cwd);
  const scanState = scanLibrary();

  return {
    ...scanState,
    config_path: configState.configPath,
    config_exists: configState.exists,
    summary: "Photos scan bridge probe executed.",
    lines: [
      `Config present: ${configState.exists ? "yes" : "no"}`,
      `Framework connection: ${scanState.framework_connection}`,
      `Permission status: ${scanState.permission_status}`,
      `Scanned assets: ${scanState.asset_count}`,
      `Valid assets returned: ${scanState.valid_asset_count}`,
    ],
  };
}
