import { loadConfig } from "../../config/load-config.js";
import { probePhotosCapabilities } from "../../scanner/photos/bridge-client.js";

export async function runPhotosCapabilitiesCommand({ cwd }) {
  const configState = await loadConfig(cwd);
  const capabilityState = await probePhotosCapabilities();

  return {
    ...capabilityState,
    config_path: configState.configPath,
    config_exists: configState.exists,
    summary: "Photos native capability probe completed.",
    lines: [
      `Config present: ${configState.exists ? "yes" : "no"}`,
      `Python executable: ${capabilityState.python_executable}`,
      `Bridge script: ${capabilityState.bridge_script}`,
      `Framework connection: ${capabilityState.framework_connection}`,
      `Permission status: ${capabilityState.permission_status}`,
      `Library access: ${capabilityState.library_access}`,
      `Photos module: ${capabilityState.capabilities?.photos_framework ? "yes" : "no"}`,
      `AppKit module: ${capabilityState.capabilities?.appkit ? "yes" : "no"}`,
      `Quartz module: ${capabilityState.capabilities?.quartz ? "yes" : "no"}`,
      `AVFoundation module: ${capabilityState.capabilities?.avfoundation ? "yes" : "no"}`,
    ],
  };
}
