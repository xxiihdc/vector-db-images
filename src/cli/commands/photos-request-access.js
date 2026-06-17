import { loadConfig } from "../../config/load-config.js";
import { requestPhotosAccess } from "../../scanner/photos/bridge-client.js";

export async function runPhotosRequestAccessCommand({ cwd }) {
  const configState = await loadConfig(cwd);
  const bridgeState = requestPhotosAccess();

  return {
    ...bridgeState,
    config_path: configState.configPath,
    config_exists: configState.exists,
    summary: "Photos permission request completed.",
    lines: [
      `Config present: ${configState.exists ? "yes" : "no"}`,
      `Permission before request: ${bridgeState.permission_status_before}`,
      `Permission after request: ${bridgeState.permission_status_after}`,
      `TCC prompt eligible: ${bridgeState.tcc_prompt_eligible ? "yes" : "no"}`,
      `TCC prompt requested: ${bridgeState.tcc_prompt_requested ? "yes" : "no"}`,
      `Library access after request: ${bridgeState.library_access_after}`,
    ],
  };
}
