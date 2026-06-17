import { AppError } from "../../shared/errors/app-error.js";

const REQUIRED_SECTIONS = [
  "app",
  "storage",
  "scanner",
  "extractor",
  "indexer",
  "retriever",
  "embedding",
  "debug",
];

export function validateConfig(config) {
  if (!config || typeof config !== "object") {
    throw new AppError("Config must be a JSON object.", {
      code: "CONFIG_INVALID",
    });
  }

  if (config.schema_version !== 1) {
    throw new AppError("Unsupported config schema version.", {
      code: "CONFIG_SCHEMA_UNSUPPORTED",
      details: { schema_version: config.schema_version ?? null },
    });
  }

  for (const section of REQUIRED_SECTIONS) {
    if (!(section in config)) {
      throw new AppError(`Missing config section: ${section}`, {
        code: "CONFIG_SECTION_MISSING",
        details: { section },
      });
    }
  }

  return config;
}
