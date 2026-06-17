export function buildAssetRecord(payload = {}) {
  return {
    asset_id: payload.asset_id ?? null,
    local_identifier: payload.local_identifier ?? null,
    asset_type: payload.asset_type ?? null,
    fingerprint: payload.fingerprint ?? null,
    stale: payload.stale ?? false,
  };
}
