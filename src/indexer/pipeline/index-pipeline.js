import { scanLibrary } from "../../scanner/services/scan-service.js";
import { extractPhotosRepresentations } from "../../scanner/photos/bridge-client.js";
import { createEmbeddingProvider } from "../../embedding/create-provider.js";
import { buildAssetRecord } from "../records/asset-record.js";
import { buildEmbeddingRecord } from "../records/embedding-record.js";
import { AppError } from "../../shared/errors/app-error.js";
import { performance } from "node:perf_hooks";

function shouldPersistRepresentation(representation) {
  return (
    representation?.local_identifier &&
    representation?.representation_kind &&
    representation?.metadata?.status === "ok" &&
    representation?.byte_length > 0 &&
    representation?.bytes_base64
  );
}

function buildRepresentationAssetPayload(representation) {
  return {
    local_identifier: representation.local_identifier,
    asset_type: representation.asset_type,
    is_in_icloud: representation.metadata?.is_in_icloud ?? null,
  };
}

function buildExtractionSignature({
  representation,
  thumbnailSize,
  videoStrategy,
}) {
  if (representation.asset_type === "image") {
    return `image-thumbnail:${thumbnailSize}`;
  }

  if (representation.asset_type === "video") {
    return `video-${videoStrategy}:${thumbnailSize}`;
  }

  return `unknown:${thumbnailSize}`;
}

function getPreferredVideoRepresentationKinds(config) {
  const configuredStrategy = String(config?.extractor?.video_strategy ?? "storyboard").trim();
  const preferredKind =
    configuredStrategy === "poster-frame" ? "video-poster-frame" : "video-storyboard";
  const fallbackKind =
    preferredKind === "video-storyboard" ? "video-poster-frame" : "video-storyboard";

  return [preferredKind, fallbackKind];
}

function createEmptyVectorIndexState() {
  return {
    implemented: true,
    storage_mode: "vector-only",
    temp_file_usage: false,
    indexed_images: 0,
    indexed_videos: 0,
    attempted_representations: 0,
    ready_embeddings: 0,
    failed_embeddings: 0,
    provider_model_identity: null,
  };
}

function createEmptyTimings() {
  return {
    total_ms: 0,
    cache_read_ms: 0,
    scan_ms: 0,
    extract_ms: 0,
    prepare_ms: 0,
    embed_ms: 0,
    persist_ms: 0,
  };
}

function toDurationMs(startTime, endTime) {
  return Number(Math.max(0, endTime - startTime).toFixed(3));
}

function createRate(count, durationMs) {
  if (!Number.isFinite(count) || count <= 0 || !Number.isFinite(durationMs) || durationMs <= 0) {
    return 0;
  }

  return Number(((count * 1000) / durationMs).toFixed(3));
}

function incrementCount(counts, key) {
  counts.set(key, (counts.get(key) ?? 0) + 1);
}

function summarizeCounts(counts) {
  return Array.from(counts.entries())
    .sort((left, right) => right[1] - left[1] || String(left[0]).localeCompare(String(right[0])))
    .map(([name, count]) => ({ name, count }));
}

function createBreakdown({
  extractionState,
  preparedCounts,
  skippedRepresentations,
  vectorIndexState,
}) {
  const skippedByType = new Map();
  const skippedByReason = new Map();

  for (const skippedRepresentation of skippedRepresentations) {
    incrementCount(skippedByType, skippedRepresentation?.asset_type ?? "unknown");
    incrementCount(skippedByReason, skippedRepresentation?.status ?? "unknown");
  }

  return {
    image_representation_count: extractionState?.image_representation_count ?? 0,
    video_representation_count: extractionState?.video_representation_count ?? 0,
    prepared_image_count: preparedCounts?.get("image") ?? 0,
    prepared_video_count: preparedCounts?.get("video") ?? 0,
    skipped_image_count: skippedByType.get("image") ?? 0,
    skipped_video_count: skippedByType.get("video") ?? 0,
    failed_embedding_count: vectorIndexState?.failed_embeddings ?? 0,
    skip_reasons: summarizeCounts(skippedByReason),
  };
}

function determineSlowestStage(timings) {
  const candidates = [
    ["cache-read", timings.cache_read_ms],
    ["scan", timings.scan_ms],
    ["extract", timings.extract_ms],
    ["prepare", timings.prepare_ms],
    ["embed", timings.embed_ms],
    ["persist", timings.persist_ms],
  ].filter(([, duration]) => Number.isFinite(duration) && duration > 0);

  if (candidates.length === 0) {
    return {
      stage: "none",
      duration_ms: 0,
      percent_of_total: 0,
    };
  }

  candidates.sort((left, right) => right[1] - left[1]);
  const [stage, durationMs] = candidates[0];

  return {
    stage,
    duration_ms: durationMs,
    percent_of_total:
      Number.isFinite(timings.total_ms) && timings.total_ms > 0
        ? Number(((durationMs / timings.total_ms) * 100).toFixed(2))
        : 0,
  };
}

function createThroughput({
  scannedAssetCount,
  extractedRepresentationCount,
  persistedEmbeddingCount,
  timings,
}) {
  return {
    scan_candidates_per_sec: createRate(scannedAssetCount, timings.scan_ms),
    representations_extracted_per_sec: createRate(
      extractedRepresentationCount,
      timings.extract_ms
    ),
    embeddings_persisted_per_sec: createRate(
      persistedEmbeddingCount,
      timings.persist_ms
    ),
  };
}

function createEmptyExtractionState() {
  return {
    implemented: true,
    available_asset_count: 0,
    representation_count: 0,
    image_representation_count: 0,
    video_representation_count: 0,
    errors: [],
  };
}

function sliceIntoChunks(items = [], chunkSize = 1) {
  if (!Array.isArray(items) || items.length === 0) {
    return [];
  }

  const normalizedChunkSize = Math.max(1, Math.trunc(chunkSize) || 1);
  const chunks = [];

  for (let index = 0; index < items.length; index += normalizedChunkSize) {
    chunks.push(items.slice(index, index + normalizedChunkSize));
  }

  return chunks;
}

function waitMs(durationMs) {
  return new Promise((resolve) => {
    setTimeout(resolve, durationMs);
  });
}

function isRetriableVectorWriteError(error) {
  if (!(error instanceof AppError)) {
    return false;
  }

  return [
    "VECTOR_BACKEND_UNREACHABLE",
    "VECTOR_BACKEND_TIMEOUT",
    "VECTOR_BACKEND_HTTP_ERROR",
  ].includes(error.code);
}

async function buildCachedIndexState({
  config,
  catalogRepository,
  vectorRepository,
  limit,
  clock,
}) {
  const cacheReadStart = clock();
  const cachedAssets = await catalogRepository.listAssets();
  const limitedAssets = cachedAssets.slice(0, limit ?? cachedAssets.length);
  const persistedAssets = [];
  const persistedEmbeddings = [];
  let skippedAssetCount = 0;

  for (const asset of limitedAssets) {
    const representationKinds =
      asset.asset_type === "video"
        ? getPreferredVideoRepresentationKinds(config)
        : ["image-thumbnail"];
    let activeEmbedding = null;

    for (const representationKind of representationKinds) {
      activeEmbedding = await vectorRepository.getActiveEmbedding({
        asset_id: asset.asset_id,
        representation_kind: representationKind,
        embedding_model: config.embedding?.model ?? "phase3-placeholder",
      });

      if (activeEmbedding) {
        break;
      }
    }

    if (!activeEmbedding) {
      skippedAssetCount += 1;
      continue;
    }

    persistedAssets.push(asset.local_identifier);
    persistedEmbeddings.push({
      embedding_id: activeEmbedding.embedding_id,
      local_identifier: activeEmbedding.local_identifier,
      representation_kind: activeEmbedding.representation_kind,
      vector_dimensions: activeEmbedding.embedding_dimensions,
    });
  }

  const cacheReadEnd = clock();
  const timings = createEmptyTimings();
  timings.cache_read_ms = toDurationMs(cacheReadStart, cacheReadEnd);
  timings.total_ms = timings.cache_read_ms;
  const throughput = createThroughput({
    scannedAssetCount: cachedAssets.length,
    extractedRepresentationCount: 0,
    persistedEmbeddingCount: persistedEmbeddings.length,
    timings,
  });
  const breakdown = {
    image_representation_count: 0,
    video_representation_count: 0,
    prepared_image_count: 0,
    prepared_video_count: 0,
    skipped_image_count: skippedAssetCount,
    skipped_video_count: 0,
    failed_embedding_count: 0,
    skip_reasons:
      skippedAssetCount > 0
        ? [{ name: "missing-active-embedding", count: skippedAssetCount }]
        : [],
  };
  const slowestStage = determineSlowestStage(timings);

  return {
    implemented: true,
    phase: "ingestion",
    status: "completed",
    stages: ["cache-read"],
    cache_mode: "hit",
    scan_state: {
      implemented: true,
      source: "catalog-cache",
      valid_asset_count: cachedAssets.length,
      assets: limitedAssets,
    },
    extraction_state: {
      implemented: true,
      source: "vector-cache",
      representation_count: persistedEmbeddings.length,
      representations: [],
    },
    vector_index_state: {
      ...createEmptyVectorIndexState(),
      storage_mode: "cache-hit",
      attempted_representations: persistedEmbeddings.length,
      ready_embeddings: persistedEmbeddings.length,
      provider_model_identity:
        config.embedding?.provider && config.embedding?.model
          ? `${config.embedding.provider}:${config.embedding.model}:${config.embedding?.pretrained ?? "unknown"}`
          : null,
    },
    scanned_asset_count: cachedAssets.length,
    extracted_representation_count: 0,
    persisted_asset_count: persistedAssets.length,
    persisted_embedding_count: persistedEmbeddings.length,
    skipped_representation_count: skippedAssetCount,
    persisted_assets: persistedAssets,
    persisted_embeddings: persistedEmbeddings,
    skipped_representations: [],
    timings,
    throughput,
    breakdown,
    slowest_stage: slowestStage,
    notes: [
      "Index used cached catalog/vector records and skipped Photos bridge refresh.",
      "Run the command again with `--no-cache` to rescan Photos and update the local cache.",
    ],
  };
}

export function createIndexPipeline({
  scanLibraryFn = scanLibrary,
  extractRepresentationsFn = extractPhotosRepresentations,
  createEmbeddingProviderFn = createEmbeddingProvider,
  catalogRepository,
  vectorRepository,
  now = () => new Date().toISOString(),
  clock = () => performance.now(),
  onProgress = null,
} = {}) {
  if (!catalogRepository || !vectorRepository) {
    throw new Error("Index pipeline requires both catalog and vector repositories.");
  }

  function reportProgress(event, details = {}) {
    if (typeof onProgress !== "function") {
      return;
    }

    onProgress({
      event,
      ...details,
    });
  }

  async function run({ config, limit, timeoutSeconds, useCache = true } = {}) {
    const totalStart = clock();
    if (useCache) {
      const cachedAssetCount = await catalogRepository.countAssets();

      if (cachedAssetCount > 0) {
        reportProgress("cache-hit", {
          cached_asset_count: cachedAssetCount,
          limit,
        });
        return buildCachedIndexState({
          config,
          catalogRepository,
          vectorRepository,
          limit,
          clock,
        });
      }
    }

    reportProgress("scan-start", { limit });
    const scanStart = clock();
    const scanState = await Promise.resolve(scanLibraryFn());
    const scanEnd = clock();
    const scanMs = toDurationMs(scanStart, scanEnd);
    reportProgress("scan-complete", {
      scanned_asset_count: scanState.valid_asset_count ?? scanState.assets?.length ?? 0,
      duration_ms: scanMs,
    });
    reportProgress("extract-start", {
      limit: limit ?? config.scanner?.batch_size ?? 200,
      thumbnail_size: config.extractor?.image_thumbnail_size ?? 224,
    });
    const extractionChunkSize = Math.max(
      1,
      Math.min(
        config.indexer?.extraction_batch_size ?? 200,
        limit ?? config.scanner?.batch_size ?? 200
      )
    );
    const persistWriteBatchSize = Math.max(
      1,
      Math.trunc(config.indexer?.write_batch_size ?? 64) || 64
    );
    const persistRetryCount = 3;
    const extractionTarget = limit ?? config.scanner?.batch_size ?? 200;
    const extractionState = createEmptyExtractionState();
    extractionState.available_asset_count =
      scanState.valid_asset_count ?? scanState.assets?.length ?? 0;
    const timestamp = now();
    const embeddingProvider = createEmbeddingProviderFn({ config });
    const scannedAssetsById = new Map(
      (scanState.assets ?? []).map((asset) => [asset.local_identifier, asset])
    );
    const persistedAssets = [];
    const persistedEmbeddings = [];
    const skippedRepresentations = [];
    const preparedCounts = new Map();
    const vectorIndexState = createEmptyVectorIndexState();
    vectorIndexState.provider_model_identity = embeddingProvider.modelIdentity;

    let extractionOffset = 0;
    let extractMs = 0;
    let prepareMs = 0;
    let embedMs = 0;
    let persistMs = 0;

    try {
      while (extractionOffset < extractionTarget) {
        const chunkLimit = Math.min(extractionChunkSize, extractionTarget - extractionOffset);

        const extractChunkStart = clock();
        const extractionChunk = await Promise.resolve(
          extractRepresentationsFn({
            allowNetworkAccess: config.extractor?.allow_network_access ?? true,
            limit: chunkLimit,
            offset: extractionOffset,
            thumbnailSize: config.extractor?.image_thumbnail_size ?? 224,
            videoStrategy: config.extractor?.video_strategy ?? "storyboard",
            timeoutSeconds,
          })
        );
        const extractChunkDuration = toDurationMs(extractChunkStart, clock());
        extractMs += extractChunkDuration;

        extractionState.implemented =
          extractionState.implemented && (extractionChunk.implemented ?? true);
        extractionState.available_asset_count =
          extractionChunk.available_asset_count ?? extractionState.available_asset_count;
        extractionState.representation_count += extractionChunk.representation_count ?? 0;
        extractionState.image_representation_count +=
          extractionChunk.image_representation_count ?? 0;
        extractionState.video_representation_count +=
          extractionChunk.video_representation_count ?? 0;
        extractionState.errors.push(...(extractionChunk.errors ?? []));

        extractionOffset += chunkLimit;
        reportProgress("extract-batch-complete", {
          chunk_limit: chunkLimit,
          chunk_offset: extractionOffset - chunkLimit,
          chunk_representation_count: extractionChunk.representation_count ?? 0,
          completed_representation_count: extractionState.representation_count,
          completed_asset_count: extractionOffset,
          target_asset_count: extractionTarget,
          duration_ms: extractChunkDuration,
        });

        const pendingRepresentations = [];
        const prepareChunkStart = clock();
        for (const representation of extractionChunk.representations ?? []) {
          if (!shouldPersistRepresentation(representation)) {
            skippedRepresentations.push({
              local_identifier: representation?.local_identifier ?? null,
              asset_type: representation?.asset_type ?? null,
              representation_kind: representation?.representation_kind ?? null,
              status: representation?.metadata?.status ?? "unknown",
            });
            continue;
          }

          const scannedAsset =
            scannedAssetsById.get(representation.local_identifier) ??
            buildRepresentationAssetPayload(representation);
          const assetRecord = buildAssetRecord({
            ...scannedAsset,
            indexed_at: timestamp,
            last_seen_at: timestamp,
          });
          pendingRepresentations.push({
            representation,
            persistedAsset: await catalogRepository.upsertAsset(assetRecord),
          });
          incrementCount(preparedCounts, representation?.asset_type ?? "unknown");
        }
        const prepareChunkDuration = toDurationMs(prepareChunkStart, clock());
        prepareMs += prepareChunkDuration;
        vectorIndexState.attempted_representations += pendingRepresentations.length;

        if (pendingRepresentations.length > 0) {
          reportProgress("embed-start", {
            representation_count: pendingRepresentations.length,
            model_identity: embeddingProvider.modelIdentity,
            chunk_offset: extractionOffset - chunkLimit,
            chunk_limit: chunkLimit,
          });
          const embedChunkStart = clock();
          const embeddingResults = await embeddingProvider.embedRepresentations({
            representations: pendingRepresentations.map(({ representation }) => representation),
          });
          const embedChunkDuration = toDurationMs(embedChunkStart, clock());
          embedMs += embedChunkDuration;
          reportProgress("embed-complete", {
            embedding_result_count: embeddingResults.length,
            duration_ms: embedChunkDuration,
            chunk_offset: extractionOffset - chunkLimit,
            chunk_limit: chunkLimit,
          });
          const embeddingResultsByKey = new Map(
            embeddingResults.map((embedding) => [
              `${embedding.local_identifier}::${embedding.representation_kind}`,
              embedding,
            ])
          );

          const persistChunkStart = clock();
          reportProgress("persist-start", {
            attempted_representations: pendingRepresentations.length,
            chunk_offset: extractionOffset - chunkLimit,
            chunk_limit: chunkLimit,
          });
          const readyPersistItems = [];
          const readyPersistMetadata = [];

          for (const { representation, persistedAsset } of pendingRepresentations) {
            const resultKey = `${representation.local_identifier}::${representation.representation_kind}`;
            const embeddingResult = embeddingResultsByKey.get(resultKey);

            if (!embeddingResult || embeddingResult.status !== "ready" || !embeddingResult.vector) {
              vectorIndexState.failed_embeddings += 1;
              skippedRepresentations.push({
                local_identifier: representation.local_identifier,
                asset_type: representation.asset_type,
                representation_kind: representation.representation_kind,
                status: embeddingResult?.error_code ?? embeddingResult?.status ?? "embedding-missing",
              });
              continue;
            }

            const embeddingRecord = buildEmbeddingRecord({
              asset_id: persistedAsset.asset_id,
              local_identifier: persistedAsset.local_identifier,
              representation_kind: representation.representation_kind,
              embedding_provider: embeddingResult.embedding_provider,
              embedding_model: embeddingResult.embedding_model,
              model_identity: embeddingResult.model_identity,
              embedding_dimensions: embeddingResult.vector.length,
              source_fingerprint: persistedAsset.source_fingerprint,
              indexed_at: timestamp,
              extraction_signature: buildExtractionSignature({
                representation,
                thumbnailSize: config.extractor?.image_thumbnail_size ?? 224,
                videoStrategy: config.extractor?.video_strategy ?? "poster-frame",
              }),
            });

            readyPersistItems.push({
              record: embeddingRecord,
              vector: embeddingResult.vector,
            });
            readyPersistMetadata.push({
              representation,
              embeddingRecord,
            });
          }

          if (readyPersistItems.length > 0) {
            const persistBatches = sliceIntoChunks(
              readyPersistItems.map((item, index) => ({
                item,
                metadata: readyPersistMetadata[index],
              })),
              persistWriteBatchSize
            );

            for (const persistBatch of persistBatches) {
              const batchItems = persistBatch.map(({ item }) => item);
              let attempt = 0;

              while (true) {
                try {
                  await vectorRepository.upsertEmbeddings(batchItems);
                  break;
                } catch (error) {
                  attempt += 1;

                  if (!isRetriableVectorWriteError(error) || attempt >= persistRetryCount) {
                    throw new AppError("Vector backend bulk persist failed for a sub-batch.", {
                      code: "VECTOR_BULK_PERSIST_FAILED",
                      details: {
                        chunk_offset: extractionOffset - chunkLimit,
                        chunk_limit: chunkLimit,
                        persist_batch_size: batchItems.length,
                        attempt,
                        retry_limit: persistRetryCount,
                        write_batch_size: persistWriteBatchSize,
                      },
                      cause: error,
                    });
                  }

                  reportProgress("persist-retry", {
                    chunk_offset: extractionOffset - chunkLimit,
                    chunk_limit: chunkLimit,
                    persist_batch_size: batchItems.length,
                    attempt,
                    retry_limit: persistRetryCount,
                    error_code: error?.code ?? "UNHANDLED_ERROR",
                    error_message: error?.message ?? "Unknown error",
                  });
                  await waitMs(250 * attempt);
                }
              }
            }
          }

          for (const { representation, embeddingRecord } of readyPersistMetadata) {
            vectorIndexState.ready_embeddings += 1;
            if (representation.asset_type === "video") {
              vectorIndexState.indexed_videos += 1;
            } else if (representation.asset_type === "image") {
              vectorIndexState.indexed_images += 1;
            }
            persistedAssets.push(embeddingRecord.local_identifier);
            persistedEmbeddings.push({
              embedding_id: embeddingRecord.embedding_id,
              local_identifier: embeddingRecord.local_identifier,
              representation_kind: embeddingRecord.representation_kind,
              vector_dimensions: embeddingRecord.embedding_dimensions,
            });

            reportProgress("persist-item", {
              persisted_asset_count: persistedAssets.length,
              persisted_embedding_count: persistedEmbeddings.length,
              failed_embedding_count: vectorIndexState.failed_embeddings,
              local_identifier: embeddingRecord.local_identifier,
              representation_kind: embeddingRecord.representation_kind,
            });
          }
          const persistChunkDuration = toDurationMs(persistChunkStart, clock());
          persistMs += persistChunkDuration;
          reportProgress("persist-complete", {
            persisted_asset_count: persistedAssets.length,
            persisted_embedding_count: persistedEmbeddings.length,
            failed_embedding_count: vectorIndexState.failed_embeddings,
            skipped_representation_count: skippedRepresentations.length,
            duration_ms: persistChunkDuration,
            chunk_offset: extractionOffset - chunkLimit,
            chunk_limit: chunkLimit,
          });
        }

        if ((extractionChunk.representation_count ?? 0) < chunkLimit) {
          break;
        }
      }
    } catch (error) {
      throw new AppError("Index pipeline failed after partially persisting completed chunks.", {
        code: "INDEX_PIPELINE_PARTIAL_FAILURE",
        details: {
          chunk_offset: Math.max(0, extractionOffset - extractionChunkSize),
          extraction_target: extractionTarget,
          extracted_representation_count: extractionState.representation_count,
          persisted_asset_count: persistedAssets.length,
          persisted_embedding_count: persistedEmbeddings.length,
          skipped_representation_count: skippedRepresentations.length,
          write_batch_size: persistWriteBatchSize,
          cause_code: error?.code ?? "UNHANDLED_ERROR",
          cause_message: error?.message ?? "Unknown error",
        },
        cause: error,
      });
    }

    reportProgress("extract-complete", {
      representation_count: extractionState.representation_count ?? 0,
      image_representation_count: extractionState.image_representation_count ?? 0,
      video_representation_count: extractionState.video_representation_count ?? 0,
      duration_ms: extractMs,
    });
    reportProgress("prepare-complete", {
      attempted_representations: vectorIndexState.attempted_representations,
      skipped_representations: skippedRepresentations.length,
      duration_ms: prepareMs,
    });

    const totalEnd = clock();
    const timings = createEmptyTimings();
    timings.total_ms = toDurationMs(totalStart, totalEnd);
    timings.scan_ms = scanMs;
    timings.extract_ms = extractMs;
    timings.prepare_ms = prepareMs;
    timings.embed_ms = embedMs;
    timings.persist_ms = persistMs;
    const throughput = createThroughput({
      scannedAssetCount: scanState.valid_asset_count ?? scanState.assets?.length ?? 0,
      extractedRepresentationCount: extractionState.representation_count ?? 0,
      persistedEmbeddingCount: persistedEmbeddings.length,
      timings,
    });
    const breakdown = createBreakdown({
      extractionState,
      preparedCounts,
      skippedRepresentations,
      vectorIndexState,
    });
    const slowestStage = determineSlowestStage(timings);

    return {
      implemented: true,
      phase: "ingestion",
      status: "completed",
      stages: ["scan", "extract", "normalize", "persist"],
      cache_mode: useCache ? "miss" : "refresh",
      scan_state: scanState,
      extraction_state: extractionState,
      vector_index_state: vectorIndexState,
      scanned_asset_count: scanState.valid_asset_count ?? scanState.assets?.length ?? 0,
      extracted_representation_count: extractionState.representation_count ?? 0,
      persisted_asset_count: persistedAssets.length,
      persisted_embedding_count: persistedEmbeddings.length,
      skipped_representation_count: skippedRepresentations.length,
      persisted_assets: persistedAssets,
      persisted_embeddings: persistedEmbeddings,
      skipped_representations: skippedRepresentations,
      timings,
      throughput,
      breakdown,
      slowest_stage: slowestStage,
      notes: [
        `Index persisted semantic vectors via ${embeddingProvider.modelIdentity}.`,
        "Embedding generation batches in-memory image thumbnails and lightweight video-derived representations without writing temp files.",
        "Index now checkpoints progress chunk-by-chunk so completed chunks stay persisted if a later chunk fails.",
      ],
    };
  }

  return { run };
}
