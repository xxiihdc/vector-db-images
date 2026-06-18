import { resolveFrom } from "../../shared/utils/fs.js";
import { createCatalogRepository } from "../catalog/catalog-repository.js";
import { createVectorRepository } from "../vector/vector-repository.js";

export function createStorageRepositories({ cwd, config }) {
  const storageRoot = resolveFrom(cwd, config.storage.root_dir);
  const catalogDbPath = resolveFrom(cwd, config.storage.catalog_db_path);
  const vectorBackend = config.storage.vector_backend ?? "qdrant";
  const vectorServiceUrl = config.storage.vector_service_url;
  const vectorCollectionName = config.storage.vector_collection_name;
  const vectorDistance = config.storage.vector_distance ?? "cosine";
  const vectorTimeoutMs = config.storage.vector_timeout_ms ?? 10000;

  return {
    storageRoot,
    catalogDbPath,
    vectorBackend,
    vectorServiceUrl,
    vectorCollectionName,
    catalogRepository: createCatalogRepository({ filePath: catalogDbPath }),
    vectorRepository: createVectorRepository({
      backend: vectorBackend,
      serviceUrl: vectorServiceUrl,
      collectionName: vectorCollectionName,
      distance: vectorDistance,
      timeoutMs: vectorTimeoutMs,
    }),
  };
}

export async function initializeStorageRepositories({
  cwd,
  config,
  tolerateVectorBackendFailure = false,
} = {}) {
  const {
    storageRoot,
    catalogDbPath,
    vectorBackend,
    vectorServiceUrl,
    vectorCollectionName,
    catalogRepository,
    vectorRepository,
  } = createStorageRepositories({ cwd, config });

  const catalogInfo = await catalogRepository.initialize();
  let vectorInfo = null;
  let vectorError = null;

  try {
    vectorInfo = await vectorRepository.initialize();
  } catch (error) {
    if (!tolerateVectorBackendFailure) {
      throw error;
    }

    vectorError = {
      name: error?.name ?? "Error",
      code: error?.code ?? "UNHANDLED_ERROR",
      message: error?.message ?? "Unknown error",
      details: error?.details ?? null,
    };
    vectorInfo = {
      backend: vectorBackend,
      service_url: vectorServiceUrl,
      collection_name: vectorCollectionName,
      reachable: false,
      collection_exists: false,
      error: vectorError,
    };
  }

  return {
    storageRoot,
    catalogDbPath,
    vectorBackend,
    vectorServiceUrl,
    vectorCollectionName,
    catalogInfo,
    vectorInfo,
    vectorError,
  };
}
