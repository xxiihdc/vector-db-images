import { loadConfig } from "../../config/load-config.js";
import { checkPhotosAccess } from "../../scanner/photos/bridge-client.js";

export async function runPhotosCheckCommand({ cwd }) {
  const configState = await loadConfig(cwd);
  const bridgeState = checkPhotosAccess();

  return {
    ...bridgeState,
    config_path: configState.configPath,
    config_exists: configState.exists,
    summary: "Photos bridge check completed.",
    lines: [
      `Config present: ${configState.exists ? "yes" : "no"}`,
      `Bridge mode: ${bridgeState.bridge_mode}`,
      `Permission status: ${bridgeState.permission_status}`,
      `Library access: ${bridgeState.library_access}`,
    ],
  };
}
