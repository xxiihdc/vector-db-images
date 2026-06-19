import path from "node:path";
import { performance } from "node:perf_hooks";
import { loadConfig } from "../../config/load-config.js";
import { createStorageRepositories } from "../../storage/migrations/migration-runner.js";
import { createIndexPipeline } from "../../indexer/pipeline/index-pipeline.js";
import { createSearchService } from "../../retriever/query/search-service.js";
import { probeOpenClipCapabilities } from "../../embedding/providers/open-clip/capabilities.js";
import {
  DEFAULT_BENCHMARK_ASSET_LIMIT,
  DEFAULT_BENCHMARK_QUERY_LIMIT,
  OPEN_CLIP_MODEL_CANDIDATES,
  applyOpenClipCandidateToConfig,
  getOpenClipCandidateByPreset,
  listOpenClipBenchmarkCandidates,
} from "../../embedding/providers/open-clip/model-candidates.js";
import { AppError } from "../../shared/errors/app-error.js";
import {
  ensureDir,
  readJsonFile,
  writeJsonFile,
} from "../../shared/utils/fs.js";

const DEFAULT_QUERY_PACK_PATH = "specs/001-stronger-embedding-model/benchmark-query-pack.json";
const DEFAULT_RESULTS_DIR = "specs/001-stronger-embedding-model/benchmark-results";

function getDefaultBenchmarkCandidates() {
  return [
    OPEN_CLIP_MODEL_CANDIDATES[0],
    ...listOpenClipBenchmarkCandidates(),
  ];
}

function normalizeCandidateSelection(candidatePresets = []) {
  if (!Array.isArray(candidatePresets) || candidatePresets.length === 0) {
    return getDefaultBenchmarkCandidates();
  }

  return candidatePresets.map((preset) => {
    const candidate = getOpenClipCandidateByPreset(preset);

    if (!candidate) {
      throw new AppError(`Unknown benchmark candidate preset: ${preset}`, {
        code: "EMBEDDING_BENCHMARK_CANDIDATE_UNKNOWN",
        details: { candidate_preset: preset },
      });
    }

    return candidate;
  });
}

function summarizeSearchResult(result = {}) {
  const topResult = result.results?.[0] ?? null;

  if (!topResult) {
    return "no matches returned";
  }

  return `top=${topResult.local_identifier ?? "missing"} score=${Number(topResult.score ?? 0).toFixed(4)}`;
}

export async function runEmbeddingBenchmark({
  cwd,
  candidatePresets = [],
  assetLimit,
  queryLimit,
  timeoutSeconds = 30,
  queryPackPath,
  createStorageRepositoriesFn = createStorageRepositories,
  createIndexPipelineFn = createIndexPipeline,
  createSearchServiceFn = createSearchService,
  loadConfigFn = loadConfig,
  probeOpenClipCapabilitiesFn = probeOpenClipCapabilities,
  now = () => new Date(),
} = {}) {
  const configState = await loadConfigFn(cwd);
  const baseConfig = configState.config;
  const resolvedAssetLimit =
    Number.isInteger(assetLimit) && assetLimit > 0
      ? assetLimit
      : baseConfig?.embedding?.benchmark_asset_limit ?? DEFAULT_BENCHMARK_ASSET_LIMIT;
  const resolvedQueryLimit =
    Number.isInteger(queryLimit) && queryLimit > 0 ? queryLimit : DEFAULT_BENCHMARK_QUERY_LIMIT;
  const resolvedQueryPackPath = path.resolve(cwd, queryPackPath ?? DEFAULT_QUERY_PACK_PATH);
  const queryPack = await readJsonFile(resolvedQueryPackPath);
  const textQueries = Array.isArray(queryPack?.text_queries)
    ? queryPack.text_queries.map((query) => String(query).trim()).filter(Boolean)
    : [];

  if (textQueries.length === 0) {
    throw new AppError("Benchmark query pack must define at least one text query.", {
      code: "EMBEDDING_BENCHMARK_QUERY_PACK_INVALID",
      details: { query_pack_path: resolvedQueryPackPath },
    });
  }

  const candidates = normalizeCandidateSelection(candidatePresets);
  const storageState = createStorageRepositoriesFn({ cwd, config: baseConfig });
  await Promise.all([
    storageState.catalogRepository.initialize(),
    storageState.vectorRepository.initialize(),
  ]);
  const results = [];

  for (const [index, candidate] of candidates.entries()) {
    const benchmarkConfig = applyOpenClipCandidateToConfig(baseConfig, candidate);
    const capability = probeOpenClipCapabilitiesFn({
      config: benchmarkConfig,
    });
    const result = {
      rank: index + 1,
      candidate_id: candidate.id,
      candidate_preset: candidate.preset,
      model_identity: `${candidate.provider}:${candidate.model}:${candidate.pretrained}`,
      target_resolution: candidate.target_resolution,
      configured_batch_size: benchmarkConfig?.embedding?.batch_size ?? null,
      benchmark_batch_size: benchmarkConfig?.embedding?.benchmark_batch_size ?? null,
      capability_ok: capability.ok === true,
      runtime_device: capability.capabilities?.runtime_device ?? null,
      recommended_extractor_size:
        capability.capabilities?.recommended_extractor_size ??
        capability.candidate?.recommended_extractor_size ??
        candidate.target_resolution,
      missing_requirements: capability.requirements ?? [],
      indexing_status: capability.ok === true ? "pending" : "skipped",
      indexing_items_per_second: null,
      query_latency_ms: null,
      quality_notes: [],
      status: capability.ok === true ? "probe-passed" : "probe-failed",
      failure_mode: capability.ok === true ? null : "capability-probe-failed",
    };

    if (!capability.ok) {
      result.quality_notes.push(
        "Capability probe failed before indexing, so this rung was skipped."
      );
      results.push(result);
      continue;
    }

    const pipeline = createIndexPipelineFn({
      catalogRepository: storageState.catalogRepository,
      vectorRepository: storageState.vectorRepository,
    });

    try {
      const pipelineResult = await pipeline.run({
        config: benchmarkConfig,
        limit: resolvedAssetLimit,
        timeoutSeconds,
        useCache: false,
      });
      result.indexing_status = pipelineResult.status ?? "completed";
      result.indexing_items_per_second =
        pipelineResult.throughput?.embeddings_persisted_per_sec ?? null;
      result.quality_notes.push(
        `index persisted ${pipelineResult.persisted_embedding_count ?? 0} embeddings`
      );
    } catch (error) {
      result.indexing_status = "failed";
      result.status = "bench-failed";
      result.failure_mode = error?.code ?? "index-failed";
      result.quality_notes.push(error?.message ?? "Index benchmark failed.");
      results.push(result);
      continue;
    }

    const searchService = createSearchServiceFn({
      catalogRepository: storageState.catalogRepository,
      vectorRepository: storageState.vectorRepository,
    });
    const searchLatencies = [];

    for (const query of textQueries) {
      const startedAt = performance.now();
      const searchResult = await searchService.search({
        query,
        config: benchmarkConfig,
        limit: resolvedQueryLimit,
        includeEmbeddingCount: false,
      });
      searchLatencies.push(performance.now() - startedAt);
      result.quality_notes.push(`${query}: ${summarizeSearchResult(searchResult)}`);
    }

    result.quality_notes.push(
      "Compare path skipped exact embedding count to avoid non-critical backend metric reads."
    );

    result.query_latency_ms =
      searchLatencies.length > 0
        ? Number(
            (
              searchLatencies.reduce((sum, value) => sum + value, 0) /
              searchLatencies.length
            ).toFixed(1)
          )
        : null;
    result.status = "bench-passed";
    results.push(result);
  }

  const timestamp = now().toISOString().replaceAll(":", "-");
  const resultsDir = path.resolve(cwd, DEFAULT_RESULTS_DIR);
  const resultsArtifactPath = path.join(resultsDir, `embedding-benchmark-${timestamp}.json`);
  await ensureDir(resultsDir);

  const artifact = {
    benchmark_name: queryPack?.name ?? "embedding-benchmark",
    created_at: now().toISOString(),
    asset_limit: resolvedAssetLimit,
    query_limit: resolvedQueryLimit,
    query_pack_path: resolvedQueryPackPath,
    query_pack: queryPack,
    results,
  };
  await writeJsonFile(resultsArtifactPath, artifact);

  return {
    implemented: true,
    phase: "benchmark",
    status: "completed",
    summary: "Embedding benchmark ladder completed.",
    config_path: configState.configPath,
    config_exists: configState.exists,
    asset_limit: resolvedAssetLimit,
    query_limit: resolvedQueryLimit,
    query_pack_path: resolvedQueryPackPath,
    results_artifact_path: resultsArtifactPath,
    candidate_count: candidates.length,
    results,
    notes: [
      "Benchmark runs index each candidate on the same bounded asset limit with cache bypassed.",
      "Search comparisons reuse a fixed text query pack so candidate evidence stays comparable.",
    ],
  };
}
