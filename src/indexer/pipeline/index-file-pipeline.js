import { createEmbeddingProvider } from "../../embedding/create-provider.js";
import { buildAssetRecord } from "../records/asset-record.js";
import { buildEmbeddingRecord } from "../records/embedding-record.js";
import { readLocalImageFile } from "../../shared/utils/local-image-file.js";
import { AppError } from "../../shared/errors/app-error.js";

function requireReadyEmbedding(embedding, imagePath) {
  if (embedding?.status === "ready" && Array.isArray(embedding.vector) && embedding.vector.length > 0) {
    return embedding;
  }

  throw new AppError("Failed to embed local image file for indexing.", {
    code: "INDEX_FILE_EMBED_FAILED",
    details: {
      image_path: imagePath,
      error_code: embedding?.error_code ?? null,
      error_message: embedding?.error_message ?? null,
    },
  });
}

export async function indexLocalImageFile({
  imagePath,
  config,
  catalogRepository,
  vectorRepository,
  createEmbeddingProviderFn = createEmbeddingProvider,
  now = () => new Date().toISOString(),
} = {}) {
  if (!catalogRepository || !vectorRepository) {
    throw new AppError("Local image file indexing requires both catalog and vector repositories.", {
      code: "INDEX_FILE_REPOSITORIES_REQUIRED",
    });
  }

  const imageFile = await readLocalImageFile(imagePath);
  const indexedAt = now();
  const assetRecord = buildAssetRecord({
    local_identifier: imageFile.local_identifier,
    asset_type: "image",
    modification_date: imageFile.modification_date,
    indexed_at: indexedAt,
    last_seen_at: indexedAt,
    source_fingerprint: imageFile.source_fingerprint,
  });
  const representation = {
    local_identifier: assetRecord.local_identifier,
    asset_type: "image",
    representation_kind: "image-thumbnail",
    mime_type: imageFile.mime_type,
    byte_length: imageFile.byte_length,
    bytes_base64: imageFile.bytes_base64,
    sha256: imageFile.sha256,
    metadata: {
      status: "ok",
      source: "local-image-file",
      original_file_name: imageFile.file_name,
    },
  };

  const embeddingProvider = createEmbeddingProviderFn({ config });
  const [embedding] = await embeddingProvider.embedRepresentations({
    representations: [representation],
  });
  const readyEmbedding = requireReadyEmbedding(embedding, imageFile.absolute_path);
  const extractorResolution =
    embeddingProvider.targetResolution ??
    config?.embedding?.target_resolution ??
    config?.extractor?.image_thumbnail_size ??
    224;

  await catalogRepository.upsertAsset(assetRecord);
  const embeddingRecord = buildEmbeddingRecord({
    asset_id: assetRecord.asset_id,
    local_identifier: assetRecord.local_identifier,
    representation_kind: representation.representation_kind,
    embedding_provider: readyEmbedding.embedding_provider,
    embedding_model: readyEmbedding.embedding_model,
    model_identity: readyEmbedding.model_identity,
    candidate_preset: embeddingProvider.candidatePreset,
    target_resolution: extractorResolution,
    source_fingerprint: imageFile.source_fingerprint,
    extraction_signature: `external-file:image-thumbnail:${extractorResolution}`,
    indexed_at: indexedAt,
    status: "ready",
  });
  await vectorRepository.upsertEmbedding({
    record: embeddingRecord,
    vector: readyEmbedding.vector,
  });

  return {
    implemented: true,
    phase: "validation",
    status: "completed",
    source_kind: "local-image-file",
    image_path: imageFile.absolute_path,
    file_name: imageFile.file_name,
    local_identifier: assetRecord.local_identifier,
    asset_id: assetRecord.asset_id,
    embedding_id: embeddingRecord.embedding_id,
    representation_kind: representation.representation_kind,
    embedding_model: readyEmbedding.embedding_model,
    model_identity: readyEmbedding.model_identity,
    vector_dimensions: readyEmbedding.vector.length,
    byte_length: imageFile.byte_length,
    source_fingerprint: imageFile.source_fingerprint,
    notes: [
      "Indexed one local image file through the same embedding provider used for normal image representations.",
      "The local image test asset is stored with a deterministic synthetic localIdentifier derived from file content.",
    ],
  };
}
