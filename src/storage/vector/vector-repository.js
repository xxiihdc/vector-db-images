import path from "node:path";
import { AppError } from "../../shared/errors/app-error.js";
import {
  ensureDir,
  pathExists,
  readJsonFile,
  writeJsonFile,
} from "../../shared/utils/fs.js";
import { buildEmbeddingRecord } from "../../indexer/records/embedding-record.js";

const VECTOR_SCHEMA_VERSION = 1;

function createEmptyVectorStore() {
  return {
    schema_version: VECTOR_SCHEMA_VERSION,
    backend: "json-file",
    embeddings: [],
    vectors: [],
  };
}

function normalizeVectorEntry(payload = {}) {
  return {
    vector_ref: payload.vector_ref ?? null,
    values: Array.isArray(payload.values) ? payload.values.map(Number) : [],
    embedding_dimensions:
      payload.embedding_dimensions ??
      (Array.isArray(payload.values) ? payload.values.length : 0),
    updated_at: payload.updated_at ?? new Date().toISOString(),
  };
}

function normalizeVectorStore(store) {
  if (!store || typeof store !== "object") {
    return createEmptyVectorStore();
  }

  return {
    schema_version: store.schema_version ?? VECTOR_SCHEMA_VERSION,
    backend: store.backend ?? "json-file",
    embeddings: Array.isArray(store.embeddings)
      ? store.embeddings.map((embedding) => buildEmbeddingRecord(embedding))
      : [],
    vectors: Array.isArray(store.vectors)
      ? store.vectors.map((vector) => normalizeVectorEntry(vector))
      : [],
  };
}

async function loadStore(filePath) {
  const exists = await pathExists(filePath);

  if (!exists) {
    return createEmptyVectorStore();
  }

  return normalizeVectorStore(await readJsonFile(filePath));
}

async function saveStore(filePath, store) {
  await writeJsonFile(filePath, normalizeVectorStore(store));
}

function requireEmbeddingRecord(record) {
  if (!record.embedding_id) {
    throw new AppError("Embedding record requires `embedding_id`.", {
      code: "VECTOR_EMBEDDING_ID_REQUIRED",
    });
  }

  if (!record.asset_id) {
    throw new AppError("Embedding record requires `asset_id`.", {
      code: "VECTOR_ASSET_ID_REQUIRED",
    });
  }
}

function getStatusPriority(status) {
  if (status === "ready") {
    return 2;
  }

  if (status === "stale") {
    return 1;
  }

  return 0;
}

export function createVectorRepository({ filePath }) {
  if (!filePath) {
    throw new AppError("Vector repository requires `filePath`.", {
      code: "VECTOR_FILE_PATH_REQUIRED",
    });
  }

  async function initialize() {
    await ensureDir(path.dirname(filePath));
    const store = await loadStore(filePath);
    await saveStore(filePath, store);

    return {
      file_path: filePath,
      backend: store.backend,
      schema_version: store.schema_version,
      embedding_count: store.embeddings.length,
      vector_count: store.vectors.length,
    };
  }

  async function countEmbeddings() {
    const store = await loadStore(filePath);
    return store.embeddings.length;
  }

  async function getEmbeddingById(embeddingId) {
    const store = await loadStore(filePath);
    return store.embeddings.find((embedding) => embedding.embedding_id === embeddingId) ?? null;
  }

  async function listEmbeddingsForAsset(assetId) {
    const store = await loadStore(filePath);
    return store.embeddings.filter((embedding) => embedding.asset_id === assetId);
  }

  async function getVector(vectorRef) {
    const store = await loadStore(filePath);
    return store.vectors.find((vector) => vector.vector_ref === vectorRef) ?? null;
  }

  async function putVector({
    vector_ref,
    values,
    embedding_dimensions,
    updated_at = new Date().toISOString(),
  }) {
    const store = await loadStore(filePath);
    const nextVector = normalizeVectorEntry({
      vector_ref,
      values,
      embedding_dimensions,
      updated_at,
    });

    if (!nextVector.vector_ref) {
      throw new AppError("Vector payload requires `vector_ref`.", {
        code: "VECTOR_REF_REQUIRED",
      });
    }

    const currentIndex = store.vectors.findIndex(
      (vector) => vector.vector_ref === nextVector.vector_ref
    );

    if (currentIndex === -1) {
      store.vectors.push(nextVector);
    } else {
      store.vectors[currentIndex] = nextVector;
    }

    await saveStore(filePath, store);
    return getVector(nextVector.vector_ref);
  }

  async function saveEmbedding({ record, vector }) {
    const normalizedRecord = buildEmbeddingRecord({
      ...record,
      vector,
      indexed_at: record?.indexed_at ?? new Date().toISOString(),
    });
    requireEmbeddingRecord(normalizedRecord);

    if (vector && (!Array.isArray(vector) || vector.length === 0)) {
      throw new AppError("Vector payload must be a non-empty number array.", {
        code: "VECTOR_VALUES_INVALID",
      });
    }

    if (vector) {
      await putVector({
        vector_ref: normalizedRecord.vector_ref,
        values: vector,
        embedding_dimensions: normalizedRecord.embedding_dimensions,
        updated_at: normalizedRecord.indexed_at,
      });
    }

    const store = await loadStore(filePath);
    const currentIndex = store.embeddings.findIndex(
      (embedding) => embedding.embedding_id === normalizedRecord.embedding_id
    );

    if (currentIndex === -1) {
      store.embeddings.push(normalizedRecord);
    } else {
      store.embeddings[currentIndex] = buildEmbeddingRecord({
        ...store.embeddings[currentIndex],
        ...normalizedRecord,
      });
    }

    await saveStore(filePath, store);
    return getEmbeddingById(normalizedRecord.embedding_id);
  }

  async function markEmbeddingStatus(
    embeddingId,
    status,
    indexedAt = new Date().toISOString()
  ) {
    const existing = await getEmbeddingById(embeddingId);

    if (!existing) {
      return null;
    }

    return saveEmbedding({
      record: {
        ...existing,
        status,
        indexed_at: indexedAt,
      },
    });
  }

  async function getActiveEmbedding({
    asset_id,
    representation_kind,
    embedding_model,
  }) {
    const store = await loadStore(filePath);
    const vectorRefs = new Set(store.vectors.map((vector) => vector.vector_ref));
    const candidates = store.embeddings
      .filter((embedding) => embedding.asset_id === asset_id)
      .filter((embedding) =>
        representation_kind ? embedding.representation_kind === representation_kind : true
      )
      .filter((embedding) =>
        embedding_model ? embedding.embedding_model === embedding_model : true
      )
      .filter((embedding) => {
        if (!embedding.vector_ref || !vectorRefs.has(embedding.vector_ref)) {
          return false;
        }

        return embedding.status === "ready" || embedding.status === "stale";
      })
      .sort((left, right) => {
        const statusDelta =
          getStatusPriority(right.status) - getStatusPriority(left.status);

        if (statusDelta !== 0) {
          return statusDelta;
        }

        return String(right.indexed_at ?? "").localeCompare(String(left.indexed_at ?? ""));
      });

    return candidates[0] ?? null;
  }

  return {
    initialize,
    countEmbeddings,
    getEmbeddingById,
    listEmbeddingsForAsset,
    getVector,
    putVector,
    saveEmbedding,
    markEmbeddingStatus,
    getActiveEmbedding,
  };
}
