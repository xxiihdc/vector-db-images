export function createAssetCandidate(payload = {}) {
  return {
    asset_id: payload.asset_id ?? null,
    local_identifier: payload.local_identifier ?? null,
    asset_type: payload.asset_type ?? null,
    media_subtypes: payload.media_subtypes ?? [],
    source: payload.source ?? "photos",
  };
}
