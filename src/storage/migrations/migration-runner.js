import { resolveFrom } from "../../shared/utils/fs.js";
import { createCatalogRepository } from "../catalog/catalog-repository.js";
import { createVectorRepository } from "../vector/vector-repository.js";

export function createStorageRepositories({ cwd, config }) {
  const storageRoot = resolveFrom(cwd, config.storage.root_dir);
  const catalogDbPath = resolveFrom(cwd, config.storage.catalog_db_path);
  const vectorDbPath = resolveFrom(cwd, config.storage.vector_db_path);

  return {
    storageRoot,
    catalogDbPath,
    vectorDbPath,
    catalogRepository: createCatalogRepository({ filePath: catalogDbPath }),
    vectorRepository: createVectorRepository({ filePath: vectorDbPath }),
  };
}

export async function initializeStorageRepositories({ cwd, config }) {
  const {
    storageRoot,
    catalogDbPath,
    vectorDbPath,
    catalogRepository,
    vectorRepository,
  } = createStorageRepositories({ cwd, config });

  const [catalogInfo, vectorInfo] = await Promise.all([
    catalogRepository.initialize(),
    vectorRepository.initialize(),
  ]);

  return {
    storageRoot,
    catalogDbPath,
    vectorDbPath,
    catalogInfo,
    vectorInfo,
  };
}
