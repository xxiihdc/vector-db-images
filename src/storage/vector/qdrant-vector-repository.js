import { createHash } from "node:crypto";
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

  if (filters.model_identity) {
    must.push({
      key: "model_identity",
      match: {
        value: filters.model_identity,
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
    model_identity,
    representation_kind,
    representation_kinds = [],
    statuses = [],
  } = filters;

  return embeddings.filter((embedding) => {
    if (embedding_model && embedding.embedding_model !== embedding_model) {
      return false;
    }

    if (model_identity && embedding.model_identity !== model_identity) {
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

function normalizeUpsertItem(item = {}) {
  const normalizedRecord = buildEmbeddingRecord({
    ...item.record,
    vector: item.vector,
    indexed_at: item?.record?.indexed_at ?? new Date().toISOString(),
  });
  requireEmbeddingRecord(normalizedRecord);

  if (!Array.isArray(item.vector) || item.vector.length === 0) {
    throw new AppError("Vector payload must be a non-empty number array.", {
      code: "VECTOR_VALUES_INVALID",
    });
  }

  return {
    record: normalizedRecord,
    vector: item.vector.map(Number),
  };
}

function normalizeCollectionSlugPart(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

function buildScopedCollectionName(baseCollectionName, modelIdentity) {
  if (!modelIdentity) {
    return baseCollectionName;
  }

  const normalizedBase = normalizeCollectionSlugPart(baseCollectionName) || "media-index";
  const normalizedIdentity =
    normalizeCollectionSlugPart(modelIdentity).slice(0, 48) || "default-model";
  const identityHash = createHash("sha1")
    .update(String(modelIdentity))
    .digest("hex")
    .slice(0, 12);

  return `${normalizedBase}--${normalizedIdentity}--${identityHash}`;
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
  const cachedCollections = new Map();
  let knownCollectionNames = null;

  function isManagedCollectionName(name) {
    return name === collectionName || String(name ?? "").startsWith(`${collectionName}--`);
  }

  function cacheCollectionInfo(name, info) {
    cachedCollections.set(name, info ?? null);
    return info;
  }

  function markKnownCollectionName(name) {
    if (!name) {
      return;
    }

    if (knownCollectionNames === null) {
      knownCollectionNames = [];
    }

    if (!knownCollectionNames.includes(name)) {
      knownCollectionNames.push(name);
      knownCollectionNames.sort();
    }
  }

  async function listCollectionNames() {
    if (knownCollectionNames !== null) {
      return [...knownCollectionNames];
    }

    const payload = await client.listCollections();
    knownCollectionNames = (payload?.result?.collections ?? [])
      .map((entry) => entry?.name)
      .filter(Boolean)
      .sort();
    return [...knownCollectionNames];
  }

  async function getCollectionInfo(targetCollectionName = collectionName) {
    if (cachedCollections.has(targetCollectionName)) {
      return cachedCollections.get(targetCollectionName);
    }

    const info = await client.getCollection(targetCollectionName);

    if (info) {
      markKnownCollectionName(targetCollectionName);
    }

    return cacheCollectionInfo(targetCollectionName, info);
  }

  async function listManagedCollectionNames() {
    const collectionNames = await listCollectionNames();
    return collectionNames.filter((name) => isManagedCollectionName(name));
  }

  async function resolveReadCollectionNames(modelIdentity = null) {
    const preferredCollectionName = buildScopedCollectionName(collectionName, modelIdentity);
    const existingManagedCollections = await listManagedCollectionNames();
    const candidateNames = [];

    if (modelIdentity) {
      candidateNames.push(preferredCollectionName);

      if (collectionName !== preferredCollectionName) {
        candidateNames.push(collectionName);
      }
    } else {
      candidateNames.push(...existingManagedCollections);

      if (!candidateNames.includes(collectionName)) {
        candidateNames.push(collectionName);
      }
    }

    return Array.from(new Set(candidateNames)).filter((name) => {
      if (name === preferredCollectionName) {
        return true;
      }

      return existingManagedCollections.includes(name);
    });
  }

  async function ensureCollection(targetCollectionName, vectorSize) {
    if (!Number.isFinite(vectorSize) || vectorSize <= 0) {
      throw new AppError("Qdrant collection creation requires a non-empty vector size.", {
        code: "VECTOR_DIMENSIONS_REQUIRED",
        details: { collection_name: targetCollectionName, vector_size: vectorSize ?? null },
      });
    }

    const existing = await getCollectionInfo(targetCollectionName);

    if (existing) {
      const vectorsConfig = extractCollectionVectorConfig(existing);
      const configuredSize = vectorsConfig?.size ?? vectorsConfig?.default?.size ?? null;

      if (configuredSize && configuredSize !== vectorSize) {
        throw new AppError(
          `Qdrant collection \`${targetCollectionName}\` already exists with vector size ${configuredSize}, expected ${vectorSize}.`,
          {
            code: "VECTOR_DIMENSIONS_MISMATCH",
            details: {
              collection_name: targetCollectionName,
              configured_size: configuredSize,
              expected_size: vectorSize,
            },
          }
        );
      }

      return cacheCollectionInfo(targetCollectionName, existing);
    }

    await client.createCollection(targetCollectionName, {
      vectors: {
        size: vectorSize,
        distance: qdrantDistance,
      },
      on_disk_payload: true,
    });

    markKnownCollectionName(targetCollectionName);
    return cacheCollectionInfo(targetCollectionName, await client.getCollection(targetCollectionName));
  }

  async function resolveSearchableCollectionNames({ modelIdentity, vectorSize = null } = {}) {
    const names = await resolveReadCollectionNames(modelIdentity);
    const resolvedNames = [];

    for (const name of names) {
      const collection = await getCollectionInfo(name);

      if (!collection) {
        continue;
      }

      const vectorsConfig = extractCollectionVectorConfig(collection);
      const configuredSize = vectorsConfig?.size ?? vectorsConfig?.default?.size ?? null;

      if (
        Number.isFinite(vectorSize) &&
        Number.isFinite(configuredSize) &&
        configuredSize !== vectorSize
      ) {
        continue;
      }

      resolvedNames.push(name);
    }

    return resolvedNames;
  }

  async function initialize() {
    try {
      const managedCollections = await listManagedCollectionNames();

      return {
        backend: "qdrant",
        service_url: serviceUrl,
        collection_name: collectionName,
        distance: qdrantDistance,
        reachable: true,
        collection_exists: managedCollections.length > 0,
        collection_strategy: "per-model-identity",
        managed_collection_names: managedCollections,
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
    const collectionNames = await resolveReadCollectionNames(filters.model_identity);
    const items = [];
    const seenEmbeddingIds = new Set();

    for (const targetCollectionName of collectionNames) {
      const collection = await getCollectionInfo(targetCollectionName);

      if (!collection) {
        continue;
      }

      let offset = null;

      do {
        const response = await client.scrollPoints(targetCollectionName, {
          limit: pageSize,
          filter: buildPayloadFilter(filters),
          with_payload: true,
          with_vector: includeVector,
          ...(offset ? { offset } : {}),
        });
        const points = extractPointArray(response);
        const nextPageOffset = extractNextPageOffset(response);

        for (const point of points) {
          const record = normalizePointRecord(point, { includeVector });

          if (record.embedding_id && seenEmbeddingIds.has(record.embedding_id)) {
            continue;
          }

          if (record.embedding_id) {
            seenEmbeddingIds.add(record.embedding_id);
          }

          items.push(record);
        }

        offset = nextPageOffset;
      } while (offset);
    }

    return postFilterEmbeddings(items, filters);
  }

  async function countEmbeddings(filters = {}) {
    const needsPostFilter =
      (Array.isArray(filters.statuses) && filters.statuses.length > 0) ||
      (Array.isArray(filters.representation_kinds) && filters.representation_kinds.length > 0);

    if (needsPostFilter) {
      const embeddings = await scrollEmbeddings({ filters });
      return embeddings.length;
    }

    const collectionNames = await resolveReadCollectionNames(filters.model_identity);
    let total = 0;

    for (const targetCollectionName of collectionNames) {
      const collection = await getCollectionInfo(targetCollectionName);

      if (!collection) {
        continue;
      }

      const response = await client.countPoints(targetCollectionName, {
        exact: true,
        filter: buildPayloadFilter(filters),
      });
      total += extractCount(response);
    }

    return total;
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
    const [persisted] = await upsertEmbeddings([{ record, vector }]);
    return persisted ?? null;
  }

  async function upsertEmbeddings(items = []) {
    if (!Array.isArray(items) || items.length === 0) {
      return [];
    }

    const normalizedItems = items.map((item) => normalizeUpsertItem(item));
    const itemsByCollection = new Map();

    for (const item of normalizedItems) {
      const targetCollectionName = buildScopedCollectionName(
        collectionName,
        item.record.model_identity
      );
      const existing = itemsByCollection.get(targetCollectionName) ?? [];
      existing.push(item);
      itemsByCollection.set(targetCollectionName, existing);
    }

    for (const [targetCollectionName, groupedItems] of itemsByCollection.entries()) {
      const vectorSize = groupedItems[0].vector.length;

      for (const item of groupedItems) {
        if (item.vector.length !== vectorSize) {
          throw new AppError("All vectors in a bulk upsert must have the same dimensions.", {
            code: "VECTOR_DIMENSIONS_MISMATCH",
            details: {
              collection_name: targetCollectionName,
              expected_size: vectorSize,
              received_size: item.vector.length,
              embedding_id: item.record.embedding_id,
            },
          });
        }
      }

      await ensureCollection(targetCollectionName, vectorSize);

      await client.upsertPoints(
        targetCollectionName,
        groupedItems.map(({ record: normalizedRecord, vector: normalizedVector }) => ({
          id: toPointId(normalizedRecord.embedding_id),
          vector: normalizedVector,
          payload: {
            ...normalizedRecord,
            embedding_dimensions:
              normalizedRecord.embedding_dimensions ?? normalizedVector.length,
          },
        }))
      );
    }

    return normalizedItems.map(({ record }) => record);
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
    model_identity,
  } = {}) {
    const embeddings = await scrollEmbeddings({
      filters: {
        asset_id,
        embedding_model,
        model_identity,
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
    model_identity,
    representation_kinds = [],
    limit = 10,
  } = {}) {
    const collectionNames = await resolveSearchableCollectionNames({
      modelIdentity: model_identity,
      vectorSize: Array.isArray(vector) ? vector.length : null,
    });

    if (collectionNames.length === 0) {
      return [];
    }

    const overfetchLimit = Math.min(Math.max(limit * 5, limit), 200);
    const hits = [];

    for (const targetCollectionName of collectionNames) {
      const response = await client.queryPoints(targetCollectionName, {
        query: vector.map(Number),
        filter: buildPayloadFilter({ embedding_model, model_identity }),
        limit: overfetchLimit,
        with_payload: true,
        with_vector: false,
      });
      const points = extractPointArray(response);

      hits.push(
        ...points.map((point) => ({
          embedding: normalizePointRecord(point),
          score: Number(point?.score ?? 0),
        }))
      );
    }

    return hits
      .filter(({ embedding }) =>
        postFilterEmbeddings([embedding], {
          embedding_model,
          model_identity,
          representation_kinds,
          statuses: ["ready", "stale"],
        }).length > 0
      )
      .sort((left, right) => right.score - left.score)
      .slice(0, limit);
  }

  return {
    initialize,
    countEmbeddings,
    getEmbeddingById,
    listEmbeddings,
    listEmbeddingsForAsset,
    saveEmbedding,
    upsertEmbedding,
    upsertEmbeddings,
    markEmbeddingStatus,
    getActiveEmbedding,
    searchByVector,
  };
}
