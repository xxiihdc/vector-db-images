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

export async function runIndexLikeCommand({
  cwd,
  args = [],
  defaultUseCache,
  summary,
  commandLabel,
} = {}) {
  const configState = await loadConfig(cwd);
  const { config } = configState;
  const limit = readIntegerFlag(args, "--limit", config.scanner?.batch_size ?? 200);
  const timeoutSeconds = readIntegerFlag(args, "--timeout-seconds", 30);
  const useCache = hasFlag(args, "--no-cache") ? false : defaultUseCache;
  const storageState = createStorageRepositories({ cwd, config });

  await Promise.all([
    storageState.catalogRepository.initialize(),
    storageState.vectorRepository.initialize(),
  ]);

  const pipeline = createIndexPipeline({
    catalogRepository: storageState.catalogRepository,
    vectorRepository: storageState.vectorRepository,
  });
  const result = await pipeline.run({
    config,
    limit,
    timeoutSeconds,
    useCache,
  });

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
      `Representations extracted: ${result.extracted_representation_count}`,
      `Vector indexing mode: ${result.vector_index_state?.temp_file_usage === false ? "in-memory" : "unknown"}`,
      `Image vectors indexed: ${result.vector_index_state?.indexed_images ?? 0}`,
      `Video vectors indexed: ${result.vector_index_state?.indexed_videos ?? 0}`,
      `Assets persisted: ${result.persisted_asset_count}`,
      `Embeddings persisted: ${result.persisted_embedding_count}`,
      `Skipped representations: ${result.skipped_representation_count}`,
      ...formatStorageSummaryLines({
        storageRoot: storageState.storageRoot,
        catalogDbPath: storageState.catalogDbPath,
        vectorBackend: storageState.vectorBackend,
        vectorServiceUrl: storageState.vectorServiceUrl,
        vectorCollectionName: storageState.vectorCollectionName,
      }),
    ],
  };
}
