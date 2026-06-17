export function createIndexJob(payload = {}) {
  return {
    job_id: payload.job_id ?? null,
    local_identifier: payload.local_identifier ?? null,
    reindex_mode: payload.reindex_mode ?? "incremental",
  };
}
