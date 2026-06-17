export function buildEmbeddingRecord(payload = {}) {
  return {
    embedding_id: payload.embedding_id ?? null,
    asset_id: payload.asset_id ?? null,
    model_identity: payload.model_identity ?? null,
    vector_dimensions: payload.vector_dimensions ?? null,
    searchable: payload.searchable ?? true,
  };
}
