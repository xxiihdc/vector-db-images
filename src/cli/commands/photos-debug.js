import { loadConfig } from "../../config/load-config.js";
import { debugPhotosAccess } from "../../scanner/photos/bridge-client.js";

export async function runPhotosDebugCommand({ cwd }) {
  const configState = await loadConfig(cwd);
  const debugState = debugPhotosAccess();

  return {
    ...debugState,
    config_path: configState.configPath,
    config_exists: configState.exists,
    summary: "Photos debug runtime probe executed.",
    lines: [
      `Config present: ${configState.exists ? "yes" : "no"}`,
      `Python executable: ${debugState.python_executable}`,
      `Bridge script: ${debugState.bridge_script}`,
      `Framework connection: ${debugState.framework_connection}`,
      `Direct Photos API calls implemented: ${debugState.direct_api_calls_implemented ? "yes" : "no"}`,
    ],
  };
}
