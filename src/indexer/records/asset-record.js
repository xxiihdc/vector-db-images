import {
  buildAssetId,
  buildSourceFingerprint,
  normalizeTimestamp,
} from "./record-identity.js";

export function buildAssetRecord(payload = {}) {
  const localIdentifier = payload.local_identifier ?? null;
  const assetType = payload.asset_type ?? null;

  return {
    asset_id: payload.asset_id ?? buildAssetId(localIdentifier),
    local_identifier: localIdentifier,
    asset_type: assetType,
    media_subtypes: Array.isArray(payload.media_subtypes)
      ? payload.media_subtypes.map((value) => String(value))
      : [],
    favorite: payload.favorite ?? false,
    hidden: payload.hidden ?? false,
    pixel_width: payload.pixel_width ?? null,
    pixel_height: payload.pixel_height ?? null,
    duration_seconds:
      assetType === "video" ? payload.duration_seconds ?? null : null,
    creation_date: normalizeTimestamp(payload.creation_date),
    modification_date: normalizeTimestamp(payload.modification_date),
    is_in_icloud: payload.is_in_icloud ?? null,
    indexed_at: normalizeTimestamp(payload.indexed_at),
    last_seen_at: normalizeTimestamp(payload.last_seen_at),
    source_fingerprint:
      payload.source_fingerprint ?? buildSourceFingerprint(payload),
  };
}
