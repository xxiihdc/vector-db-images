import { loadConfig } from "../../config/load-config.js";
import { createStorageRepositories } from "../../storage/migrations/migration-runner.js";
import { formatStorageSummaryLines } from "../../storage/storage-layout.js";
import { createSearchService } from "../../retriever/query/search-service.js";
import { createAlbumService } from "../../retriever/album/album-service.js";
import { AppError } from "../../shared/errors/app-error.js";

function formatTopResultLine(result) {
  const rank = result?.rank ?? "?";
  const score = Number.isFinite(result?.score) ? result.score.toFixed(4) : "n/a";
  const assetType = result?.asset_type ?? "unknown";
  const representationKind = result?.representation_kind ?? "unknown";
  const localIdentifier = result?.local_identifier ?? "missing-local-identifier";

  return `Top match #${rank}: score=${score} asset=${assetType} representation=${representationKind} localIdentifier=${localIdentifier}`;
}

function resolveSearchLimit(limit, fallbackLimit = 50) {
  return Number.isFinite(limit) && limit > 0
    ? Math.trunc(limit)
    : fallbackLimit;
}

function shouldSkipAlbumWrite({ skipAlbum, config }) {
  return (
    skipAlbum === true ||
    config?.retriever?.write_to_photos_results_album === false
  );
}

export async function executeSearchWorkflow({
  cwd,
  query,
  queryImagePath,
  limit,
  skipAlbum = false,
  loadConfigFn = loadConfig,
  createStorageRepositoriesFn = createStorageRepositories,
  createSearchServiceFn = createSearchService,
  createAlbumServiceFn = createAlbumService,
} = {}) {
  const configState = await loadConfigFn(cwd);
  const { config } = configState;
  const normalizedQuery = String(query ?? "").trim();
  const normalizedImagePath = String(queryImagePath ?? "").trim();

  if (!normalizedQuery && !normalizedImagePath) {
    throw new AppError("Search query must not be empty.", {
      code: "SEARCH_QUERY_REQUIRED",
    });
  }

  const resolvedLimit = resolveSearchLimit(limit, config?.retriever?.default_limit ?? 50);
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
  const albumWriteSkipped = shouldSkipAlbumWrite({ skipAlbum, config });
  const searchState = normalizedImagePath
    ? await searchService.searchByImage({
        imagePath: normalizedImagePath,
        config,
        limit: resolvedLimit,
      })
    : await searchService.search({
        query: normalizedQuery,
        config,
        limit: resolvedLimit,
      });
  const albumState = albumWriteSkipped
    ? {
        implemented: true,
        phase: "search",
        album_name: config?.app?.results_album_name ?? "AI Search Results",
        album_local_identifier: null,
        album_write_mode: "skipped",
        requested_asset_count: 0,
        applied_asset_count: 0,
        resolved_asset_count: 0,
        unresolved_results: [],
        notes:
          config?.retriever?.write_to_photos_results_album === false
            ? [
                "Album write-back was disabled by config for this search run.",
              ]
            : ["Album write-back was skipped for this search run."],
      }
    : await albumService.writeAlbumOutput({
        results: searchState.results,
        config,
      });
  const topResult = searchState.results[0] ?? null;

  return {
    implemented: true,
    phase: "search",
    command: "search",
    status: "completed",
    summary: albumWriteSkipped
      ? "Semantic search completed without Photos album write-back."
      : "Semantic search completed and Photos album updated.",
    config_path: configState.configPath,
    config_exists: configState.exists,
    storage_root: storageState.storageRoot,
    catalog_db_path: storageState.catalogDbPath,
    vector_backend: storageState.vectorBackend,
    vector_service_url: storageState.vectorServiceUrl,
    vector_collection_name: storageState.vectorCollectionName,
    query_text: searchState.query_text,
    query_image_path: normalizedImagePath || null,
    query_mode: normalizedImagePath ? "image" : "text",
    limit: resolvedLimit,
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
      "Command: search",
      `Config present: ${configState.exists ? "yes" : "no"}`,
      `Query mode: ${normalizedImagePath ? "image" : "text"}`,
      `Query: ${searchState.query_text}`,
      ...(normalizedImagePath ? [`Image query path: ${normalizedImagePath}`] : []),
      `Requested limit: ${resolvedLimit}`,
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
        vectorBackend: storageState.vectorBackend,
        vectorServiceUrl: storageState.vectorServiceUrl,
        vectorCollectionName: storageState.vectorCollectionName,
      }),
    ],
  };
}
