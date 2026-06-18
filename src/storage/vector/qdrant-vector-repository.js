import { AppError } from "../../shared/errors/app-error.js";
import { buildEmbeddingRecord } from "../../indexer/records/embedding-record.js";
import { createQdrantClient } from "./qdrant-client.js";

function getStatusPriority(status) {
  if (status === "ready") {
    return 2;
  }

  if (status === "stale") {
    return 1;
  }

  return 0;
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

function toQdrantDistance(distance) {
  const normalized = String(distance ?? "cosine").trim().toLowerCase();

  if (normalized === "cosine") {
    return "Cosine";
  }

  if (normalized === "dot") {
    return "Dot";
  }

  if (normalized === "euclid" || normalized === "l2") {
    return "Euclid";
  }

  throw new AppError(`Unsupported vector distance: ${distance}`, {
    code: "VECTOR_DISTANCE_UNSUPPORTED",
    details: { distance },
  });
}

function toPointId(embeddingId) {
  const hex = String(embeddingId ?? "").replace(/^[^:]+:/, "").replace(/[^a-f0-9]/gi, "");

  if (hex.length < 32) {
    throw new AppError("Embedding id cannot be converted to a deterministic Qdrant point id.", {
      code: "VECTOR_POINT_ID_INVALID",
      details: { embedding_id: embeddingId },
    });
  }

  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-");
}

function extractCollectionVectorConfig(result) {
  return (
    result?.result?.config?.params?.vectors ??
    result?.result?.vectors ??
    result?.result?.params?.vectors ??
    null
  );
}

function extractPointArray(payload) {
  if (Array.isArray(payload?.result?.points)) {
    return payload.result.points;
  }

  if (Array.isArray(payload?.result)) {
    return payload.result;
  }

  if (Array.isArray(payload?.points)) {
    return payload.points;
  }

  return [];
}

function extractCount(payload) {
  return payload?.result?.count ?? 0;
}

function extractNextPageOffset(payload) {
  return payload?.result?.next_page_offset ?? payload?.next_page_offset ?? null;
}

function buildPayloadFilter(filters = {}) {
  const must = [];

  if (filters.embedding_id) {
    must.push({
      key: "embedding_id",
      match: {
        value: filters.embedding_id,
      },
    });
  }

  if (filters.asset_id) {
    must.push({
      key: "asset_id",
      match: {
        value: filters.asset_id,
      },
    });
  }

  if (filters.local_identifier) {
    must.push({
      key: "local_identifier",
      match: {
        value: filters.local_identifier,
      },
    });
  }

  if (filters.embedding_model) {
    must.push({
      key: "embedding_model",
      match: {
        value: filters.embedding_model,
      },
    });
  }

  if (filters.representation_kind) {
    must.push({
      key: "representation_kind",
      match: {
        value: filters.representation_kind,
      },
    });
  }

  return must.length > 0 ? { must } : null;
}

function postFilterEmbeddings(embeddings, filters = {}) {
  const {
    embedding_model,
    representation_kind,
    representation_kinds = [],
    statuses = [],
  } = filters;

  return embeddings.filter((embedding) => {
    if (embedding_model && embedding.embedding_model !== embedding_model) {
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

    if (statuses.length > 0 && !statuses.includes(embedding.status)) {
      return false;
    }

    return true;
  });
}

function sortActiveEmbeddings(left, right) {
  const statusDelta = getStatusPriority(right.status) - getStatusPriority(left.status);

  if (statusDelta !== 0) {
    return statusDelta;
  }

  return String(right.indexed_at ?? "").localeCompare(String(left.indexed_at ?? ""));
}

function buildRemediationDetails({ serviceUrl, collectionName }) {
  return {
    service_url: serviceUrl,
    collection_name: collectionName,
    remediation: [
      "Start a local Qdrant sidecar before running index/search commands.",
      "Docker example: `docker run -p 6333:6333 -v $(pwd)/.data/qdrant:/qdrant/storage qdrant/qdrant`",
      "Then run `mvi storage vector-check` to confirm reachability.",
    ],
  };
}

function normalizePointRecord(point, { includeVector = false } = {}) {
  const payload = point?.payload ?? {};
  const vector = Array.isArray(point?.vector)
    ? point.vector.map(Number)
    : Array.isArray(point?.vector?.default)
      ? point.vector.default.map(Number)
      : null;

  const record = buildEmbeddingRecord({
    ...payload,
    embedding_dimensions:
      payload.embedding_dimensions ??
      (Array.isArray(vector) ? vector.length : null),
  });

  if (includeVector) {
    return {
      ...record,
      vector,
    };
  }

  return record;
}

export function createQdrantVectorRepository({
  serviceUrl,
  collectionName,
  distance = "cosine",
  timeoutMs = 10000,
  fetchFn,
} = {}) {
  if (!serviceUrl) {
    throw new AppError("Qdrant vector repository requires `serviceUrl`.", {
      code: "VECTOR_SERVICE_URL_REQUIRED",
    });
  }

  if (!collectionName) {
    throw new AppError("Qdrant vector repository requires `collectionName`.", {
      code: "VECTOR_COLLECTION_NAME_REQUIRED",
    });
  }

  const qdrantDistance = toQdrantDistance(distance);
  const client = createQdrantClient({
    serviceUrl,
    timeoutMs,
    fetchFn,
  });
  let cachedCollection = null;

  async function getCollectionInfo() {
    return client.getCollection(collectionName);
  }

  function cacheCollectionInfo(info) {
    cachedCollection = info;
    return info;
  }

  async function ensureCollection(vectorSize) {
    if (!Number.isFinite(vectorSize) || vectorSize <= 0) {
      throw new AppError("Qdrant collection creation requires a non-empty vector size.", {
        code: "VECTOR_DIMENSIONS_REQUIRED",
        details: { collection_name: collectionName, vector_size: vectorSize ?? null },
      });
    }

    const existing = cachedCollection ?? (await getCollectionInfo());

    if (existing) {
      const vectorsConfig = extractCollectionVectorConfig(existing);
      const configuredSize = vectorsConfig?.size ?? vectorsConfig?.default?.size ?? null;

      if (configuredSize && configuredSize !== vectorSize) {
        throw new AppError(
          `Qdrant collection \`${collectionName}\` already exists with vector size ${configuredSize}, expected ${vectorSize}.`,
          {
            code: "VECTOR_DIMENSIONS_MISMATCH",
            details: {
              collection_name: collectionName,
              configured_size: configuredSize,
              expected_size: vectorSize,
            },
          }
        );
      }

      return cacheCollectionInfo(existing);
    }

    await client.createCollection(collectionName, {
      vectors: {
        size: vectorSize,
        distance: qdrantDistance,
      },
      on_disk_payload: true,
    });

    return cacheCollectionInfo(await getCollectionInfo());
  }

  async function initialize() {
    try {
      await client.listCollections();
      const collection = await getCollectionInfo();

      if (collection) {
        cacheCollectionInfo(collection);
      }

      return {
        backend: "qdrant",
        service_url: serviceUrl,
        collection_name: collectionName,
        distance: qdrantDistance,
        reachable: true,
        collection_exists: Boolean(collection),
      };
    } catch (error) {
      if (error instanceof AppError && error.code === "VECTOR_BACKEND_UNREACHABLE") {
        error.details = {
          ...(error.details ?? {}),
          ...buildRemediationDetails({ serviceUrl, collectionName }),
        };
      }

      throw error;
    }
  }

  async function scrollEmbeddings({
    filters = {},
    includeVector = false,
    pageSize = 128,
  } = {}) {
    const collection = cachedCollection ?? (await getCollectionInfo());

    if (!collection) {
      return [];
    }

    cacheCollectionInfo(collection);
    const items = [];
    let offset = null;

    do {
      const response = await client.scrollPoints(collectionName, {
        limit: pageSize,
        filter: buildPayloadFilter(filters),
        with_payload: true,
        with_vector: includeVector,
        ...(offset ? { offset } : {}),
      });
      const points = extractPointArray(response);
      const nextPageOffset = extractNextPageOffset(response);

      for (const point of points) {
        items.push(normalizePointRecord(point, { includeVector }));
      }

      offset = nextPageOffset;
    } while (offset);

    return postFilterEmbeddings(items, filters);
  }

  async function countEmbeddings(filters = {}) {
    const collection = cachedCollection ?? (await getCollectionInfo());

    if (!collection) {
      return 0;
    }

    cacheCollectionInfo(collection);
    const needsPostFilter =
      (Array.isArray(filters.statuses) && filters.statuses.length > 0) ||
      (Array.isArray(filters.representation_kinds) && filters.representation_kinds.length > 0);

    if (needsPostFilter) {
      const embeddings = await scrollEmbeddings({ filters });
      return embeddings.length;
    }

    const response = await client.countPoints(collectionName, {
      exact: true,
      filter: buildPayloadFilter(filters),
    });

    return extractCount(response);
  }

  async function getEmbeddingById(embeddingId, { includeVector = false } = {}) {
    const embeddings = await scrollEmbeddings({
      filters: { embedding_id: embeddingId },
      includeVector,
      pageSize: 1,
    });

    return embeddings[0] ?? null;
  }

  async function listEmbeddings(filters = {}) {
    return scrollEmbeddings({ filters });
  }

  async function listEmbeddingsForAsset(assetId) {
    return scrollEmbeddings({
      filters: { asset_id: assetId },
    });
  }

  async function upsertEmbedding({ record, vector }) {
    const normalizedRecord = buildEmbeddingRecord({
      ...record,
      vector,
      indexed_at: record?.indexed_at ?? new Date().toISOString(),
    });
    requireEmbeddingRecord(normalizedRecord);

    if (!Array.isArray(vector) || vector.length === 0) {
      throw new AppError("Vector payload must be a non-empty number array.", {
        code: "VECTOR_VALUES_INVALID",
      });
    }

    await ensureCollection(vector.length);
    const qdrantPointId = toPointId(normalizedRecord.embedding_id);

    await client.upsertPoints(collectionName, [
      {
        id: qdrantPointId,
        vector: vector.map(Number),
        payload: {
          ...normalizedRecord,
          embedding_dimensions: normalizedRecord.embedding_dimensions ?? vector.length,
        },
      },
    ]);

    return getEmbeddingById(normalizedRecord.embedding_id);
  }

  async function saveEmbedding(payload) {
    return upsertEmbedding(payload);
  }

  async function markEmbeddingStatus(
    embeddingId,
    status,
    indexedAt = new Date().toISOString()
  ) {
    const existing = await getEmbeddingById(embeddingId, { includeVector: true });

    if (!existing) {
      return null;
    }

    return upsertEmbedding({
      record: {
        ...existing,
        status,
        indexed_at: indexedAt,
      },
      vector: existing.vector,
    });
  }

  async function getActiveEmbedding({
    asset_id,
    representation_kind,
    embedding_model,
  } = {}) {
    const embeddings = await scrollEmbeddings({
      filters: {
        asset_id,
        embedding_model,
        representation_kind,
        statuses: ["ready", "stale"],
      },
    });

    embeddings.sort(sortActiveEmbeddings);
    return embeddings[0] ?? null;
  }

  async function searchByVector({
    vector,
    embedding_model,
    representation_kinds = [],
    limit = 10,
  } = {}) {
    const collection = cachedCollection ?? (await getCollectionInfo());

    if (!collection) {
      return [];
    }

    cacheCollectionInfo(collection);
    const overfetchLimit = Math.min(Math.max(limit * 5, limit), 200);
    const response = await client.queryPoints(collectionName, {
      query: vector.map(Number),
      filter: buildPayloadFilter({ embedding_model }),
      limit: overfetchLimit,
      with_payload: true,
      with_vector: false,
    });
    const points = extractPointArray(response);
    const hits = points
      .map((point) => ({
        embedding: normalizePointRecord(point),
        score: Number(point?.score ?? 0),
      }))
      .filter(({ embedding }) =>
        postFilterEmbeddings([embedding], {
          embedding_model,
          representation_kinds,
          statuses: ["ready", "stale"],
        }).length > 0
      )
      .sort((left, right) => right.score - left.score);

    return hits.slice(0, limit);
  }

  return {
    initialize,
    countEmbeddings,
    getEmbeddingById,
    listEmbeddings,
    listEmbeddingsForAsset,
    saveEmbedding,
    upsertEmbedding,
    markEmbeddingStatus,
    getActiveEmbedding,
    searchByVector,
  };
}
