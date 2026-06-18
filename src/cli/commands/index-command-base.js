import { loadConfig } from "../../config/load-config.js";
import { createStorageRepositories } from "../../storage/migrations/migration-runner.js";
import { createIndexPipeline } from "../../indexer/pipeline/index-pipeline.js";
import { formatStorageSummaryLines } from "../../storage/storage-layout.js";

function readIntegerFlag(args, name, fallback) {
  const index = args.indexOf(name);
  if (index === -1) {
    return fallback;
  }

  const rawValue = args[index + 1];
  const parsedValue = Number.parseInt(rawValue ?? "", 10);
  return Number.isFinite(parsedValue) && parsedValue > 0 ? parsedValue : fallback;
}

function hasFlag(args, name) {
  return args.includes(name);
}

function createIndexProgressReporter({
  commandLabel,
  progressEvery = 10,
  json = false,
} = {}) {
  let lastPersistLoggedAt = 0;

  function formatDuration(durationMs) {
    return `${(Number(durationMs ?? 0) / 1000).toFixed(2)}s`;
  }

  function log(message) {
    const line = `[${commandLabel}] ${message}`;
    if (json) {
      process.stderr.write(`${line}\n`);
      return;
    }

    console.log(line);
  }

  return function reportProgress(event) {
    switch (event.event) {
      case "cache-hit":
        log(
          `cache hit: reusing ${event.cached_asset_count ?? 0} cached assets (limit ${event.limit ?? "n/a"})`
        );
        return;
      case "scan-start":
        log(`scan started (limit ${event.limit ?? "n/a"})`);
        return;
      case "scan-complete":
        log(
          `scan completed: ${event.scanned_asset_count ?? 0} candidates in ${formatDuration(event.duration_ms)}`
        );
        return;
      case "extract-start":
        log(
          `extraction started (limit ${event.limit ?? "n/a"}, thumbnail ${event.thumbnail_size ?? "n/a"})`
        );
        return;
      case "extract-complete":
        log(
          `extraction completed: ${event.representation_count ?? 0} representations in ${formatDuration(event.duration_ms)} (image ${event.image_representation_count ?? 0}, video ${event.video_representation_count ?? 0})`
        );
        return;
      case "extract-batch-complete":
        log(
          `extraction batch completed: offset ${event.chunk_offset ?? 0}, size ${event.chunk_limit ?? 0}, total ${event.completed_representation_count ?? 0}/${event.target_asset_count ?? "n/a"} in ${formatDuration(event.duration_ms)}`
        );
        return;
      case "prepare-complete":
        log(
          `prepared ${event.attempted_representations ?? 0} representations for embedding in ${formatDuration(event.duration_ms)}; skipped ${event.skipped_representations ?? 0}`
        );
        return;
      case "embed-start":
        log(
          `embedding started for ${event.representation_count ?? 0} representations via ${event.model_identity ?? "unknown-model"}${
            Number.isFinite(event.chunk_offset) ? ` (offset ${event.chunk_offset})` : ""
          }`
        );
        return;
      case "embed-complete":
        log(
          `embedding completed: ${event.embedding_result_count ?? 0} results in ${formatDuration(event.duration_ms)}${
            Number.isFinite(event.chunk_offset) ? ` (offset ${event.chunk_offset})` : ""
          }`
        );
        return;
      case "persist-start":
        log(
          `persist started for ${event.attempted_representations ?? 0} prepared representations${
            Number.isFinite(event.chunk_offset) ? ` (offset ${event.chunk_offset})` : ""
          }`
        );
        return;
      case "persist-retry":
        log(
          `persist retry ${event.attempt}/${event.retry_limit} for batch ${event.persist_batch_size ?? 0}${
            Number.isFinite(event.chunk_offset) ? ` (offset ${event.chunk_offset})` : ""
          }: ${event.error_code ?? "UNHANDLED_ERROR"}${event.error_message ? ` - ${event.error_message}` : ""}`
        );
        return;
      case "persist-item": {
        const persistedCount = event.persisted_embedding_count ?? 0;
        if (
          persistedCount !== 1 &&
          persistedCount - lastPersistLoggedAt < progressEvery
        ) {
          return;
        }

        lastPersistLoggedAt = persistedCount;
        log(
          `persisted ${event.persisted_embedding_count ?? 0} embeddings (${event.persisted_asset_count ?? 0} assets), failed ${event.failed_embedding_count ?? 0}`
        );
        return;
      }
      case "persist-complete":
        log(
          `persist completed: ${event.persisted_embedding_count ?? 0} embeddings, ${event.persisted_asset_count ?? 0} assets, ${event.failed_embedding_count ?? 0} failed, ${event.skipped_representation_count ?? 0} skipped in ${formatDuration(event.duration_ms)}${
            Number.isFinite(event.chunk_offset) ? ` (offset ${event.chunk_offset})` : ""
          }`
        );
        return;
      default:
        return;
    }
  };
}

export async function runIndexLikeCommand({
  cwd,
  args = [],
  defaultUseCache,
  summary,
  commandLabel,
  loadConfigFn = loadConfig,
  createStorageRepositoriesFn = createStorageRepositories,
  createIndexPipelineFn = createIndexPipeline,
} = {}) {
  const configState = await loadConfigFn(cwd);
  const { config } = configState;
  const limit = readIntegerFlag(args, "--limit", config.scanner?.batch_size ?? 200);
  const timeoutSeconds = readIntegerFlag(args, "--timeout-seconds", 30);
  const progressEvery = readIntegerFlag(args, "--progress-every", 10);
  const profile = hasFlag(args, "--profile");
  const useCache = hasFlag(args, "--no-cache") ? false : defaultUseCache;
  const json = hasFlag(args, "--json");
  const storageState = createStorageRepositoriesFn({ cwd, config });

  await Promise.all([
    storageState.catalogRepository.initialize(),
    storageState.vectorRepository.initialize(),
  ]);

  const pipeline = createIndexPipelineFn({
    catalogRepository: storageState.catalogRepository,
    vectorRepository: storageState.vectorRepository,
    onProgress: createIndexProgressReporter({
      commandLabel,
      progressEvery,
      json,
    }),
  });
  const result = await pipeline.run({
    config,
    limit,
    timeoutSeconds,
    useCache,
  });

  const timings = result.timings ?? {};
  const throughput = result.throughput ?? {};
  const breakdown = result.breakdown ?? {};
  const slowestStage = result.slowest_stage ?? {
    stage: "none",
    duration_ms: 0,
    percent_of_total: 0,
  };

  return {
    ...result,
    command: commandLabel,
    config_path: configState.configPath,
    config_exists: configState.exists,
    storage_root: storageState.storageRoot,
    catalog_db_path: storageState.catalogDbPath,
    vector_backend: storageState.vectorBackend,
    vector_service_url: storageState.vectorServiceUrl,
    vector_collection_name: storageState.vectorCollectionName,
    profile_enabled: profile,
    summary,
    lines: [
      `Command: ${commandLabel}`,
      `Config present: ${configState.exists ? "yes" : "no"}`,
      `Cache mode: ${result.cache_mode}`,
      `Framework connection: ${result.scan_state.framework_connection ?? "cache"}`,
      `Permission status: ${result.scan_state.permission_status ?? "cache"}`,
      `Library access: ${result.scan_state.library_access ?? "cache"}`,
      `Scan candidates: ${result.scanned_asset_count}`,
      `Extraction limit: ${limit}`,
      `Progress interval: ${progressEvery}`,
      `Representations extracted: ${result.extracted_representation_count}`,
      `Vector indexing mode: ${result.vector_index_state?.temp_file_usage === false ? "in-memory" : "unknown"}`,
      `Image vectors indexed: ${result.vector_index_state?.indexed_images ?? 0}`,
      `Video vectors indexed: ${result.vector_index_state?.indexed_videos ?? 0}`,
      `Assets persisted: ${result.persisted_asset_count}`,
      `Embeddings persisted: ${result.persisted_embedding_count}`,
      `Skipped representations: ${result.skipped_representation_count}`,
      `Total time: ${(Number(timings.total_ms ?? 0) / 1000).toFixed(2)}s`,
      `Slowest stage: ${slowestStage.stage ?? "none"} (${(Number(slowestStage.duration_ms ?? 0) / 1000).toFixed(2)}s, ${Number(slowestStage.percent_of_total ?? 0).toFixed(2)}% total)`,
      ...formatStorageSummaryLines({
        storageRoot: storageState.storageRoot,
        catalogDbPath: storageState.catalogDbPath,
        vectorBackend: storageState.vectorBackend,
        vectorServiceUrl: storageState.vectorServiceUrl,
        vectorCollectionName: storageState.vectorCollectionName,
      }),
      ...(profile
        ? [
            `Timing scan: ${(Number(timings.scan_ms ?? 0) / 1000).toFixed(2)}s`,
            `Timing extract: ${(Number(timings.extract_ms ?? 0) / 1000).toFixed(2)}s`,
            `Timing prepare: ${(Number(timings.prepare_ms ?? 0) / 1000).toFixed(2)}s`,
            `Timing embed: ${(Number(timings.embed_ms ?? 0) / 1000).toFixed(2)}s`,
            `Timing persist: ${(Number(timings.persist_ms ?? 0) / 1000).toFixed(2)}s`,
            `Throughput scan: ${Number(throughput.scan_candidates_per_sec ?? 0).toFixed(3)} assets/sec`,
            `Throughput extract: ${Number(throughput.representations_extracted_per_sec ?? 0).toFixed(3)} representations/sec`,
            `Throughput persist: ${Number(throughput.embeddings_persisted_per_sec ?? 0).toFixed(3)} embeddings/sec`,
            `Representation breakdown: image ${breakdown.image_representation_count ?? 0}, video ${breakdown.video_representation_count ?? 0}`,
            `Prepared breakdown: image ${breakdown.prepared_image_count ?? 0}, video ${breakdown.prepared_video_count ?? 0}`,
            `Skipped breakdown: image ${breakdown.skipped_image_count ?? 0}, video ${breakdown.skipped_video_count ?? 0}`,
            `Top skip reasons: ${
              Array.isArray(breakdown.skip_reasons) && breakdown.skip_reasons.length > 0
                ? breakdown.skip_reasons
                    .slice(0, 3)
                    .map((reason) => `${reason.name}:${reason.count}`)
                    .join(", ")
                : "none"
            }`,
          ]
        : []),
    ],
  };
}
