export function createRepresentationContract(payload = {}) {
  return {
    local_identifier: payload.local_identifier ?? null,
    asset_type: payload.asset_type ?? null,
    representation_kind: payload.representation_kind ?? null,
    mime_type: payload.mime_type ?? null,
    byte_length: payload.byte_length ?? null,
    bytes_base64: payload.bytes_base64 ?? null,
    sha256: payload.sha256 ?? null,
    metadata: payload.metadata ?? {},
  };
}
