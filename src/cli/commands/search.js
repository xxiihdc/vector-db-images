import { loadConfig } from "../../config/load-config.js";
import { createStorageRepositories } from "../../storage/migrations/migration-runner.js";
import { formatStorageSummaryLines } from "../../storage/storage-layout.js";
import { createSearchService } from "../../retriever/query/search-service.js";
import { createAlbumService } from "../../retriever/album/album-service.js";
import { AppError } from "../../shared/errors/app-error.js";

function parseSearchArgs(args = [], defaultLimit = 50) {
  const positional = [];
  let limit = defaultLimit;

  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];

    if (value === "--limit") {
      const parsed = Number.parseInt(args[index + 1] ?? "", 10);
      if (Number.isFinite(parsed) && parsed > 0) {
        limit = parsed;
      }
      index += 1;
      continue;
    }

    positional.push(value);
  }

  return {
    query: positional.join(" ").trim(),
    limit,
  };
}

function formatTopResultLine(result) {
  const rank = result?.rank ?? "?";
  const score = Number.isFinite(result?.score) ? result.score.toFixed(4) : "n/a";
  const assetType = result?.asset_type ?? "unknown";
  const representationKind = result?.representation_kind ?? "unknown";
  const localIdentifier = result?.local_identifier ?? "missing-local-identifier";

  return `Top match #${rank}: score=${score} asset=${assetType} representation=${representationKind} localIdentifier=${localIdentifier}`;
}

export async function runSearchCommand({
  cwd,
  args = [],
  loadConfigFn = loadConfig,
  createStorageRepositoriesFn = createStorageRepositories,
  createSearchServiceFn = createSearchService,
  createAlbumServiceFn = createAlbumService,
} = {}) {
  const configState = await loadConfigFn(cwd);
  const { config } = configState;
  const parsedArgs = parseSearchArgs(args, config?.retriever?.default_limit ?? 50);

  if (!parsedArgs.query) {
    throw new AppError("Search query must not be empty.", {
      code: "SEARCH_QUERY_REQUIRED",
    });
  }

  const storageState = createStorageRepositoriesFn({ cwd, config });
  await Promise.all([
    storageState.catalogRepository.initialize(),
    storageState.vectorRepository.initialize(),
  ]);

  const searchService = createSearchServiceFn({
    catalogRepository: storageState.catalogRepository,
    vectorRepository: storageState.vectorRepository,
  });
  const albumService = createAlbumServiceFn();
  const searchState = await searchService.search({
    query: parsedArgs.query,
    config,
    limit: parsedArgs.limit,
  });
  const albumState = await albumService.writeAlbumOutput({
    results: searchState.results,
    config,
  });
  const topResult = searchState.results[0] ?? null;

  return {
    implemented: true,
    phase: "search",
    command: "search",
    status: "completed",
    summary: "Semantic search completed and Photos album updated.",
    config_path: configState.configPath,
    config_exists: configState.exists,
    storage_root: storageState.storageRoot,
    catalog_db_path: storageState.catalogDbPath,
    vector_db_path: storageState.vectorDbPath,
    query_text: searchState.query_text,
    limit: parsedArgs.limit,
    result_count: searchState.result_count,
    searched_embedding_count: searchState.searched_embedding_count,
    album_name: albumState.album_name,
    album_local_identifier: albumState.album_local_identifier,
    album_write_mode: albumState.album_write_mode,
    requested_asset_count: albumState.requested_asset_count,
    applied_asset_count: albumState.applied_asset_count,
    resolved_asset_count: albumState.resolved_asset_count,
    unresolved_results: albumState.unresolved_results,
    results: searchState.results,
    search_state: searchState,
    album_state: albumState,
    notes: [
      ...(Array.isArray(searchState.notes) ? searchState.notes : []),
      ...(Array.isArray(albumState.notes) ? albumState.notes : []),
    ],
    lines: [
      `Command: search`,
      `Config present: ${configState.exists ? "yes" : "no"}`,
      `Query: ${searchState.query_text}`,
      `Requested limit: ${parsedArgs.limit}`,
      `Results returned: ${searchState.result_count}`,
      `Embeddings searched: ${searchState.searched_embedding_count}`,
      `Album target: ${albumState.album_name ?? "unavailable"}`,
      `Album write mode: ${albumState.album_write_mode ?? "unknown"}`,
      `Requested asset writes: ${albumState.requested_asset_count ?? 0}`,
      `Applied asset writes: ${albumState.applied_asset_count ?? 0}`,
      `Unresolved results: ${Array.isArray(albumState.unresolved_results) ? albumState.unresolved_results.length : 0}`,
      topResult ? formatTopResultLine(topResult) : "Top match: none",
      ...formatStorageSummaryLines({
        storageRoot: storageState.storageRoot,
        catalogDbPath: storageState.catalogDbPath,
        vectorDbPath: storageState.vectorDbPath,
      }),
    ],
  };
}
