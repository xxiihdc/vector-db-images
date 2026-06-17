export function createRepresentationContract(payload = {}) {
  return {
    local_identifier: payload.local_identifier ?? null,
    asset_type: payload.asset_type ?? null,
    representation_kind: payload.representation_kind ?? null,
    byte_length: payload.byte_length ?? null,
    metadata: payload.metadata ?? {},
  };
}
