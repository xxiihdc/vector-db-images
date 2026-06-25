import { createDefaultStorageConfig } from "../../storage/storage-layout.js";
import {
  DEFAULT_BENCHMARK_ASSET_LIMIT,
  DEFAULT_OPEN_CLIP_CANDIDATE_PRESET,
} from "../../embedding/providers/open-clip/model-candidates.js";

export const DEFAULT_CONFIG_FILE_NAME = "media-vector-index.config.json";
export const TELEGRAM_CONFIG_FILE_NAME = "telegram.config.json";

export const DEFAULT_CONFIG = Object.freeze({
  schema_version: 1,
  app: {
    results_album_name: "AI Search Results",
    log_level: "info",
  },
  storage: createDefaultStorageConfig(),
  scanner: {
    include_images: true,
    include_videos: true,
    batch_size: 200,
  },
  extractor: {
    image_thumbnail_size: 224,
    video_strategy: "storyboard",
    allow_network_access: true,
  },
  indexer: {
    write_batch_size: 64,
    extraction_batch_size: 200,
    reindex_mode: "incremental",
  },
  retriever: {
    default_limit: 50,
    album_write_mode: "replace",
    write_to_photos_results_album: true,
  },
  telegram: {
    enabled: false,
    bot_token: "",
    allowed_chat_ids: [],
    poll_timeout_seconds: 30,
    poll_retry_delay_ms: 3000,
    reply_result_limit: 5,
    offset_store_path: ".data/telegram-offset.json",
  },
  embedding: {
    provider: "open-clip",
    candidate_preset: DEFAULT_OPEN_CLIP_CANDIDATE_PRESET,
    model: "ViT-B-32",
    pretrained: "laion2b_s34b_b79k",
    device: "auto",
    target_resolution: 224,
    normalize: true,
    batch_size: 8,
    benchmark_batch_size: 8,
    benchmark_asset_limit: DEFAULT_BENCHMARK_ASSET_LIMIT,
  },
  debug: {
    save_diagnostics: false,
  },
});
