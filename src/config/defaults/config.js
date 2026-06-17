import { createDefaultStorageConfig } from "../../storage/storage-layout.js";

export const DEFAULT_CONFIG_FILE_NAME = "media-vector-index.config.json";

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
    video_strategy: "poster-frame",
    allow_network_access: true,
  },
  indexer: {
    write_batch_size: 64,
    reindex_mode: "incremental",
  },
  retriever: {
    default_limit: 50,
    album_write_mode: "replace",
  },
  embedding: {
    provider: "open-clip",
    model: "ViT-B-32",
    pretrained: "laion2b_s34b_b79k",
    device: "auto",
    normalize: true,
    batch_size: 8,
  },
  debug: {
    save_diagnostics: false,
  },
});
