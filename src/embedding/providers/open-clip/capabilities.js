import { runOpenClipEmbeddingBridge } from "./python-bridge.js";
import { resolveOpenClipCandidate } from "./model-candidates.js";

export function probeOpenClipCapabilities({ config, bridgeRunner = runOpenClipEmbeddingBridge } = {}) {
  const candidate = resolveOpenClipCandidate(config);
  return bridgeRunner("capabilities", {
    provider: candidate.provider,
    model: candidate.model,
    pretrained: candidate.pretrained,
    candidate_id: candidate.candidate_id,
    candidate_preset: candidate.candidate_preset,
    target_resolution: candidate.target_resolution,
    requires_timm: candidate.requires_timm,
    requires_transformers: candidate.requires_transformers,
    device: config?.embedding?.device ?? "auto",
  });
}
