import path from "node:path";
import { DEFAULT_CONFIG, DEFAULT_CONFIG_FILE_NAME } from "./defaults/config.js";
import { validateConfig } from "./schema/config-schema.js";
import { initializeStorageRepositories } from "../storage/migrations/migration-runner.js";
import {
  pathExists,
  readJsonFile,
  writeJsonFile,
} from "../shared/utils/fs.js";

export function getConfigPath(cwd, fileName = DEFAULT_CONFIG_FILE_NAME) {
  return path.resolve(cwd, fileName);
}

export async function loadConfig(cwd) {
  const configPath = getConfigPath(cwd);
  const exists = await pathExists(configPath);

  if (!exists) {
    return {
      config: structuredClone(DEFAULT_CONFIG),
      configPath,
      exists: false,
    };
  }

  const config = validateConfig(await readJsonFile(configPath));
  return { config, configPath, exists: true };
}

export async function initializeProjectScaffold(cwd, options = {}) {
  const { force = false } = options;
  const configPath = getConfigPath(cwd);
  const configExists = await pathExists(configPath);

  if (configExists && !force) {
    const config = validateConfig(await readJsonFile(configPath));
    const storage = await initializeStorageRepositories({
      cwd,
      config,
      tolerateVectorBackendFailure: true,
    });

    return {
      created: false,
      reason: "config_exists",
      configPath,
      ...storage,
    };
  }

  const config = structuredClone(DEFAULT_CONFIG);
  await writeJsonFile(configPath, config);
  const storage = await initializeStorageRepositories({
    cwd,
    config,
    tolerateVectorBackendFailure: true,
  });

  return {
    created: true,
    configPath,
    ...storage,
  };
}
