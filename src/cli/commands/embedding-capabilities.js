import { loadConfig } from "../../config/load-config.js";
import { probeOpenClipCapabilities } from "../../embedding/providers/open-clip/capabilities.js";
import { buildCapabilityLines } from "../../embedding/providers/open-clip/remediation.js";

export async function runEmbeddingCapabilitiesCommand({ cwd }) {
  const configState = await loadConfig(cwd);
  const payload = probeOpenClipCapabilities({ config: configState.config });

  return {
    ...payload,
    config_path: configState.configPath,
    config_exists: configState.exists,
    summary: "Embedding provider capability probe completed.",
    lines: [
      `Config present: ${configState.exists ? "yes" : "no"}`,
      `Config path: ${configState.configPath}`,
      ...buildCapabilityLines(payload),
    ],
  };
}
