import { createHash } from "node:crypto";

function buildResultId({ query_text, embedding_id, rank }) {
  if (!query_text || !embedding_id || !Number.isInteger(rank) || rank < 1) {
    return null;
  }

  const queryHash = createHash("sha256").update(query_text).digest("hex");
  const resultHash = createHash("sha256")
    .update([queryHash, embedding_id, String(rank)].join("|"))
    .digest("hex");

  return `result:${resultHash}`;
}

export function createRetrievalResult(payload = {}) {
  const rank = Number.isInteger(payload.rank) ? payload.rank : null;
  const queryText = payload.match_evidence?.query_text ?? null;

  return {
    result_id:
      payload.result_id ??
      buildResultId({
        query_text: queryText,
        embedding_id: payload.embedding_id ?? null,
        rank,
      }),
    local_identifier: payload.local_identifier ?? null,
    asset_id: payload.asset_id ?? null,
    asset_type: payload.asset_type ?? null,
    embedding_id: payload.embedding_id ?? null,
    representation_kind: payload.representation_kind ?? null,
    album_name: payload.album_name ?? "AI Search Results",
    score: payload.score ?? null,
    rank,
    match_evidence: payload.match_evidence ?? null,
    debug: payload.debug ?? null,
  };
}
