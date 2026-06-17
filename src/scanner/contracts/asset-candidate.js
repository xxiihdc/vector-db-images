export function createAssetCandidate(payload = {}) {
  return {
    asset_id: payload.asset_id ?? null,
    local_identifier: payload.local_identifier ?? null,
    asset_type: payload.asset_type ?? null,
    media_subtypes: payload.media_subtypes ?? [],
    source: payload.source ?? "photos",
    favorite: payload.favorite ?? false,
    hidden: payload.hidden ?? false,
    pixel_width: payload.pixel_width ?? null,
    pixel_height: payload.pixel_height ?? null,
    duration_seconds: payload.duration_seconds ?? null,
    creation_date: payload.creation_date ?? null,
    modification_date: payload.modification_date ?? null,
    is_in_icloud: payload.is_in_icloud ?? null,
    source_fingerprint: payload.source_fingerprint ?? null,
  };
}
