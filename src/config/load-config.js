import path from "node:path";
import {
  DEFAULT_CONFIG,
  DEFAULT_CONFIG_FILE_NAME,
  TELEGRAM_CONFIG_FILE_NAME,
} from "./defaults/config.js";
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

export function getTelegramConfigPath(cwd, fileName = TELEGRAM_CONFIG_FILE_NAME) {
  return path.resolve(cwd, fileName);
}

function mergeTelegramConfig(baseConfig, telegramConfig) {
  return {
    ...baseConfig,
    telegram: {
      ...(baseConfig.telegram ?? {}),
      ...(telegramConfig ?? {}),
    },
  };
}

export async function loadConfig(cwd) {
  const configPath = getConfigPath(cwd);
  const telegramConfigPath = getTelegramConfigPath(cwd);
  const exists = await pathExists(configPath);
  const telegramConfigExists = await pathExists(telegramConfigPath);

  if (!exists) {
    const config = telegramConfigExists
      ? mergeTelegramConfig(
          structuredClone(DEFAULT_CONFIG),
          await readJsonFile(telegramConfigPath)
        )
      : structuredClone(DEFAULT_CONFIG);

    return {
      config: validateConfig(config),
      configPath,
      exists: false,
      telegramConfigPath,
      telegramConfigExists,
    };
  }

  const baseConfig = await readJsonFile(configPath);
  const config = telegramConfigExists
    ? mergeTelegramConfig(baseConfig, await readJsonFile(telegramConfigPath))
    : baseConfig;
  return {
    config: validateConfig(config),
    configPath,
    exists: true,
    telegramConfigPath,
    telegramConfigExists,
  };
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
