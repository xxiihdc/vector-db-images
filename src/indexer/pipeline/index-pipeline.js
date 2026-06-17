import { scanLibrary } from "../../scanner/services/scan-service.js";
import { extractPhotosRepresentations } from "../../scanner/photos/bridge-client.js";
import { createEmbeddingProvider } from "../../embedding/create-provider.js";
import { buildAssetRecord } from "../records/asset-record.js";
import { buildEmbeddingRecord } from "../records/embedding-record.js";

function decodeRepresentationBytes(representation) {
  if (!representation?.bytes_base64) {
    return null;
  }

  return Buffer.from(representation.bytes_base64, "base64");
}

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

async function buildCachedIndexState({
  config,
  catalogRepository,
  vectorRepository,
  limit,
}) {
  const cachedAssets = await catalogRepository.listAssets();
  const limitedAssets = cachedAssets.slice(0, limit ?? cachedAssets.length);
  const persistedAssets = [];
  const persistedEmbeddings = [];
  let skippedAssetCount = 0;

  for (const asset of limitedAssets) {
    const representationKind =
      asset.asset_type === "video" ? "video-poster-frame" : "image-thumbnail";
    const activeEmbedding = await vectorRepository.getActiveEmbedding({
      asset_id: asset.asset_id,
      representation_kind: representationKind,
      embedding_model: config.embedding?.model ?? "phase3-placeholder",
    });

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
    scanned_asset_count: cachedAssets.length,
    extracted_representation_count: 0,
    persisted_asset_count: persistedAssets.length,
    persisted_embedding_count: persistedEmbeddings.length,
    skipped_representation_count: skippedAssetCount,
    persisted_assets: persistedAssets,
    persisted_embeddings: persistedEmbeddings,
    skipped_representations: [],
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
} = {}) {
  if (!catalogRepository || !vectorRepository) {
    throw new Error("Index pipeline requires both catalog and vector repositories.");
  }

  async function run({ config, limit, timeoutSeconds, useCache = true } = {}) {
    if (useCache) {
      const cachedAssetCount = await catalogRepository.countAssets();

      if (cachedAssetCount > 0) {
        return buildCachedIndexState({
          config,
          catalogRepository,
          vectorRepository,
          limit,
        });
      }
    }

    const scanState = await Promise.resolve(scanLibraryFn());
    const extractionState = await Promise.resolve(
      extractRepresentationsFn({
        allowNetworkAccess: config.extractor?.allow_network_access ?? true,
        limit: limit ?? config.scanner?.batch_size ?? 200,
        thumbnailSize: config.extractor?.image_thumbnail_size ?? 224,
        timeoutSeconds,
      })
    );
    const timestamp = now();
    const embeddingProvider = createEmbeddingProviderFn({ config });
    const scannedAssetsById = new Map(
      (scanState.assets ?? []).map((asset) => [asset.local_identifier, asset])
    );
    const persistedAssets = [];
    const persistedEmbeddings = [];
    const skippedRepresentations = [];
    const pendingRepresentations = [];

    for (const representation of extractionState.representations ?? []) {
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
      const bytes = decodeRepresentationBytes(representation);

      if (!bytes) {
        skippedRepresentations.push({
          local_identifier: representation.local_identifier,
          asset_type: representation.asset_type,
          representation_kind: representation.representation_kind,
          status: "missing-bytes",
        });
        continue;
      }

      pendingRepresentations.push({
        representation,
        persistedAsset: await catalogRepository.upsertAsset(assetRecord),
      });
    }

    const embeddingResults = await embeddingProvider.embedRepresentations({
      representations: pendingRepresentations.map(({ representation }) => representation),
    });
    const embeddingResultsByKey = new Map(
      embeddingResults.map((embedding) => [
        `${embedding.local_identifier}::${embedding.representation_kind}`,
        embedding,
      ])
    );

    for (const { representation, persistedAsset } of pendingRepresentations) {
      const resultKey = `${representation.local_identifier}::${representation.representation_kind}`;
      const embeddingResult = embeddingResultsByKey.get(resultKey);

      if (!embeddingResult || embeddingResult.status !== "ready" || !embeddingResult.vector) {
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

      await vectorRepository.saveEmbedding({
        record: embeddingRecord,
        vector: embeddingResult.vector,
      });

      persistedAssets.push(persistedAsset.local_identifier);
      persistedEmbeddings.push({
        embedding_id: embeddingRecord.embedding_id,
        local_identifier: embeddingRecord.local_identifier,
        representation_kind: embeddingRecord.representation_kind,
        vector_dimensions: embeddingRecord.embedding_dimensions,
      });
    }

    return {
      implemented: true,
      phase: "ingestion",
      status: "completed",
      stages: ["scan", "extract", "normalize", "persist"],
      cache_mode: useCache ? "miss" : "refresh",
      scan_state: scanState,
      extraction_state: extractionState,
      scanned_asset_count: scanState.valid_asset_count ?? scanState.assets?.length ?? 0,
      extracted_representation_count: extractionState.representation_count ?? 0,
      persisted_asset_count: persistedAssets.length,
      persisted_embedding_count: persistedEmbeddings.length,
      skipped_representation_count: skippedRepresentations.length,
      persisted_assets: persistedAssets,
      persisted_embeddings: persistedEmbeddings,
      skipped_representations: skippedRepresentations,
      notes: [
        `Index persisted semantic vectors via ${embeddingProvider.modelIdentity}.`,
        "Embedding generation stays in-memory and does not write thumbnails or video proxies to disk.",
      ],
    };
  }

  return { run };
}
