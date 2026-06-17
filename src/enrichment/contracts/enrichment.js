export function createEnrichmentContract(payload = {}) {
  return {
    local_identifier: payload.local_identifier ?? null,
    debug_hints: payload.debug_hints ?? [],
    metadata_summary: payload.metadata_summary ?? null,
  };
}
