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

  async function embedQuery({ text } = {}) {
    const normalizedText = String(text ?? "").trim();
    const payload = bridgeRunner("embed-text-query", {
      provider: providerKey,
      model: modelKey,
      pretrained: pretrainedKey,
      device,
      normalize: normalizeEmbeddings,
      text: normalizedText,
    });

    if (!payload?.ok) {
      if (payload?.embedding?.error_code === "QUERY_TEXT_REQUIRED") {
        throw new AppError("Query text is required for semantic search.", {
          code: "EMBEDDING_QUERY_REQUIRED",
          details: {
            provider: providerKey,
            model: modelKey,
            pretrained: pretrainedKey,
          },
        });
      }

      throw new AppError("OpenCLIP provider is unavailable for text queries.", {
        code: "EMBEDDING_QUERY_PROVIDER_UNAVAILABLE",
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

    const vector = normalizeVector(payload?.embedding?.vector);

    if (payload?.embedding?.status !== "ready" || !vector) {
      throw new AppError("Embedding provider returned an invalid query vector payload.", {
        code: "EMBEDDING_QUERY_INVALID_VECTOR",
        details: {
          provider: providerKey,
          model: modelKey,
          pretrained: pretrainedKey,
          error_code: payload?.embedding?.error_code ?? null,
          error_message: payload?.embedding?.error_message ?? null,
        },
      });
    }

    return {
      text: normalizedText,
      vector,
      embedding_provider: payload.embedding.embedding_provider ?? providerKey,
      embedding_model: payload.embedding.embedding_model ?? modelKey,
      model_identity:
        payload.embedding.model_identity ?? `${providerKey}:${modelKey}:${pretrainedKey}`,
    };
  }

  return {
    providerKey,
    modelKey,
    modelIdentity: `${providerKey}:${modelKey}:${pretrainedKey}`,
    embedRepresentations,
    embedQuery,
  };
}
