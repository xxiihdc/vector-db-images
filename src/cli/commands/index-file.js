import { loadConfig } from "../../config/load-config.js";
import { createStorageRepositories } from "../../storage/migrations/migration-runner.js";
import { formatStorageSummaryLines } from "../../storage/storage-layout.js";
import { indexLocalImageFile } from "../../indexer/pipeline/index-file-pipeline.js";
import { AppError } from "../../shared/errors/app-error.js";

function parseIndexFileArgs(args = []) {
  const positional = [];

  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];

    if (value === "--json") {
      continue;
    }

    positional.push(value);
  }

  return {
    imagePath: positional[0] ?? "",
  };
}

export async function runIndexFileCommand({
  cwd,
  args = [],
  loadConfigFn = loadConfig,
  createStorageRepositoriesFn = createStorageRepositories,
  indexLocalImageFileFn = indexLocalImageFile,
} = {}) {
  const parsedArgs = parseIndexFileArgs(args);

  if (!parsedArgs.imagePath) {
    throw new AppError("Index file command requires an image path.", {
      code: "INDEX_FILE_PATH_REQUIRED",
    });
  }

  const configState = await loadConfigFn(cwd);
  const { config } = configState;
  const storageState = createStorageRepositoriesFn({ cwd, config });
  await Promise.all([
    storageState.catalogRepository.initialize(),
    storageState.vectorRepository.initialize(),
  ]);

  const result = await indexLocalImageFileFn({
    imagePath: parsedArgs.imagePath,
    config,
    catalogRepository: storageState.catalogRepository,
    vectorRepository: storageState.vectorRepository,
  });

  return {
    ...result,
    command: "index-file",
    summary: "Local image file indexed for exact-match validation.",
    config_path: configState.configPath,
    config_exists: configState.exists,
    storage_root: storageState.storageRoot,
    catalog_db_path: storageState.catalogDbPath,
    vector_backend: storageState.vectorBackend,
    vector_service_url: storageState.vectorServiceUrl,
    vector_collection_name: storageState.vectorCollectionName,
    lines: [
      "Command: index file",
      `Config present: ${configState.exists ? "yes" : "no"}`,
      `Image path: ${result.image_path}`,
      `Synthetic localIdentifier: ${result.local_identifier}`,
      `Embedding model: ${result.model_identity}`,
      `Vector dimensions: ${result.vector_dimensions}`,
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
