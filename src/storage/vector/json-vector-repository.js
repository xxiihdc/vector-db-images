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

function cosineSimilarity(left = [], right = []) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length === 0 || right.length === 0) {
    return null;
  }

  if (left.length !== right.length) {
    return null;
  }

  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;

  for (let index = 0; index < left.length; index += 1) {
    const leftValue = Number(left[index]);
    const rightValue = Number(right[index]);

    if (!Number.isFinite(leftValue) || !Number.isFinite(rightValue)) {
      return null;
    }

    dot += leftValue * rightValue;
    leftMagnitude += leftValue * leftValue;
    rightMagnitude += rightValue * rightValue;
  }

  if (leftMagnitude === 0 || rightMagnitude === 0) {
    return null;
  }

  return dot / (Math.sqrt(leftMagnitude) * Math.sqrt(rightMagnitude));
}

function filterEmbeddings(embeddings, filters = {}) {
  const {
    asset_id,
    embedding_id,
    embedding_model,
    model_identity,
    local_identifier,
    representation_kind,
    representation_kinds = [],
    statuses = null,
  } = filters;

  return embeddings.filter((embedding) => {
    if (asset_id && embedding.asset_id !== asset_id) {
      return false;
    }

    if (embedding_id && embedding.embedding_id !== embedding_id) {
      return false;
    }

    if (embedding_model && embedding.embedding_model !== embedding_model) {
      return false;
    }

    if (model_identity && embedding.model_identity !== model_identity) {
      return false;
    }

    if (local_identifier && embedding.local_identifier !== local_identifier) {
      return false;
    }

    if (representation_kind && embedding.representation_kind !== representation_kind) {
      return false;
    }

    if (
      representation_kinds.length > 0 &&
      !representation_kinds.includes(embedding.representation_kind)
    ) {
      return false;
    }

    if (Array.isArray(statuses) && statuses.length > 0 && !statuses.includes(embedding.status)) {
      return false;
    }

    return true;
  });
}

export function createJsonVectorRepository({ filePath }) {
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
      backend: store.backend,
      file_path: filePath,
      schema_version: store.schema_version,
      embedding_count: store.embeddings.length,
      vector_count: store.vectors.length,
      reachable: true,
      collection_exists: true,
    };
  }

  async function countEmbeddings(filters = {}) {
    const store = await loadStore(filePath);
    return filterEmbeddings(store.embeddings, filters).length;
  }

  async function getEmbeddingById(embeddingId) {
    const store = await loadStore(filePath);
    return store.embeddings.find((embedding) => embedding.embedding_id === embeddingId) ?? null;
  }

  async function listEmbeddingsForAsset(assetId) {
    const store = await loadStore(filePath);
    return filterEmbeddings(store.embeddings, { asset_id: assetId });
  }

  async function listEmbeddings(filters = {}) {
    const store = await loadStore(filePath);
    return filterEmbeddings(store.embeddings, filters);
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

  async function upsertEmbedding({ record, vector }) {
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

  async function upsertEmbeddings(items = []) {
    if (!Array.isArray(items) || items.length === 0) {
      return [];
    }

    const store = await loadStore(filePath);
    const persisted = [];

    for (const item of items) {
      const normalizedRecord = buildEmbeddingRecord({
        ...item?.record,
        vector: item?.vector,
        indexed_at: item?.record?.indexed_at ?? new Date().toISOString(),
      });
      requireEmbeddingRecord(normalizedRecord);

      if (item?.vector && (!Array.isArray(item.vector) || item.vector.length === 0)) {
        throw new AppError("Vector payload must be a non-empty number array.", {
          code: "VECTOR_VALUES_INVALID",
        });
      }

      if (item?.vector) {
        const nextVector = normalizeVectorEntry({
          vector_ref: normalizedRecord.vector_ref,
          values: item.vector,
          embedding_dimensions: normalizedRecord.embedding_dimensions,
          updated_at: normalizedRecord.indexed_at,
        });

        if (!nextVector.vector_ref) {
          throw new AppError("Vector payload requires `vector_ref`.", {
            code: "VECTOR_REF_REQUIRED",
          });
        }

        const currentVectorIndex = store.vectors.findIndex(
          (vector) => vector.vector_ref === nextVector.vector_ref
        );

        if (currentVectorIndex === -1) {
          store.vectors.push(nextVector);
        } else {
          store.vectors[currentVectorIndex] = nextVector;
        }
      }

      const currentEmbeddingIndex = store.embeddings.findIndex(
        (embedding) => embedding.embedding_id === normalizedRecord.embedding_id
      );

      if (currentEmbeddingIndex === -1) {
        store.embeddings.push(normalizedRecord);
      } else {
        store.embeddings[currentEmbeddingIndex] = buildEmbeddingRecord({
          ...store.embeddings[currentEmbeddingIndex],
          ...normalizedRecord,
        });
      }

      persisted.push(normalizedRecord);
    }

    await saveStore(filePath, store);
    return persisted;
  }

  async function saveEmbedding(payload) {
    return upsertEmbedding(payload);
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

    return upsertEmbedding({
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
    model_identity,
  }) {
    const store = await loadStore(filePath);
    const vectorRefs = new Set(store.vectors.map((vector) => vector.vector_ref));
    const candidates = filterEmbeddings(store.embeddings, {
      asset_id,
      embedding_model,
      model_identity,
      representation_kind,
      statuses: ["ready", "stale"],
    })
      .filter((embedding) => embedding.vector_ref && vectorRefs.has(embedding.vector_ref))
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

  async function listActiveEmbeddings({
    embedding_model,
    model_identity,
    representation_kinds = [],
  } = {}) {
    const store = await loadStore(filePath);
    const vectorRefs = new Set(store.vectors.map((vector) => vector.vector_ref));
    const groupedCandidates = new Map();

    for (const embedding of filterEmbeddings(store.embeddings, {
      embedding_model,
      model_identity,
      representation_kinds,
      statuses: ["ready", "stale"],
    })) {
      if (!embedding.vector_ref || !vectorRefs.has(embedding.vector_ref)) {
        continue;
      }

      const groupKey = [
        embedding.asset_id,
        embedding.representation_kind,
        embedding.model_identity ?? embedding.embedding_model,
      ].join("::");
      const current = groupedCandidates.get(groupKey);

      if (!current) {
        groupedCandidates.set(groupKey, embedding);
        continue;
      }

      const statusDelta =
        getStatusPriority(embedding.status) - getStatusPriority(current.status);

      if (statusDelta > 0) {
        groupedCandidates.set(groupKey, embedding);
        continue;
      }

      if (
        statusDelta === 0 &&
        String(embedding.indexed_at ?? "").localeCompare(String(current.indexed_at ?? "")) > 0
      ) {
        groupedCandidates.set(groupKey, embedding);
      }
    }

    return Array.from(groupedCandidates.values()).sort((left, right) =>
      String(right.indexed_at ?? "").localeCompare(String(left.indexed_at ?? ""))
    );
  }

  async function searchByVector({
    vector,
    embedding_model,
    model_identity,
    representation_kinds = [],
    limit = 10,
  } = {}) {
    const activeEmbeddings = await listActiveEmbeddings({
      embedding_model,
      model_identity,
      representation_kinds,
    });

    const hits = [];

    for (const embedding of activeEmbeddings) {
      const vectorEntry = await getVector(embedding.vector_ref);

      if (!vectorEntry?.values?.length) {
        continue;
      }

      const score = cosineSimilarity(vector, vectorEntry.values);

      if (score === null) {
        continue;
      }

      hits.push({
        embedding,
        score,
      });
    }

    hits.sort((left, right) => right.score - left.score);
    return hits.slice(0, limit);
  }

  return {
    initialize,
    countEmbeddings,
    getEmbeddingById,
    listEmbeddings,
    listEmbeddingsForAsset,
    getVector,
    putVector,
    saveEmbedding,
    upsertEmbedding,
    upsertEmbeddings,
    markEmbeddingStatus,
    getActiveEmbedding,
    listActiveEmbeddings,
    searchByVector,
  };
}
