import { loadConfig } from "../../config/load-config.js";
import { createStorageRepositories } from "../../storage/migrations/migration-runner.js";
import { formatStorageSummaryLines } from "../../storage/storage-layout.js";

export async function runStorageVectorCheckCommand({
  cwd,
  args = [],
  loadConfigFn = loadConfig,
  createStorageRepositoriesFn = createStorageRepositories,
} = {}) {
  const configState = await loadConfigFn(cwd);
  const { config } = configState;
  const storageState = createStorageRepositoriesFn({ cwd, config });
  const vectorInfo = await storageState.vectorRepository.initialize();

  return {
    implemented: true,
    phase: "storage",
    command: "storage vector-check",
    status: vectorInfo.reachable ? "completed" : "warning",
    summary: vectorInfo.reachable
      ? "Vector backend is reachable."
      : "Vector backend check completed with warnings.",
    config_path: configState.configPath,
    config_exists: configState.exists,
    vector_info: vectorInfo,
    lines: [
      `Command: storage vector-check`,
      `Config present: ${configState.exists ? "yes" : "no"}`,
      `Vector backend reachable: ${vectorInfo.reachable ? "yes" : "no"}`,
      `Collection exists: ${vectorInfo.collection_exists ? "yes" : "no"}`,
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
