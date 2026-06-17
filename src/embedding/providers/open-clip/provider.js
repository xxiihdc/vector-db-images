import { AppError } from "../../../shared/errors/app-error.js";
import { runOpenClipEmbeddingBridge } from "./python-bridge.js";
import { normalizeCapabilityRequirements } from "./remediation.js";

function normalizeVector(vector) {
  if (!Array.isArray(vector) || vector.length === 0) {
    return null;
  }

  const normalized = vector.map((value) => Number(value));
  return normalized.every((value) => Number.isFinite(value)) ? normalized : null;
}

export function createOpenClipEmbeddingProvider({
  config,
  bridgeRunner = runOpenClipEmbeddingBridge,
} = {}) {
  const providerKey = config?.embedding?.provider ?? "open-clip";
  const modelKey = config?.embedding?.model ?? "ViT-B-32";
  const pretrainedKey = config?.embedding?.pretrained ?? "laion2b_s34b_b79k";
  const device = config?.embedding?.device ?? "auto";
  const normalizeEmbeddings = config?.embedding?.normalize !== false;
  const batchSize = config?.embedding?.batch_size ?? 8;

  async function embedRepresentations({ representations = [] } = {}) {
    if (!Array.isArray(representations) || representations.length === 0) {
      return [];
    }

    const payload = bridgeRunner("embed-image-batch", {
      provider: providerKey,
      model: modelKey,
      pretrained: pretrainedKey,
      device,
      normalize: normalizeEmbeddings,
      batch_size: batchSize,
      representations: representations.map((representation) => ({
        local_identifier: representation.local_identifier ?? null,
        representation_kind: representation.representation_kind ?? null,
        asset_type: representation.asset_type ?? null,
        bytes_base64: representation.bytes_base64 ?? null,
      })),
    });

    if (!payload?.ok) {
      throw new AppError("OpenCLIP provider is unavailable.", {
        code: "EMBEDDING_PROVIDER_UNAVAILABLE",
        details: {
          provider: providerKey,
          model: modelKey,
          pretrained: pretrainedKey,
          device,
          errors: payload?.errors ?? [],
          notes: payload?.notes ?? [],
          requirements: normalizeCapabilityRequirements(payload),
        },
      });
    }

    return (payload.embeddings ?? []).map((embedding) => {
      const vector = normalizeVector(embedding?.vector);

      if (embedding?.status === "ready" && !vector) {
        throw new AppError("Embedding provider returned an invalid vector payload.", {
          code: "EMBEDDING_PROVIDER_INVALID_VECTOR",
          details: {
            provider: providerKey,
            model: modelKey,
            pretrained: pretrainedKey,
            local_identifier: embedding?.local_identifier ?? null,
            representation_kind: embedding?.representation_kind ?? null,
          },
        });
      }

      return {
        local_identifier: embedding?.local_identifier ?? null,
        representation_kind: embedding?.representation_kind ?? null,
        status: embedding?.status ?? "failed",
        vector,
        embedding_provider: embedding?.embedding_provider ?? providerKey,
        embedding_model: embedding?.embedding_model ?? modelKey,
        model_identity:
          embedding?.model_identity ?? `${providerKey}:${modelKey}:${pretrainedKey}`,
        error_code: embedding?.error_code ?? null,
        error_message: embedding?.error_message ?? null,
      };
    });
  }

  return {
    providerKey,
    modelKey,
    modelIdentity: `${providerKey}:${modelKey}:${pretrainedKey}`,
    embedRepresentations,
  };
}
