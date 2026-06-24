import path from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT_ENV_VAR = "MVI_PROJECT_ROOT";
const PROJECT_ENV_LOADED_FLAG = "__MVI_PROJECT_ENV_LOADED__";
const DEFAULT_PROJECT_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../.."
);

function parseEnvFile(content) {
  const entries = [];
  const lines = String(content ?? "").split(/\r?\n/);

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const normalizedLine = line.startsWith("export ") ? line.slice(7).trim() : line;
    const separatorIndex = normalizedLine.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }

    const key = normalizedLine.slice(0, separatorIndex).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      continue;
    }

    let value = normalizedLine.slice(separatorIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    entries.push([key, value]);
  }

  return entries;
}

function loadEnvFile(envFilePath) {
  try {
    const content = readFileSync(envFilePath, "utf8");
    for (const [key, value] of parseEnvFile(content)) {
      if (process.env[key] === undefined) {
        process.env[key] = value;
      }
    }
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return;
    }

    throw error;
  }
}

export function loadProjectEnv({ cwd = process.cwd() } = {}) {
  if (globalThis[PROJECT_ENV_LOADED_FLAG] === true) {
    return;
  }

  loadEnvFile(path.resolve(DEFAULT_PROJECT_ROOT, ".env"));

  const configuredProjectRoot = String(process.env[PROJECT_ROOT_ENV_VAR] ?? "").trim();
  if (configuredProjectRoot) {
    loadEnvFile(path.resolve(configuredProjectRoot, ".env"));
  } else {
    loadEnvFile(path.resolve(cwd, ".env"));
  }

  globalThis[PROJECT_ENV_LOADED_FLAG] = true;
}
