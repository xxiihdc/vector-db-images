import {
  buildContentFingerprint,
  buildEmbeddingId,
  buildEmbeddingModelKey,
  buildVectorRef,
  normalizeTimestamp,
} from "./record-identity.js";

export function buildEmbeddingRecord(payload = {}) {
  const embeddingDimensions =
    payload.embedding_dimensions ??
    payload.vector_dimensions ??
    (Array.isArray(payload.vector) ? payload.vector.length : null);
  const modelIdentity = buildEmbeddingModelKey(payload);
  const embeddingId =
    payload.embedding_id ??
    buildEmbeddingId({
      asset_id: payload.asset_id ?? null,
      representation_kind: payload.representation_kind ?? null,
      embedding_provider: payload.embedding_provider ?? null,
      embedding_model: payload.embedding_model ?? null,
      model_identity: modelIdentity,
    });

  return {
    embedding_id: embeddingId,
    asset_id: payload.asset_id ?? null,
    local_identifier: payload.local_identifier ?? null,
    representation_kind: payload.representation_kind ?? null,
    embedding_provider: payload.embedding_provider ?? null,
    embedding_model: payload.embedding_model ?? null,
    model_identity: modelIdentity,
    candidate_preset: payload.candidate_preset ?? null,
    target_resolution: payload.target_resolution ?? null,
    embedding_dimensions: embeddingDimensions,
    vector_ref:
      payload.vector_ref ??
      (payload.vector || embeddingDimensions ? buildVectorRef(embeddingId) : null),
    extraction_signature:
      payload.extraction_signature ?? payload.extractor_signature ?? null,
    content_fingerprint:
      payload.content_fingerprint ?? buildContentFingerprint(payload),
    source_fingerprint: payload.source_fingerprint ?? null,
    indexed_at: normalizeTimestamp(payload.indexed_at),
    status: payload.status ?? "ready",
  };
}
