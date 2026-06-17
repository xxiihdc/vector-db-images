import { runOpenClipEmbeddingBridge } from "./python-bridge.js";

export function probeOpenClipCapabilities({ config, bridgeRunner = runOpenClipEmbeddingBridge } = {}) {
  return bridgeRunner("capabilities", {
    provider: config?.embedding?.provider ?? "open-clip",
    model: config?.embedding?.model ?? "ViT-B-32",
    pretrained: config?.embedding?.pretrained ?? "laion2b_s34b_b79k",
    device: config?.embedding?.device ?? "auto",
  });
}
