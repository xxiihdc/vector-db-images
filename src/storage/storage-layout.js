export const STORAGE_LAYOUT = Object.freeze({
  root_dir: ".data",
  catalog_db_path: ".data/catalog-store.json",
  vector_backend: "qdrant",
  vector_service_url: "http://127.0.0.1:6333",
  vector_collection_name: "media-index",
  vector_distance: "cosine",
  vector_timeout_ms: 10000,
});

export function createDefaultStorageConfig() {
  return {
    root_dir: STORAGE_LAYOUT.root_dir,
    catalog_db_path: STORAGE_LAYOUT.catalog_db_path,
    vector_backend: STORAGE_LAYOUT.vector_backend,
    vector_service_url: STORAGE_LAYOUT.vector_service_url,
    vector_collection_name: STORAGE_LAYOUT.vector_collection_name,
    vector_distance: STORAGE_LAYOUT.vector_distance,
    vector_timeout_ms: STORAGE_LAYOUT.vector_timeout_ms,
  };
}

export function formatStorageSummaryLines({
  storageRoot,
  catalogDbPath,
  vectorBackend,
  vectorServiceUrl,
  vectorCollectionName,
} = {}) {
  return [
    `Storage root: ${storageRoot}`,
    `Catalog store: ${catalogDbPath}`,
    `Vector backend: ${vectorBackend ?? "unknown"}`,
    `Vector service: ${vectorServiceUrl ?? "unconfigured"}`,
    `Vector collection: ${vectorCollectionName ?? "unconfigured"}`,
  ];
}
