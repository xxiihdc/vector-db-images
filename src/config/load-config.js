import path from "node:path";
import { DEFAULT_CONFIG, DEFAULT_CONFIG_FILE_NAME } from "./defaults/config.js";
import { validateConfig } from "./schema/config-schema.js";
import {
  ensureDir,
  pathExists,
  readJsonFile,
  resolveFrom,
  touchFile,
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
    return {
      created: false,
      reason: "config_exists",
      configPath,
    };
  }

  const config = structuredClone(DEFAULT_CONFIG);
  await writeJsonFile(configPath, config);

  const storageRoot = resolveFrom(cwd, config.storage.root_dir);
  const catalogDbPath = resolveFrom(cwd, config.storage.catalog_db_path);
  const vectorDbPath = resolveFrom(cwd, config.storage.vector_db_path);

  await ensureDir(storageRoot);
  await touchFile(catalogDbPath);
  await touchFile(vectorDbPath);

  return {
    created: true,
    configPath,
    storageRoot,
    catalogDbPath,
    vectorDbPath,
  };
}
