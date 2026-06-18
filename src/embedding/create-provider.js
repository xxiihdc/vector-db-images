import { AppError } from "../shared/errors/app-error.js";
import { createOpenClipEmbeddingProvider } from "./providers/open-clip/provider.js";
import { resolveOpenClipCandidate } from "./providers/open-clip/model-candidates.js";

export function createEmbeddingProvider({
  config,
  bridgeRunner,
} = {}) {
  const providerKey = config?.embedding?.provider ?? "open-clip";
  const modelKey = config?.embedding?.model ?? "ViT-B-32";
  const candidate = resolveOpenClipCandidate(config);

  if (providerKey === "open-clip") {
    return createOpenClipEmbeddingProvider({
      config,
      candidate,
      bridgeRunner,
    });
  }

  throw new AppError("Unsupported embedding provider configuration.", {
    code: "EMBEDDING_PROVIDER_UNSUPPORTED",
    details: {
      provider: providerKey,
      model: modelKey,
    },
  });
}
