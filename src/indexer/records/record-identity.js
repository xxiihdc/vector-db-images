import { createHash } from "node:crypto";

function hash(input) {
  return createHash("sha256").update(String(input)).digest("hex");
}

export function buildAssetId(localIdentifier) {
  if (!localIdentifier) {
    return null;
  }

  return `asset:${hash(localIdentifier)}`;
}

export function buildEmbeddingModelKey({
  embedding_provider,
  embedding_model,
  model_identity,
} = {}) {
  if (model_identity) {
    return model_identity;
  }

  if (!embedding_provider && !embedding_model) {
    return null;
  }

  return [embedding_provider ?? "unknown-provider", embedding_model ?? "unknown-model"].join(":");
}

export function buildEmbeddingId({
  asset_id,
  representation_kind,
  embedding_provider,
  embedding_model,
  model_identity,
} = {}) {
  const modelKey = buildEmbeddingModelKey({
    embedding_provider,
    embedding_model,
    model_identity,
  });

  if (!asset_id || !representation_kind || !modelKey) {
    return null;
  }

  return `embedding:${hash([asset_id, representation_kind, modelKey].join("|"))}`;
}

export function buildVectorRef(embeddingId) {
  if (!embeddingId) {
    return null;
  }

  return `vector:${embeddingId}`;
}

export function normalizeTimestamp(value) {
  if (!value) {
    return null;
  }

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toISOString();
}

export function buildSourceFingerprint(payload = {}) {
  const parts = [
    normalizeTimestamp(payload.modification_date) ?? "null",
    payload.pixel_width ?? "null",
    payload.pixel_height ?? "null",
    payload.duration_seconds ?? "null",
    payload.asset_type ?? "null",
  ];

  return parts.join("|");
}

export function buildContentFingerprint(payload = {}) {
  const sourceFingerprint = payload.source_fingerprint ?? buildSourceFingerprint(payload);
  const modelKey = buildEmbeddingModelKey(payload) ?? "unknown-model";
  const extractionSignature =
    payload.extraction_signature ??
    payload.extractor_signature ??
    payload.image_thumbnail_size ??
    payload.video_strategy ??
    "default";

  return [
    sourceFingerprint ?? "null",
    payload.representation_kind ?? "null",
    extractionSignature,
    modelKey,
  ].join("|");
}
