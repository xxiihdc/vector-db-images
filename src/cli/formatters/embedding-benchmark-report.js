function formatMs(value) {
  return Number.isFinite(value) ? `${value.toFixed(1)}ms` : "n/a";
}

function formatItemsPerSecond(value) {
  return Number.isFinite(value) ? `${value.toFixed(3)} items/s` : "n/a";
}

function formatStatusRow(candidate = {}) {
  const parts = [
    `${candidate.rank ?? "?"}. ${candidate.candidate_preset ?? "custom"}`,
    `[${candidate.status ?? "unknown"}]`,
    candidate.model_identity ?? "unknown-model",
  ];

  if (candidate.failure_mode) {
    parts.push(`failure=${candidate.failure_mode}`);
  }

  return parts.join(" ");
}

export function buildEmbeddingBenchmarkReportLines(payload = {}) {
  const results = Array.isArray(payload.results) ? payload.results : [];
  const lines = [
    `Config present: ${payload.config_exists ? "yes" : "no"}`,
    `Query pack: ${payload.query_pack_path ?? "n/a"}`,
    `Results artifact: ${payload.results_artifact_path ?? "n/a"}`,
    `Asset limit per candidate: ${payload.asset_limit ?? 0}`,
    `Query limit per search: ${payload.query_limit ?? 0}`,
  ];

  for (const candidate of results) {
    lines.push(formatStatusRow(candidate));
    lines.push(
      `  Probe ready=${candidate.capability_ok ? "yes" : "no"} device=${candidate.runtime_device ?? "unknown"} extractor=${candidate.recommended_extractor_size ?? "n/a"}`
    );
    lines.push(
      `  Index status=${candidate.indexing_status ?? "skipped"} throughput=${formatItemsPerSecond(candidate.indexing_items_per_second)} search-latency=${formatMs(candidate.query_latency_ms)}`
    );

    if (candidate.quality_notes?.length) {
      lines.push(`  Notes=${candidate.quality_notes.join(" | ")}`);
    }
  }

  return lines;
}
