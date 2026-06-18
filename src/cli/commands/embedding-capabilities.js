import { loadConfig } from "../../config/load-config.js";
import { probeOpenClipCapabilities } from "../../embedding/providers/open-clip/capabilities.js";
import {
  buildCapabilityLines,
  buildCapabilityWarnings,
} from "../../embedding/providers/open-clip/remediation.js";

export async function runEmbeddingCapabilitiesCommand({
  cwd,
  loadConfigFn = loadConfig,
  probeOpenClipCapabilitiesFn = probeOpenClipCapabilities,
} = {}) {
  const configState = await loadConfigFn(cwd);
  const payload = probeOpenClipCapabilitiesFn({ config: configState.config });
  const warnings = buildCapabilityWarnings(payload);

  return {
    ...payload,
    config_path: configState.configPath,
    config_exists: configState.exists,
    summary: "Embedding provider capability probe completed.",
    warnings,
    lines: [
      `Config present: ${configState.exists ? "yes" : "no"}`,
      `Config path: ${configState.configPath}`,
      `Probe outcome: ${payload.ok ? "ready" : "blocked"}`,
      ...buildCapabilityLines(payload),
    ],
  };
}
