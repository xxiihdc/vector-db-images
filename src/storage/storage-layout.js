export const STORAGE_LAYOUT = Object.freeze({
  root_dir: ".data",
  catalog_db_path: ".data/catalog-store.json",
  vector_db_path: ".data/vector-store.json",
});

export function createDefaultStorageConfig() {
  return {
    root_dir: STORAGE_LAYOUT.root_dir,
    catalog_db_path: STORAGE_LAYOUT.catalog_db_path,
    vector_db_path: STORAGE_LAYOUT.vector_db_path,
  };
}

export function formatStorageSummaryLines({
  storageRoot,
  catalogDbPath,
  vectorDbPath,
} = {}) {
  return [
    `Storage root: ${storageRoot}`,
    `Catalog store: ${catalogDbPath}`,
    `Vector store: ${vectorDbPath}`,
  ];
}
