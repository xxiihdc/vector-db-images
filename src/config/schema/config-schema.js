import { AppError } from "../../shared/errors/app-error.js";

const REQUIRED_SECTIONS = [
  "app",
  "storage",
  "scanner",
  "extractor",
  "indexer",
  "retriever",
  "telegram",
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

  if (!config.storage || typeof config.storage !== "object") {
    throw new AppError("Config storage section must be an object.", {
      code: "CONFIG_STORAGE_INVALID",
    });
  }

  if (!config.storage.vector_backend) {
    throw new AppError("Missing config field: storage.vector_backend", {
      code: "CONFIG_FIELD_MISSING",
      details: { field: "storage.vector_backend" },
    });
  }

  if (!config.storage.vector_service_url) {
    throw new AppError("Missing config field: storage.vector_service_url", {
      code: "CONFIG_FIELD_MISSING",
      details: { field: "storage.vector_service_url" },
    });
  }

  if (!config.storage.vector_collection_name) {
    throw new AppError("Missing config field: storage.vector_collection_name", {
      code: "CONFIG_FIELD_MISSING",
      details: { field: "storage.vector_collection_name" },
    });
  }

  if (
    "write_to_photos_results_album" in (config.retriever ?? {}) &&
    typeof config.retriever.write_to_photos_results_album !== "boolean"
  ) {
    throw new AppError(
      "Config field retriever.write_to_photos_results_album must be a boolean.",
      {
        code: "CONFIG_FIELD_INVALID",
        details: {
          field: "retriever.write_to_photos_results_album",
        },
      }
    );
  }

  if (
    "enabled" in (config.telegram ?? {}) &&
    typeof config.telegram.enabled !== "boolean"
  ) {
    throw new AppError("Config field telegram.enabled must be a boolean.", {
      code: "CONFIG_FIELD_INVALID",
      details: {
        field: "telegram.enabled",
      },
    });
  }

  const allowedChatIds = config.telegram?.allowed_chat_ids;
  if (
    allowedChatIds !== undefined &&
    (!Array.isArray(allowedChatIds) ||
      allowedChatIds.some(
        (value) =>
          !(
            (typeof value === "string" && value.trim().length > 0) ||
            Number.isSafeInteger(value)
          )
      ))
  ) {
    throw new AppError(
      "Config field telegram.allowed_chat_ids must be an array of non-empty strings or integers.",
      {
        code: "CONFIG_FIELD_INVALID",
        details: {
          field: "telegram.allowed_chat_ids",
        },
      }
    );
  }

  for (const field of [
    "embedding.target_resolution",
    "embedding.batch_size",
    "embedding.benchmark_batch_size",
    "embedding.benchmark_asset_limit",
    "indexer.extraction_batch_size",
    "telegram.poll_timeout_seconds",
    "telegram.poll_retry_delay_ms",
    "telegram.reply_result_limit",
  ]) {
    const [section, key] = field.split(".");
    const value = config?.[section]?.[key];

    if (value !== undefined && (!Number.isInteger(value) || value <= 0)) {
      throw new AppError(`Config field ${field} must be a positive integer.`, {
        code: "CONFIG_FIELD_INVALID",
        details: { field, value },
      });
    }
  }

  const offsetStorePath = config.telegram?.offset_store_path;
  if (offsetStorePath !== undefined && String(offsetStorePath).trim().length === 0) {
    throw new AppError("Config field telegram.offset_store_path must not be empty.", {
      code: "CONFIG_FIELD_INVALID",
      details: {
        field: "telegram.offset_store_path",
      },
    });
  }

  if (config.telegram?.enabled === true) {
    if (String(config.telegram?.bot_token ?? "").trim().length === 0) {
      throw new AppError("Config field telegram.bot_token is required when Telegram is enabled.", {
        code: "CONFIG_FIELD_INVALID",
        details: {
          field: "telegram.bot_token",
        },
      });
    }

    if (!Array.isArray(config.telegram?.allowed_chat_ids) || config.telegram.allowed_chat_ids.length === 0) {
      throw new AppError(
        "Config field telegram.allowed_chat_ids must contain at least one chat id when Telegram is enabled.",
        {
          code: "CONFIG_FIELD_INVALID",
          details: {
            field: "telegram.allowed_chat_ids",
          },
        }
      );
    }
  }

  const videoStrategy = config.extractor?.video_strategy;
  if (
    videoStrategy !== undefined &&
    !["poster-frame", "storyboard"].includes(String(videoStrategy))
  ) {
    throw new AppError("Config field extractor.video_strategy is unsupported.", {
      code: "CONFIG_FIELD_INVALID",
      details: {
        field: "extractor.video_strategy",
        value: videoStrategy,
        supported_values: ["poster-frame", "storyboard"],
      },
    });
  }

  return config;
}
