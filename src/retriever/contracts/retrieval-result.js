export function createRetrievalResult(payload = {}) {
  return {
    result_id: payload.result_id ?? null,
    local_identifier: payload.local_identifier ?? null,
    asset_type: payload.asset_type ?? null,
    album_name: payload.album_name ?? "AI Search Results",
    score: payload.score ?? null,
    match_evidence: payload.match_evidence ?? null,
    debug: payload.debug ?? null,
  };
}
