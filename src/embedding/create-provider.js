import { AppError } from "../shared/errors/app-error.js";
import { createOpenClipEmbeddingProvider } from "./providers/open-clip/provider.js";

export function createEmbeddingProvider({
  config,
  bridgeRunner,
} = {}) {
  const providerKey = config?.embedding?.provider ?? "open-clip";
  const modelKey = config?.embedding?.model ?? "ViT-B-32";

  if (providerKey === "open-clip") {
    return createOpenClipEmbeddingProvider({
      config,
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
