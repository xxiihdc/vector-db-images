import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { Readable } from "node:stream";
import { createCatalogRepository } from "../src/storage/catalog/catalog-repository.js";
import { createVectorRepository } from "../src/storage/vector/vector-repository.js";
import { buildAssetRecord } from "../src/indexer/records/asset-record.js";
import { buildEmbeddingRecord } from "../src/indexer/records/embedding-record.js";
import { initializeProjectScaffold } from "../src/config/load-config.js";
import { DEFAULT_CONFIG } from "../src/config/defaults/config.js";
import { validateConfig } from "../src/config/schema/config-schema.js";
import {
  STORAGE_LAYOUT,
  formatStorageSummaryLines,
} from "../src/storage/storage-layout.js";
import { runInitCommand } from "../src/cli/commands/init.js";
import { createIndexPipeline } from "../src/indexer/pipeline/index-pipeline.js";
import { createEmbeddingProvider } from "../src/embedding/create-provider.js";
import { buildCapabilityLines } from "../src/embedding/providers/open-clip/remediation.js";
import { createSearchService } from "../src/retriever/query/search-service.js";
import { createAlbumService } from "../src/retriever/album/album-service.js";
import { runSearchCommand } from "../src/cli/commands/search.js";
import { runServeCommand } from "../src/cli/commands/serve.js";
import { runIndexLikeCommand } from "../src/cli/commands/index-command-base.js";
import { AppError } from "../src/shared/errors/app-error.js";
import { executeSearchWorkflow } from "../src/app/search/execute-search-workflow.js";
import { runIndexFileCommand } from "../src/cli/commands/index-file.js";
import { indexLocalImageFile } from "../src/indexer/pipeline/index-file-pipeline.js";
import {
  createSearchWebServer,
} from "../src/server/search-web-server.js";

const TINY_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+yF9sAAAAASUVORK5CYII=";

async function withTempDir(callback) {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "mvi-storage-test-"));

  try {
    await callback(tempDir);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function writeTinyPng(tempDir, fileName = "tiny.png") {
  const filePath = path.join(tempDir, fileName);
  await writeFile(filePath, Buffer.from(TINY_PNG_BASE64, "base64"));
  return filePath;
}

function createJsonResponse(status, payload) {
  return {
    status,
    async json() {
      return payload;
    },
  };
}

function createMockRequest({ method = "GET", url = "/", body = null } = {}) {
  const chunks =
    body === null || body === undefined
      ? []
      : [Buffer.from(typeof body === "string" ? body : JSON.stringify(body))];
  const request = Readable.from(chunks);
  request.method = method;
  request.url = url;
  request.headers = {};
  return request;
}

function createMockResponse() {
  const state = {
    statusCode: 200,
    headers: {},
    body: "",
    headersSent: false,
  };

  let resolveResponse;
  const completed = new Promise((resolve) => {
    resolveResponse = resolve;
  });

  return {
    get headersSent() {
      return state.headersSent;
    },
    writeHead(statusCode, headers = {}) {
      state.statusCode = statusCode;
      state.headers = headers;
      state.headersSent = true;
    },
    end(chunk = "") {
      state.body += chunk;
      resolveResponse({
        statusCode: state.statusCode,
        headers: state.headers,
        body: state.body,
      });
    },
    destroy(error) {
      resolveResponse(Promise.reject(error));
    },
    completed,
  };
}

async function dispatchServerRequest(server, options = {}) {
  const request = createMockRequest(options);
  const response = createMockResponse();
  server.emit("request", request, response);
  const result = await response.completed;

  return {
    status: result.statusCode,
    headers: result.headers,
    body: result.body,
    json() {
      return JSON.parse(result.body);
    },
  };
}

function matchesMustCondition(point, condition) {
  if (!condition?.key) {
    return true;
  }

  if (Array.isArray(condition?.match?.any)) {
    return condition.match.any.includes(point.payload?.[condition.key]);
  }

  return point.payload?.[condition.key] === condition?.match?.value;
}

function matchesFilter(point, filter) {
  if (!filter?.must?.length) {
    return true;
  }

  return filter.must.every((condition) => matchesMustCondition(point, condition));
}

function cosineSimilarity(left = [], right = []) {
  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;

  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index];
    leftMagnitude += left[index] * left[index];
    rightMagnitude += right[index] * right[index];
  }

  return dot / (Math.sqrt(leftMagnitude) * Math.sqrt(rightMagnitude));
}

function createMockQdrantFetch() {
  const state = {
    collections: new Map(),
    pointsByCollection: new Map(),
    calls: [],
  };

  function getCollectionName(pathname) {
    const match = pathname.match(/^\/collections\/([^/]+)/);
    return match ? decodeURIComponent(match[1]) : null;
  }

  function getPointsMap(collectionName) {
    const existing = state.pointsByCollection.get(collectionName);

    if (existing) {
      return existing;
    }

    const next = new Map();
    state.pointsByCollection.set(collectionName, next);
    return next;
  }

  async function fetchFn(url, options = {}) {
    const parsedUrl = new URL(url);
    const method = options.method ?? "GET";
    const pathname = parsedUrl.pathname;
    const body = options.body ? JSON.parse(options.body) : null;
    state.calls.push({ method, pathname, body });

    if (method === "GET" && pathname === "/collections") {
      return createJsonResponse(200, {
        status: "ok",
        result: {
          collections: Array.from(state.collections.values()).map((collection) => ({
            name: collection.name,
          })),
        },
      });
    }

    const collectionName = getCollectionName(pathname);

    if (
      collectionName &&
      pathname === `/collections/${encodeURIComponent(collectionName)}` &&
      method === "GET"
    ) {
      const collection = state.collections.get(collectionName);

      if (!collection) {
        return createJsonResponse(404, {
          status: "error",
          result: null,
        });
      }

      return createJsonResponse(200, {
        status: "ok",
        result: {
          config: {
            params: {
              vectors: {
                size: collection.size,
                distance: collection.distance,
              },
            },
          },
        },
      });
    }

    if (
      collectionName &&
      pathname === `/collections/${encodeURIComponent(collectionName)}` &&
      method === "PUT"
    ) {
      state.collections.set(collectionName, {
        name: collectionName,
        size: body.vectors.size,
        distance: body.vectors.distance,
      });
      return createJsonResponse(200, {
        status: "ok",
        result: true,
      });
    }

    if (
      collectionName &&
      pathname === `/collections/${encodeURIComponent(collectionName)}/points` &&
      method === "PUT"
    ) {
      const points = getPointsMap(collectionName);

      for (const point of body.points ?? []) {
        points.set(point.id, structuredClone(point));
      }

      return createJsonResponse(200, {
        status: "ok",
        result: {
          operation_id: 1,
          status: "acknowledged",
        },
      });
    }

    if (
      collectionName &&
      pathname === `/collections/${encodeURIComponent(collectionName)}/points/scroll` &&
      method === "POST"
    ) {
      const filteredPoints = Array.from(getPointsMap(collectionName).values())
        .filter((point) => matchesFilter(point, body?.filter))
        .map((point) => ({
          id: point.id,
          payload: structuredClone(point.payload),
          vector: body?.with_vector ? structuredClone(point.vector) : undefined,
        }));

      return createJsonResponse(200, {
        status: "ok",
        result: {
          points: filteredPoints,
          next_page_offset: null,
        },
      });
    }

    if (
      collectionName &&
      pathname === `/collections/${encodeURIComponent(collectionName)}/points/count` &&
      method === "POST"
    ) {
      const count = Array.from(getPointsMap(collectionName).values()).filter((point) =>
        matchesFilter(point, body?.filter)
      ).length;

      return createJsonResponse(200, {
        status: "ok",
        result: {
          count,
        },
      });
    }

    if (
      collectionName &&
      pathname === `/collections/${encodeURIComponent(collectionName)}/points/query` &&
      method === "POST"
    ) {
      const hits = Array.from(getPointsMap(collectionName).values())
        .filter((point) => matchesFilter(point, body?.filter))
        .map((point) => ({
          id: point.id,
          payload: structuredClone(point.payload),
          score: cosineSimilarity(body.query, point.vector),
        }))
        .sort((left, right) => right.score - left.score)
        .slice(0, body.limit ?? 10);

      return createJsonResponse(200, {
        status: "ok",
        result: {
          points: hits,
        },
      });
    }

    throw new Error(`Unhandled mock Qdrant request: ${method} ${pathname}`);
  }

  return {
    fetchFn,
    state,
  };
}

test("asset record builder creates deterministic ids and source fingerprint", async () => {
  const record = buildAssetRecord({
    local_identifier: "A1B2C3/L0/001",
    asset_type: "image",
    pixel_width: 4032,
    pixel_height: 3024,
    modification_date: "2026-06-10T08:00:00.000Z",
  });

  assert.match(record.asset_id, /^asset:[a-f0-9]{64}$/);
  assert.equal(
    record.source_fingerprint,
    "2026-06-10T08:00:00.000Z|4032|3024|null|image"
  );
});

test("embedding record keeps candidate metadata and changes fingerprint when rollout settings change", async () => {
  const baseline = buildEmbeddingRecord({
    asset_id: "asset:001",
    local_identifier: "IMG/001",
    representation_kind: "image-thumbnail",
    embedding_provider: "open-clip",
    embedding_model: "ViT-B-32",
    model_identity: "open-clip:ViT-B-32:laion2b_s34b_b79k",
    candidate_preset: "baseline",
    target_resolution: 224,
    source_fingerprint: "fp:001",
    extraction_signature: "image-thumbnail:224",
    indexed_at: "2026-06-18T10:00:00.000Z",
  });
  const upgrade = buildEmbeddingRecord({
    asset_id: "asset:001",
    local_identifier: "IMG/001",
    representation_kind: "image-thumbnail",
    embedding_provider: "open-clip",
    embedding_model: "ViT-H-14",
    model_identity: "open-clip:ViT-H-14:laion2b_s32b_b79k",
    candidate_preset: "fallback-safe",
    target_resolution: 378,
    source_fingerprint: "fp:001",
    extraction_signature: "image-thumbnail:378",
    indexed_at: "2026-06-18T11:00:00.000Z",
  });

  assert.equal(baseline.candidate_preset, "baseline");
  assert.equal(baseline.target_resolution, 224);
  assert.equal(baseline.extraction_signature, "image-thumbnail:224");
  assert.notEqual(baseline.content_fingerprint, upgrade.content_fingerprint);
  assert.notEqual(baseline.embedding_id, upgrade.embedding_id);
});

test("catalog repository upserts by local identifier without duplicates", async () => {
  await withTempDir(async (tempDir) => {
    const repository = createCatalogRepository({
      filePath: path.join(tempDir, "catalog-store.json"),
    });

    await repository.initialize();
    await repository.upsertAsset({
      local_identifier: "A1B2C3/L0/001",
      asset_type: "image",
      pixel_width: 4032,
    });
    await repository.upsertAsset({
      local_identifier: "A1B2C3/L0/001",
      asset_type: "image",
      pixel_width: 2048,
      last_seen_at: "2026-06-17T10:00:00.000Z",
    });

    const record = await repository.getAssetByLocalIdentifier("A1B2C3/L0/001");

    assert.equal(await repository.countAssets(), 1);
    assert.equal(record.pixel_width, 2048);
    assert.equal(record.last_seen_at, "2026-06-17T10:00:00.000Z");
  });
});

test("vector repository returns stale embedding as active fallback when ready vector exists", async () => {
  await withTempDir(async (tempDir) => {
    const repository = createVectorRepository({
      filePath: path.join(tempDir, "vector-store.json"),
    });

    await repository.initialize();

    const embedding = buildEmbeddingRecord({
      asset_id: "asset:123",
      local_identifier: "A1B2C3/L0/001",
      representation_kind: "image-thumbnail",
      embedding_provider: "open-clip",
      embedding_model: "test-model",
      source_fingerprint: "fp:1",
      image_thumbnail_size: 224,
    });

    await repository.saveEmbedding({
      record: {
        ...embedding,
        indexed_at: "2026-06-17T10:00:00.000Z",
      },
      vector: [0.1, 0.2, 0.3],
    });

    await repository.markEmbeddingStatus(
      embedding.embedding_id,
      "stale",
      "2026-06-17T10:05:00.000Z"
    );

    const active = await repository.getActiveEmbedding({
      asset_id: "asset:123",
      representation_kind: "image-thumbnail",
      embedding_model: "test-model",
    });
    const vector = await repository.getVector(active.vector_ref);

    assert.equal(active.status, "stale");
    assert.deepEqual(vector.values, [0.1, 0.2, 0.3]);
  });
});

test("vector repository filters active embedding and vector search by model identity", async () => {
  await withTempDir(async (tempDir) => {
    const repository = createVectorRepository({
      filePath: path.join(tempDir, "vector-store.json"),
    });

    await repository.initialize();

    const firstEmbedding = buildEmbeddingRecord({
      asset_id: "asset:model-identity-json",
      local_identifier: "JSON/MODEL/001",
      representation_kind: "image-thumbnail",
      embedding_provider: "open-clip",
      embedding_model: "ViT-B-32",
      model_identity: "open-clip:ViT-B-32:baseline",
      source_fingerprint: "fp:model-identity-json",
      indexed_at: "2026-06-18T08:00:00.000Z",
    });
    const secondEmbedding = buildEmbeddingRecord({
      asset_id: "asset:model-identity-json",
      local_identifier: "JSON/MODEL/001",
      representation_kind: "image-thumbnail",
      embedding_provider: "open-clip",
      embedding_model: "ViT-B-32",
      model_identity: "open-clip:ViT-B-32:upgrade",
      source_fingerprint: "fp:model-identity-json",
      indexed_at: "2026-06-18T09:00:00.000Z",
    });

    await repository.saveEmbedding({
      record: firstEmbedding,
      vector: [1, 0, 0],
    });
    await repository.saveEmbedding({
      record: secondEmbedding,
      vector: [0, 1, 0],
    });

    const baselineActive = await repository.getActiveEmbedding({
      asset_id: firstEmbedding.asset_id,
      representation_kind: "image-thumbnail",
      embedding_model: "ViT-B-32",
      model_identity: "open-clip:ViT-B-32:baseline",
    });
    const upgradeActive = await repository.getActiveEmbedding({
      asset_id: firstEmbedding.asset_id,
      representation_kind: "image-thumbnail",
      embedding_model: "ViT-B-32",
      model_identity: "open-clip:ViT-B-32:upgrade",
    });
    const baselineHits = await repository.searchByVector({
      vector: [1, 0, 0],
      embedding_model: "ViT-B-32",
      model_identity: "open-clip:ViT-B-32:baseline",
      representation_kinds: ["image-thumbnail"],
      limit: 5,
    });
    const upgradeHits = await repository.searchByVector({
      vector: [0, 1, 0],
      embedding_model: "ViT-B-32",
      model_identity: "open-clip:ViT-B-32:upgrade",
      representation_kinds: ["image-thumbnail"],
      limit: 5,
    });

    assert.equal(baselineActive.embedding_id, firstEmbedding.embedding_id);
    assert.equal(upgradeActive.embedding_id, secondEmbedding.embedding_id);
    assert.equal(baselineHits.length, 1);
    assert.equal(upgradeHits.length, 1);
    assert.equal(baselineHits[0].embedding.embedding_id, firstEmbedding.embedding_id);
    assert.equal(upgradeHits[0].embedding.embedding_id, secondEmbedding.embedding_id);
  });
});

test("qdrant vector repository upserts without duplicates and keeps stale embedding searchable", async () => {
  const qdrant = createMockQdrantFetch();
  const repository = createVectorRepository({
    backend: "qdrant",
    serviceUrl: "http://127.0.0.1:6333",
    collectionName: "media-index",
    distance: "cosine",
    fetchFn: qdrant.fetchFn,
  });

  const initialized = await repository.initialize();
  assert.equal(initialized.reachable, true);
  assert.equal(initialized.collection_exists, false);

  const embedding = buildEmbeddingRecord({
    asset_id: "asset:qdrant-1",
    local_identifier: "QDRANT/001",
    representation_kind: "image-thumbnail",
    embedding_provider: "open-clip",
    embedding_model: "ViT-B-32",
    model_identity: "open-clip:ViT-B-32:laion2b_s34b_b79k",
    source_fingerprint: "fp:qdrant-1",
    indexed_at: "2026-06-18T09:00:00.000Z",
  });

  await repository.upsertEmbedding({
    record: embedding,
    vector: [0.9, 0.1, 0],
  });
  await repository.upsertEmbedding({
    record: {
      ...embedding,
      indexed_at: "2026-06-18T09:05:00.000Z",
    },
    vector: [0.9, 0.1, 0],
  });

  assert.equal(await repository.countEmbeddings(), 1);

  await repository.markEmbeddingStatus(
    embedding.embedding_id,
    "stale",
    "2026-06-18T09:10:00.000Z"
  );

  const active = await repository.getActiveEmbedding({
    asset_id: embedding.asset_id,
    representation_kind: "image-thumbnail",
    embedding_model: "ViT-B-32",
  });
  const searchHits = await repository.searchByVector({
    vector: [1, 0, 0],
    embedding_model: "ViT-B-32",
    representation_kinds: ["image-thumbnail"],
    limit: 5,
  });

  assert.equal(active.status, "stale");
  assert.equal(searchHits.length, 1);
  assert.equal(searchHits[0].embedding.embedding_id, embedding.embedding_id);
});

test("qdrant vector repository filters active embedding and vector search by model identity", async () => {
  const qdrant = createMockQdrantFetch();
  const repository = createVectorRepository({
    backend: "qdrant",
    serviceUrl: "http://127.0.0.1:6333",
    collectionName: "media-index",
    distance: "cosine",
    fetchFn: qdrant.fetchFn,
  });

  await repository.initialize();

  const baselineEmbedding = buildEmbeddingRecord({
    asset_id: "asset:qdrant-model-identity",
    local_identifier: "QDRANT/MODEL/001",
    representation_kind: "image-thumbnail",
    embedding_provider: "open-clip",
    embedding_model: "ViT-B-32",
    model_identity: "open-clip:ViT-B-32:baseline",
    source_fingerprint: "fp:qdrant-model-identity",
    indexed_at: "2026-06-18T09:00:00.000Z",
  });
  const upgradeEmbedding = buildEmbeddingRecord({
    asset_id: "asset:qdrant-model-identity",
    local_identifier: "QDRANT/MODEL/001",
    representation_kind: "image-thumbnail",
    embedding_provider: "open-clip",
    embedding_model: "ViT-B-32",
    model_identity: "open-clip:ViT-B-32:upgrade",
    source_fingerprint: "fp:qdrant-model-identity",
    indexed_at: "2026-06-18T10:00:00.000Z",
  });

  await repository.upsertEmbedding({
    record: baselineEmbedding,
    vector: [1, 0, 0],
  });
  await repository.upsertEmbedding({
    record: upgradeEmbedding,
    vector: [0, 1, 0],
  });

  const baselineActive = await repository.getActiveEmbedding({
    asset_id: baselineEmbedding.asset_id,
    representation_kind: "image-thumbnail",
    embedding_model: "ViT-B-32",
    model_identity: "open-clip:ViT-B-32:baseline",
  });
  const upgradeActive = await repository.getActiveEmbedding({
    asset_id: baselineEmbedding.asset_id,
    representation_kind: "image-thumbnail",
    embedding_model: "ViT-B-32",
    model_identity: "open-clip:ViT-B-32:upgrade",
  });
  const baselineHits = await repository.searchByVector({
    vector: [1, 0, 0],
    embedding_model: "ViT-B-32",
    model_identity: "open-clip:ViT-B-32:baseline",
    representation_kinds: ["image-thumbnail"],
    limit: 5,
  });
  const upgradeHits = await repository.searchByVector({
    vector: [0, 1, 0],
    embedding_model: "ViT-B-32",
    model_identity: "open-clip:ViT-B-32:upgrade",
    representation_kinds: ["image-thumbnail"],
    limit: 5,
  });

  assert.equal(baselineActive.embedding_id, baselineEmbedding.embedding_id);
  assert.equal(upgradeActive.embedding_id, upgradeEmbedding.embedding_id);
  assert.equal(baselineHits.length, 1);
  assert.equal(upgradeHits.length, 1);
  assert.equal(baselineHits[0].embedding.embedding_id, baselineEmbedding.embedding_id);
  assert.equal(upgradeHits[0].embedding.embedding_id, upgradeEmbedding.embedding_id);
});

test("qdrant vector repository bulk upserts multiple embeddings in one points request", async () => {
  const qdrant = createMockQdrantFetch();
  const repository = createVectorRepository({
    backend: "qdrant",
    serviceUrl: "http://127.0.0.1:6333",
    collectionName: "media-index",
    distance: "cosine",
    fetchFn: qdrant.fetchFn,
  });

  await repository.initialize();

  const firstEmbedding = buildEmbeddingRecord({
    asset_id: "asset:qdrant-bulk-1",
    local_identifier: "QDRANT/BULK/001",
    representation_kind: "image-thumbnail",
    embedding_provider: "open-clip",
    embedding_model: "ViT-B-32",
    model_identity: "open-clip:ViT-B-32:test",
    source_fingerprint: "fp:qdrant-bulk-1",
    indexed_at: "2026-06-18T10:00:00.000Z",
  });
  const secondEmbedding = buildEmbeddingRecord({
    asset_id: "asset:qdrant-bulk-2",
    local_identifier: "QDRANT/BULK/002",
    representation_kind: "video-poster-frame",
    embedding_provider: "open-clip",
    embedding_model: "ViT-B-32",
    model_identity: "open-clip:ViT-B-32:test",
    source_fingerprint: "fp:qdrant-bulk-2",
    indexed_at: "2026-06-18T10:00:01.000Z",
  });

  await repository.upsertEmbeddings([
    {
      record: firstEmbedding,
      vector: [0.1, 0.2, 0.3],
    },
    {
      record: secondEmbedding,
      vector: [0.3, 0.2, 0.1],
    },
  ]);

  const pointsWrites = qdrant.state.calls.filter(
    (call) => call.method === "PUT" && /\/collections\/.+\/points$/.test(call.pathname)
  );

  assert.equal(pointsWrites.length, 1);
  assert.equal(pointsWrites[0].body.points.length, 2);
  assert.match(pointsWrites[0].pathname, /^\/collections\/media-index--.+\/points$/);
  assert.equal(await repository.countEmbeddings(), 2);
});

test("qdrant vector repository stores different model identities in separate collections", async () => {
  const qdrant = createMockQdrantFetch();
  const repository = createVectorRepository({
    backend: "qdrant",
    serviceUrl: "http://127.0.0.1:6333",
    collectionName: "media-index",
    distance: "cosine",
    fetchFn: qdrant.fetchFn,
  });

  await repository.initialize();

  const baselineEmbedding = buildEmbeddingRecord({
    asset_id: "asset:qdrant-split-baseline",
    local_identifier: "QDRANT/SPLIT/BASELINE",
    representation_kind: "image-thumbnail",
    embedding_provider: "open-clip",
    embedding_model: "ViT-B-32",
    model_identity: "open-clip:ViT-B-32:laion2b_s34b_b79k",
    source_fingerprint: "fp:qdrant-split-baseline",
    indexed_at: "2026-06-18T10:00:00.000Z",
  });
  const fallbackEmbedding = buildEmbeddingRecord({
    asset_id: "asset:qdrant-split-fallback",
    local_identifier: "QDRANT/SPLIT/FALLBACK",
    representation_kind: "image-thumbnail",
    embedding_provider: "open-clip",
    embedding_model: "ViT-H-14",
    model_identity: "open-clip:ViT-H-14:laion2b_s32b_b79k",
    source_fingerprint: "fp:qdrant-split-fallback",
    indexed_at: "2026-06-18T10:00:01.000Z",
  });

  await repository.upsertEmbedding({
    record: baselineEmbedding,
    vector: [1, 0, 0],
  });
  await repository.upsertEmbedding({
    record: fallbackEmbedding,
    vector: [1, 0, 0, 0],
  });

  const createdCollectionCalls = qdrant.state.calls.filter(
    (call) => call.method === "PUT" && /^\/collections\/[^/]+$/.test(call.pathname)
  );
  const baselineHits = await repository.searchByVector({
    vector: [1, 0, 0],
    embedding_model: "ViT-B-32",
    model_identity: "open-clip:ViT-B-32:laion2b_s34b_b79k",
    representation_kinds: ["image-thumbnail"],
    limit: 5,
  });
  const fallbackHits = await repository.searchByVector({
    vector: [1, 0, 0, 0],
    embedding_model: "ViT-H-14",
    model_identity: "open-clip:ViT-H-14:laion2b_s32b_b79k",
    representation_kinds: ["image-thumbnail"],
    limit: 5,
  });

  assert.equal(createdCollectionCalls.length, 2);
  assert.equal(qdrant.state.collections.size, 2);
  assert.equal(baselineHits.length, 1);
  assert.equal(fallbackHits.length, 1);
  assert.equal(baselineHits[0].embedding.embedding_id, baselineEmbedding.embedding_id);
  assert.equal(fallbackHits[0].embedding.embedding_id, fallbackEmbedding.embedding_id);
});

test("qdrant vector repository still reads legacy base collection for the requested model identity", async () => {
  const qdrant = createMockQdrantFetch();
  const repository = createVectorRepository({
    backend: "qdrant",
    serviceUrl: "http://127.0.0.1:6333",
    collectionName: "media-index",
    distance: "cosine",
    fetchFn: qdrant.fetchFn,
  });

  const legacyEmbedding = buildEmbeddingRecord({
    asset_id: "asset:qdrant-legacy-baseline",
    local_identifier: "QDRANT/LEGACY/BASELINE",
    representation_kind: "image-thumbnail",
    embedding_provider: "open-clip",
    embedding_model: "ViT-B-32",
    model_identity: "open-clip:ViT-B-32:laion2b_s34b_b79k",
    source_fingerprint: "fp:qdrant-legacy-baseline",
    indexed_at: "2026-06-18T10:00:00.000Z",
  });
  const legacyPointId = legacyEmbedding.embedding_id
    .replace(/^[^:]+:/, "")
    .replace(/[^a-f0-9]/gi, "")
    .slice(0, 32)
    .replace(
      /^(.{8})(.{4})(.{4})(.{4})(.{12}).*$/,
      "$1-$2-$3-$4-$5"
    );

  qdrant.state.collections.set("media-index", {
    name: "media-index",
    size: 3,
    distance: "Cosine",
  });
  qdrant.state.pointsByCollection.set(
    "media-index",
    new Map([
      [
        legacyPointId,
        {
          id: legacyPointId,
          vector: [1, 0, 0],
          payload: structuredClone(legacyEmbedding),
        },
      ],
    ])
  );

  await repository.initialize();

  const hits = await repository.searchByVector({
    vector: [1, 0, 0],
    embedding_model: "ViT-B-32",
    model_identity: "open-clip:ViT-B-32:laion2b_s34b_b79k",
    representation_kinds: ["image-thumbnail"],
    limit: 5,
  });

  assert.equal(hits.length, 1);
  assert.equal(hits[0].embedding.embedding_id, legacyEmbedding.embedding_id);
});

test("qdrant vector repository prefers scoped collection over legacy base collection when both exist", async () => {
  const qdrant = createMockQdrantFetch();
  const repository = createVectorRepository({
    backend: "qdrant",
    serviceUrl: "http://127.0.0.1:6333",
    collectionName: "media-index",
    distance: "cosine",
    fetchFn: qdrant.fetchFn,
  });
  const modelIdentity = "open-clip:ViT-H-14:laion2b_s32b_b79k";
  const scopedCollectionName =
    "media-index--open-clip-vit-h-14-laion2b-s32b-b79k--37b6bacbd661";
  const scopedEmbedding = buildEmbeddingRecord({
    asset_id: "asset:qdrant-scoped-preferred",
    local_identifier: "QDRANT/SCOPED/PREFERRED",
    representation_kind: "image-thumbnail",
    embedding_provider: "open-clip",
    embedding_model: "ViT-H-14",
    model_identity: modelIdentity,
    source_fingerprint: "fp:qdrant-scoped-preferred",
    indexed_at: "2026-06-18T10:00:00.000Z",
  });
  const legacyEmbedding = buildEmbeddingRecord({
    asset_id: "asset:qdrant-legacy-ignored",
    local_identifier: "QDRANT/LEGACY/IGNORED",
    representation_kind: "image-thumbnail",
    embedding_provider: "open-clip",
    embedding_model: "ViT-H-14",
    model_identity: modelIdentity,
    source_fingerprint: "fp:qdrant-legacy-ignored",
    indexed_at: "2026-06-18T09:59:00.000Z",
  });
  const scopedPointId = scopedEmbedding.embedding_id
    .replace(/^[^:]+:/, "")
    .replace(/[^a-f0-9]/gi, "")
    .slice(0, 32)
    .replace(/^(.{8})(.{4})(.{4})(.{4})(.{12}).*$/, "$1-$2-$3-$4-$5");
  const legacyPointId = legacyEmbedding.embedding_id
    .replace(/^[^:]+:/, "")
    .replace(/[^a-f0-9]/gi, "")
    .slice(0, 32)
    .replace(/^(.{8})(.{4})(.{4})(.{4})(.{12}).*$/, "$1-$2-$3-$4-$5");

  qdrant.state.collections.set("media-index", {
    name: "media-index",
    size: 3,
    distance: "Cosine",
  });
  qdrant.state.collections.set(scopedCollectionName, {
    name: scopedCollectionName,
    size: 3,
    distance: "Cosine",
  });
  qdrant.state.pointsByCollection.set(
    "media-index",
    new Map([
      [
        legacyPointId,
        {
          id: legacyPointId,
          vector: [0, 1, 0, 0],
          payload: structuredClone(legacyEmbedding),
        },
      ],
    ])
  );
  qdrant.state.pointsByCollection.set(
    scopedCollectionName,
    new Map([
      [
        scopedPointId,
        {
          id: scopedPointId,
          vector: [0, 1, 0, 0],
          payload: structuredClone(scopedEmbedding),
        },
      ],
    ])
  );

  await repository.initialize();

  const hits = await repository.searchByVector({
    vector: [0, 1, 0, 0],
    embedding_model: "ViT-H-14",
    model_identity: modelIdentity,
    representation_kinds: ["image-thumbnail"],
    limit: 5,
  });
  const legacyScrollCalls = qdrant.state.calls.filter(
    (call) =>
      call.method === "POST" &&
      call.pathname === "/collections/media-index/points/scroll"
  );
  const scopedQueryCalls = qdrant.state.calls.filter(
    (call) =>
      call.method === "POST" &&
      call.pathname ===
        `/collections/${scopedCollectionName}/points/query`
  );

  assert.equal(hits.length, 1);
  assert.equal(hits[0].embedding.embedding_id, scopedEmbedding.embedding_id);
  assert.equal(legacyScrollCalls.length, 0);
  assert.equal(scopedQueryCalls.length, 1);
});

test("qdrant vector repository prefers the richer legacy base collection when it has more matching embeddings", async () => {
  const qdrant = createMockQdrantFetch();
  const repository = createVectorRepository({
    backend: "qdrant",
    serviceUrl: "http://127.0.0.1:6333",
    collectionName: "media-index",
    distance: "cosine",
    fetchFn: qdrant.fetchFn,
  });
  const modelIdentity = "open-clip:ViT-B-32:laion2b_s34b_b79k";
  const scopedCollectionName =
    "media-index--open-clip-vit-b-32-laion2b-s34b-b79k--12da2b6ea473";
  const baseEmbeddingA = buildEmbeddingRecord({
    asset_id: "asset:qdrant-base-richer-a",
    local_identifier: "QDRANT/BASE/RICHER/A",
    representation_kind: "image-thumbnail",
    embedding_provider: "open-clip",
    embedding_model: "ViT-B-32",
    model_identity: modelIdentity,
    source_fingerprint: "fp:qdrant-base-richer-a",
    indexed_at: "2026-06-18T10:00:00.000Z",
  });
  const baseEmbeddingB = buildEmbeddingRecord({
    asset_id: "asset:qdrant-base-richer-b",
    local_identifier: "QDRANT/BASE/RICHER/B",
    representation_kind: "image-thumbnail",
    embedding_provider: "open-clip",
    embedding_model: "ViT-B-32",
    model_identity: modelIdentity,
    source_fingerprint: "fp:qdrant-base-richer-b",
    indexed_at: "2026-06-18T10:00:01.000Z",
  });
  const scopedEmbedding = buildEmbeddingRecord({
    asset_id: "asset:qdrant-scoped-thinner",
    local_identifier: "QDRANT/SCOPED/THINNER",
    representation_kind: "image-thumbnail",
    embedding_provider: "open-clip",
    embedding_model: "ViT-B-32",
    model_identity: modelIdentity,
    source_fingerprint: "fp:qdrant-scoped-thinner",
    indexed_at: "2026-06-18T10:00:02.000Z",
  });
  const basePointIdA = baseEmbeddingA.embedding_id
    .replace(/^[^:]+:/, "")
    .replace(/[^a-f0-9]/gi, "")
    .slice(0, 32)
    .replace(/^(.{8})(.{4})(.{4})(.{4})(.{12}).*$/, "$1-$2-$3-$4-$5");
  const basePointIdB = baseEmbeddingB.embedding_id
    .replace(/^[^:]+:/, "")
    .replace(/[^a-f0-9]/gi, "")
    .slice(0, 32)
    .replace(/^(.{8})(.{4})(.{4})(.{4})(.{12}).*$/, "$1-$2-$3-$4-$5");
  const scopedPointId = scopedEmbedding.embedding_id
    .replace(/^[^:]+:/, "")
    .replace(/[^a-f0-9]/gi, "")
    .slice(0, 32)
    .replace(/^(.{8})(.{4})(.{4})(.{4})(.{12}).*$/, "$1-$2-$3-$4-$5");

  qdrant.state.collections.set("media-index", {
    name: "media-index",
    size: 4,
    distance: "Cosine",
  });
  qdrant.state.collections.set(scopedCollectionName, {
    name: scopedCollectionName,
    size: 4,
    distance: "Cosine",
  });
  qdrant.state.pointsByCollection.set(
    "media-index",
    new Map([
      [
        basePointIdA,
        {
          id: basePointIdA,
          vector: [1, 0, 0],
          payload: structuredClone(baseEmbeddingA),
        },
      ],
      [
        basePointIdB,
        {
          id: basePointIdB,
          vector: [0.95, 0, 0],
          payload: structuredClone(baseEmbeddingB),
        },
      ],
    ])
  );
  qdrant.state.pointsByCollection.set(
    scopedCollectionName,
    new Map([
      [
        scopedPointId,
        {
          id: scopedPointId,
          vector: [1, 0, 0],
          payload: structuredClone(scopedEmbedding),
        },
      ],
    ])
  );

  await repository.initialize();

  const hits = await repository.searchByVector({
    vector: [1, 0, 0],
    embedding_model: "ViT-B-32",
    model_identity: modelIdentity,
    representation_kinds: ["image-thumbnail"],
    limit: 5,
  });
  const baseQueryCalls = qdrant.state.calls.filter(
    (call) =>
      call.method === "POST" &&
      call.pathname === "/collections/media-index/points/query"
  );
  const scopedQueryCalls = qdrant.state.calls.filter(
    (call) =>
      call.method === "POST" &&
      call.pathname === `/collections/${scopedCollectionName}/points/query`
  );

  assert.equal(hits.length, 2);
  assert.equal(hits[0].embedding.embedding_id, baseEmbeddingA.embedding_id);
  assert.equal(hits[1].embedding.embedding_id, baseEmbeddingB.embedding_id);
  assert.equal(baseQueryCalls.length, 1);
  assert.equal(scopedQueryCalls.length, 0);
});

test("qdrant vector repository pushes search filters down to scoped query payload", async () => {
  const qdrant = createMockQdrantFetch();
  const repository = createVectorRepository({
    backend: "qdrant",
    serviceUrl: "http://127.0.0.1:6333",
    collectionName: "media-index",
    distance: "cosine",
    fetchFn: qdrant.fetchFn,
  });
  const modelIdentity = "open-clip:ViT-H-14:laion2b_s32b_b79k";
  const scopedCollectionName =
    "media-index--open-clip-vit-h-14-laion2b-s32b-b79k--37b6bacbd661";
  const embedding = buildEmbeddingRecord({
    asset_id: "asset:qdrant-scoped-filters",
    local_identifier: "QDRANT/SCOPED/FILTERS",
    representation_kind: "image-thumbnail",
    embedding_provider: "open-clip",
    embedding_model: "ViT-H-14",
    model_identity: modelIdentity,
    source_fingerprint: "fp:qdrant-scoped-filters",
    indexed_at: "2026-06-18T10:00:00.000Z",
    status: "ready",
  });
  const pointId = embedding.embedding_id
    .replace(/^[^:]+:/, "")
    .replace(/[^a-f0-9]/gi, "")
    .slice(0, 32)
    .replace(/^(.{8})(.{4})(.{4})(.{4})(.{12}).*$/, "$1-$2-$3-$4-$5");

  qdrant.state.collections.set(scopedCollectionName, {
    name: scopedCollectionName,
    size: 4,
    distance: "Cosine",
  });
  qdrant.state.pointsByCollection.set(
    scopedCollectionName,
    new Map([
      [
        pointId,
        {
          id: pointId,
          vector: [0, 1, 0, 0],
          payload: structuredClone(embedding),
        },
      ],
    ])
  );

  await repository.initialize();

  const hits = await repository.searchByVector({
    vector: [0, 1, 0, 0],
    embedding_model: "ViT-H-14",
    model_identity: modelIdentity,
    representation_kinds: ["image-thumbnail", "video-storyboard"],
    limit: 5,
  });
  const queryCall = qdrant.state.calls.find(
    (call) =>
      call.method === "POST" &&
      call.pathname === `/collections/${scopedCollectionName}/points/query`
  );

  assert.equal(hits.length, 1);
  assert.deepEqual(queryCall.body.filter, {
    must: [
      {
        key: "embedding_model",
        match: {
          value: "ViT-H-14",
        },
      },
      {
        key: "representation_kind",
        match: {
          any: ["image-thumbnail", "video-storyboard"],
        },
      },
      {
        key: "status",
        match: {
          any: ["ready", "stale"],
        },
      },
    ],
  });
});

test("qdrant vector repository retries transient query transport failures", async () => {
  const qdrant = createMockQdrantFetch();
  const failingFetchFn = async (url, options = {}) => {
    const parsedUrl = new URL(url);

    if (
      options.method === "POST" &&
      /\/collections\/.+\/points\/query$/.test(parsedUrl.pathname) &&
      !failingFetchFn.hasFailed
    ) {
      failingFetchFn.hasFailed = true;
      throw new AppError("Failed to reach Qdrant at http://127.0.0.1:6333.", {
        code: "VECTOR_BACKEND_UNREACHABLE",
      });
    }

    return qdrant.fetchFn(url, options);
  };
  failingFetchFn.hasFailed = false;

  const repository = createVectorRepository({
    backend: "qdrant",
    serviceUrl: "http://127.0.0.1:6333",
    collectionName: "media-index",
    distance: "cosine",
    fetchFn: failingFetchFn,
  });
  const modelIdentity = "open-clip:ViT-H-14:laion2b_s32b_b79k";
  const scopedCollectionName =
    "media-index--open-clip-vit-h-14-laion2b-s32b-b79k--37b6bacbd661";
  const embedding = buildEmbeddingRecord({
    asset_id: "asset:qdrant-query-retry",
    local_identifier: "QDRANT/QUERY/RETRY",
    representation_kind: "image-thumbnail",
    embedding_provider: "open-clip",
    embedding_model: "ViT-H-14",
    model_identity: modelIdentity,
    source_fingerprint: "fp:qdrant-query-retry",
    indexed_at: "2026-06-18T10:00:00.000Z",
    status: "ready",
  });
  const pointId = embedding.embedding_id
    .replace(/^[^:]+:/, "")
    .replace(/[^a-f0-9]/gi, "")
    .slice(0, 32)
    .replace(/^(.{8})(.{4})(.{4})(.{4})(.{12}).*$/, "$1-$2-$3-$4-$5");

  qdrant.state.collections.set(scopedCollectionName, {
    name: scopedCollectionName,
    size: 4,
    distance: "Cosine",
  });
  qdrant.state.pointsByCollection.set(
    scopedCollectionName,
    new Map([
      [
        pointId,
        {
          id: pointId,
          vector: [1, 0, 0, 0],
          payload: structuredClone(embedding),
        },
      ],
    ])
  );

  await repository.initialize();

  const hits = await repository.searchByVector({
    vector: [1, 0, 0, 0],
    embedding_model: "ViT-H-14",
    model_identity: modelIdentity,
    representation_kinds: ["image-thumbnail"],
    limit: 5,
  });
  const queryCalls = qdrant.state.calls.filter(
    (call) =>
      call.method === "POST" &&
      call.pathname === `/collections/${scopedCollectionName}/points/query`
  );

  assert.equal(hits.length, 1);
  assert.equal(failingFetchFn.hasFailed, true);
  assert.equal(queryCalls.length, 1);
});

test("qdrant vector repository retries transient collection metadata read failures", async () => {
  const qdrant = createMockQdrantFetch();
  const scopedCollectionName =
    "media-index--open-clip-vit-h-14-laion2b-s32b-b79k--37b6bacbd661";
  const failingFetchFn = async (url, options = {}) => {
    const parsedUrl = new URL(url);

    if (
      options.method === "GET" &&
      parsedUrl.pathname === `/collections/${scopedCollectionName}` &&
      !failingFetchFn.hasFailed
    ) {
      failingFetchFn.hasFailed = true;
      throw new AppError("Failed to reach Qdrant at http://127.0.0.1:6333.", {
        code: "VECTOR_BACKEND_UNREACHABLE",
      });
    }

    return qdrant.fetchFn(url, options);
  };
  failingFetchFn.hasFailed = false;

  const repository = createVectorRepository({
    backend: "qdrant",
    serviceUrl: "http://127.0.0.1:6333",
    collectionName: "media-index",
    distance: "cosine",
    fetchFn: failingFetchFn,
  });
  const modelIdentity = "open-clip:ViT-H-14:laion2b_s32b_b79k";
  const embedding = buildEmbeddingRecord({
    asset_id: "asset:qdrant-metadata-retry",
    local_identifier: "QDRANT/METADATA/RETRY",
    representation_kind: "image-thumbnail",
    embedding_provider: "open-clip",
    embedding_model: "ViT-H-14",
    model_identity: modelIdentity,
    source_fingerprint: "fp:qdrant-metadata-retry",
    indexed_at: "2026-06-18T10:00:00.000Z",
    status: "ready",
  });
  const pointId = embedding.embedding_id
    .replace(/^[^:]+:/, "")
    .replace(/[^a-f0-9]/gi, "")
    .slice(0, 32)
    .replace(/^(.{8})(.{4})(.{4})(.{4})(.{12}).*$/, "$1-$2-$3-$4-$5");

  qdrant.state.collections.set(scopedCollectionName, {
    name: scopedCollectionName,
    size: 4,
    distance: "Cosine",
  });
  qdrant.state.pointsByCollection.set(
    scopedCollectionName,
    new Map([
      [
        pointId,
        {
          id: pointId,
          vector: [1, 0, 0, 0],
          payload: structuredClone(embedding),
        },
      ],
    ])
  );

  await repository.initialize();

  const hits = await repository.searchByVector({
    vector: [1, 0, 0, 0],
    embedding_model: "ViT-H-14",
    model_identity: modelIdentity,
    representation_kinds: ["image-thumbnail"],
    limit: 5,
  });

  assert.equal(hits.length, 1);
  assert.equal(failingFetchFn.hasFailed, true);
});

test("qdrant vector repository counts filtered scoped embeddings without scroll fallback", async () => {
  const qdrant = createMockQdrantFetch();
  const repository = createVectorRepository({
    backend: "qdrant",
    serviceUrl: "http://127.0.0.1:6333",
    collectionName: "media-index",
    distance: "cosine",
    fetchFn: qdrant.fetchFn,
  });
  const modelIdentity = "open-clip:ViT-H-14:laion2b_s32b_b79k";
  const firstEmbedding = buildEmbeddingRecord({
    asset_id: "asset:qdrant-count-1",
    local_identifier: "QDRANT/COUNT/1",
    representation_kind: "image-thumbnail",
    embedding_provider: "open-clip",
    embedding_model: "ViT-H-14",
    model_identity: modelIdentity,
    source_fingerprint: "fp:qdrant-count-1",
    indexed_at: "2026-06-18T10:00:00.000Z",
    status: "ready",
  });
  const secondEmbedding = buildEmbeddingRecord({
    asset_id: "asset:qdrant-count-2",
    local_identifier: "QDRANT/COUNT/2",
    representation_kind: "video-storyboard",
    embedding_provider: "open-clip",
    embedding_model: "ViT-H-14",
    model_identity: modelIdentity,
    source_fingerprint: "fp:qdrant-count-2",
    indexed_at: "2026-06-18T10:00:01.000Z",
    status: "stale",
  });

  await repository.initialize();
  await repository.upsertEmbeddings([
    {
      record: firstEmbedding,
      vector: [1, 0, 0, 0],
    },
    {
      record: secondEmbedding,
      vector: [0, 1, 0, 0],
    },
  ]);

  const count = await repository.countEmbeddings({
    embedding_model: "ViT-H-14",
    model_identity: modelIdentity,
    representation_kinds: ["image-thumbnail", "video-storyboard"],
    statuses: ["ready", "stale"],
  });
  const scrollCalls = qdrant.state.calls.filter(
    (call) =>
      call.method === "POST" &&
      /\/collections\/.+\/points\/scroll$/.test(call.pathname)
  );
  const countCalls = qdrant.state.calls.filter(
    (call) =>
      call.method === "POST" &&
      /\/collections\/.+\/points\/count$/.test(call.pathname)
  );

  assert.equal(count, 2);
  assert.equal(scrollCalls.length, 0);
  assert.equal(countCalls.length, 1);
});

test("index file command stores one local image with deterministic synthetic local identifier", async () => {
  await withTempDir(async (tempDir) => {
    const imagePath = await writeTinyPng(tempDir);
    const output = await runIndexFileCommand({
      cwd: tempDir,
      args: [imagePath],
      loadConfigFn: async () => ({
        config: structuredClone(DEFAULT_CONFIG),
        configPath: path.join(tempDir, "media-vector-index.config.json"),
        exists: true,
      }),
      createStorageRepositoriesFn: () => {
        const catalogRepository = createCatalogRepository({
          filePath: path.join(tempDir, "catalog-store.json"),
        });
        const vectorRepository = createVectorRepository({
          filePath: path.join(tempDir, "vector-store.json"),
        });

        return {
          storageRoot: tempDir,
          catalogDbPath: path.join(tempDir, "catalog-store.json"),
          vectorBackend: "json-file",
          vectorServiceUrl: null,
          vectorCollectionName: null,
          catalogRepository,
          vectorRepository,
        };
      },
      indexLocalImageFileFn: (options) =>
        indexLocalImageFile({
          ...options,
          createEmbeddingProviderFn: () => ({
            async embedRepresentations() {
              return [
                {
                  status: "ready",
                  vector: [1, 0, 0],
                  embedding_provider: "open-clip",
                  embedding_model: "ViT-B-32",
                  model_identity: "open-clip:ViT-B-32:test",
                },
              ];
            },
          }),
          now: () => "2026-06-18T12:00:00.000Z",
        }),
    });

    assert.match(output.local_identifier, /^external-image:[a-f0-9]{64}$/);
    assert.equal(output.vector_dimensions, 3);
    assert.equal(output.lines[0], "Command: index file");
  });
});

test("search service can retrieve the exact same local image file via image-query adapter", async () => {
  await withTempDir(async (tempDir) => {
    const imagePath = await writeTinyPng(tempDir);
    const catalogRepository = createCatalogRepository({
      filePath: path.join(tempDir, "catalog-store.json"),
    });
    const vectorRepository = createVectorRepository({
      filePath: path.join(tempDir, "vector-store.json"),
    });

    await Promise.all([
      catalogRepository.initialize(),
      vectorRepository.initialize(),
    ]);

    const indexed = await indexLocalImageFile({
      imagePath,
      config: structuredClone(DEFAULT_CONFIG),
      catalogRepository,
      vectorRepository,
      createEmbeddingProviderFn: () => ({
        async embedRepresentations() {
          return [
            {
              status: "ready",
              vector: [1, 0, 0],
              embedding_provider: "open-clip",
              embedding_model: "ViT-B-32",
              model_identity: "open-clip:ViT-B-32:test",
            },
          ];
        },
      }),
      now: () => "2026-06-18T12:00:00.000Z",
    });

    const searchService = createSearchService({
      catalogRepository,
      vectorRepository,
      createEmbeddingProviderFn: () => ({
        async embedImageQuery() {
          return {
            vector: [1, 0, 0],
            embedding_provider: "open-clip",
            embedding_model: "ViT-B-32",
            model_identity: "open-clip:ViT-B-32:test",
          };
        },
      }),
    });
    const result = await searchService.searchByImage({
      imagePath,
      config: structuredClone(DEFAULT_CONFIG),
      limit: 5,
    });

    assert.equal(result.result_count, 1);
    assert.equal(result.results[0].local_identifier, indexed.local_identifier);
    assert.equal(result.results[0].score, 1);
    assert.equal(
      result.results[0].match_evidence.strategy,
      "semantic-vector-image-query"
    );
  });
});

test("init scaffold writes config and catalog storage while reporting qdrant backend info", async () => {
  await withTempDir(async (tempDir) => {
    const result = await initializeProjectScaffold(tempDir, { force: true });

    assert.equal(result.created, true);
    assert.match(result.catalogDbPath, /catalog-store\.json$/);
    assert.equal(result.vectorBackend, "qdrant");
    assert.equal(result.vectorServiceUrl, "http://127.0.0.1:6333");
  });
});

test("storage layout stays in sync across default config, sample config, and init output", async () => {
  const sampleConfigPath = path.resolve(
    process.cwd(),
    "media-vector-index.config.json"
  );
  const sampleConfig = JSON.parse(await readFile(sampleConfigPath, "utf8"));

  assert.deepEqual(DEFAULT_CONFIG.storage, STORAGE_LAYOUT);
  assert.deepEqual(sampleConfig.storage, STORAGE_LAYOUT);

  await withTempDir(async (tempDir) => {
    const output = await runInitCommand({ cwd: tempDir, args: ["--force"] });
    const expectedLines = formatStorageSummaryLines({
      storageRoot: path.resolve(tempDir, STORAGE_LAYOUT.root_dir),
      catalogDbPath: path.resolve(tempDir, STORAGE_LAYOUT.catalog_db_path),
      vectorBackend: STORAGE_LAYOUT.vector_backend,
      vectorServiceUrl: STORAGE_LAYOUT.vector_service_url,
      vectorCollectionName: STORAGE_LAYOUT.vector_collection_name,
    });

    for (const line of expectedLines) {
      assert.ok(output.lines.includes(line));
    }
  });
});

test("forced refresh reruns do not create duplicate assets or embeddings", async () => {
  await withTempDir(async (tempDir) => {
    const catalogRepository = createCatalogRepository({
      filePath: path.join(tempDir, "catalog-store.json"),
    });
    const vectorRepository = createVectorRepository({
      filePath: path.join(tempDir, "vector-store.json"),
    });

    await Promise.all([
      catalogRepository.initialize(),
      vectorRepository.initialize(),
    ]);

    const pipeline = createIndexPipeline({
      scanLibraryFn: () => ({
        framework_connection: "connected",
        permission_status: "authorized",
        library_access: "connected",
        valid_asset_count: 2,
        assets: [
          {
            local_identifier: "A1B2C3/L0/001",
            asset_type: "image",
            pixel_width: 4032,
            pixel_height: 3024,
            modification_date: "2026-06-10T08:00:00.000Z",
            is_in_icloud: false,
          },
          {
            local_identifier: "D4E5F6/L0/002",
            asset_type: "video",
            pixel_width: 1920,
            pixel_height: 1080,
            duration_seconds: 12.4,
            modification_date: "2026-06-11T08:00:00.000Z",
            is_in_icloud: true,
          },
        ],
      }),
      extractRepresentationsFn: () => ({
        representation_count: 2,
        image_representation_count: 1,
        video_representation_count: 1,
        representations: [
          {
            local_identifier: "A1B2C3/L0/001",
            asset_type: "image",
            representation_kind: "image-thumbnail",
            byte_length: 12,
            bytes_base64: Buffer.from("image-bytes").toString("base64"),
            metadata: {
              status: "ok",
              is_in_icloud: false,
            },
          },
          {
            local_identifier: "D4E5F6/L0/002",
            asset_type: "video",
            representation_kind: "video-poster-frame",
            byte_length: 12,
            bytes_base64: Buffer.from("video-bytes").toString("base64"),
            metadata: {
              status: "ok",
              is_in_icloud: true,
            },
          },
        ],
      }),
      catalogRepository,
      vectorRepository,
      createEmbeddingProviderFn: () => ({
        modelIdentity: "open-clip:ViT-B-32:laion2b_s34b_b79k",
        async embedRepresentations({ representations }) {
          return representations.map((representation, index) => ({
            local_identifier: representation.local_identifier,
            representation_kind: representation.representation_kind,
            status: "ready",
            vector: Array.from({ length: 8 }, (_, vectorIndex) =>
              Number((index + vectorIndex / 10).toFixed(2))
            ),
            embedding_provider: "open-clip",
            embedding_model: "ViT-B-32",
            model_identity: "open-clip:ViT-B-32:laion2b_s34b_b79k",
          }));
        },
      }),
      now: () => "2026-06-17T12:00:00.000Z",
      clock: (() => {
        const values = [0, 0, 10, 10, 30, 30, 40, 40, 80, 80, 95];
        let index = 0;
        return () => values[index++] ?? values[values.length - 1];
      })(),
    });

    const firstRun = await pipeline.run({
      config: structuredClone(DEFAULT_CONFIG),
      limit: 2,
      timeoutSeconds: 30,
      useCache: false,
    });
    const secondRun = await pipeline.run({
      config: structuredClone(DEFAULT_CONFIG),
      limit: 2,
      timeoutSeconds: 30,
      useCache: false,
    });

    const assets = await catalogRepository.listAssets();
    const firstAssetEmbeddings = await vectorRepository.listEmbeddingsForAsset(
      assets[0].asset_id
    );
    const secondAssetEmbeddings = await vectorRepository.listEmbeddingsForAsset(
      assets[1].asset_id
    );

    assert.equal(firstRun.persisted_asset_count, 2);
    assert.equal(firstRun.persisted_embedding_count, 2);
    assert.equal(firstRun.cache_mode, "refresh");
    assert.deepEqual(firstRun.stages, ["scan", "extract", "normalize", "persist"]);
    assert.equal(firstRun.vector_index_state.temp_file_usage, false);
    assert.equal(firstRun.vector_index_state.indexed_images, 1);
    assert.equal(firstRun.vector_index_state.indexed_videos, 1);
    assert.equal(firstRun.vector_index_state.ready_embeddings, 2);
    assert.equal(firstRun.timings.total_ms, 95);
    assert.equal(firstRun.timings.scan_ms, 10);
    assert.equal(firstRun.timings.extract_ms, 20);
    assert.equal(firstRun.timings.prepare_ms, 10);
    assert.equal(firstRun.timings.embed_ms, 40);
    assert.equal(firstRun.timings.persist_ms, 15);
    assert.equal(firstRun.slowest_stage.stage, "embed");
    assert.equal(firstRun.slowest_stage.duration_ms, 40);
    assert.equal(firstRun.breakdown.image_representation_count, 1);
    assert.equal(firstRun.breakdown.video_representation_count, 1);
    assert.equal(firstRun.breakdown.prepared_image_count, 1);
    assert.equal(firstRun.breakdown.prepared_video_count, 1);
    assert.equal(firstRun.breakdown.skipped_image_count, 0);
    assert.equal(firstRun.breakdown.skipped_video_count, 0);
    assert.equal(firstRun.throughput.scan_candidates_per_sec, 200);
    assert.equal(firstRun.throughput.representations_extracted_per_sec, 100);
    assert.equal(firstRun.throughput.embeddings_persisted_per_sec, 133.333);
    assert.equal(secondRun.persisted_asset_count, 2);
    assert.equal(secondRun.persisted_embedding_count, 2);
    assert.equal(secondRun.cache_mode, "refresh");
    assert.equal(await catalogRepository.countAssets(), 2);
    assert.equal(await vectorRepository.countEmbeddings(), 2);
    assert.equal(firstAssetEmbeddings.length, 1);
    assert.equal(secondAssetEmbeddings.length, 1);
    assert.equal(firstAssetEmbeddings[0].embedding_provider, "open-clip");
    assert.equal(firstAssetEmbeddings[0].embedding_model, "ViT-B-32");
    assert.equal(firstAssetEmbeddings[0].embedding_dimensions, 8);
    assert.equal(secondAssetEmbeddings[0].embedding_dimensions, 8);
  });
});

test("index pipeline uses cached catalog and vectors by default when cache exists", async () => {
  await withTempDir(async (tempDir) => {
    const catalogRepository = createCatalogRepository({
      filePath: path.join(tempDir, "catalog-store.json"),
    });
    const vectorRepository = createVectorRepository({
      filePath: path.join(tempDir, "vector-store.json"),
    });

    await Promise.all([
      catalogRepository.initialize(),
      vectorRepository.initialize(),
    ]);

    const cachedAsset = await catalogRepository.upsertAsset({
      local_identifier: "A1B2C3/L0/001",
      asset_type: "image",
      pixel_width: 4032,
      pixel_height: 3024,
      modification_date: "2026-06-10T08:00:00.000Z",
      indexed_at: "2026-06-17T12:00:00.000Z",
      last_seen_at: "2026-06-17T12:00:00.000Z",
    });

    const cachedEmbedding = buildEmbeddingRecord({
      asset_id: cachedAsset.asset_id,
      local_identifier: cachedAsset.local_identifier,
      representation_kind: "image-thumbnail",
      embedding_provider: "open-clip",
      embedding_model: DEFAULT_CONFIG.embedding.model,
      model_identity: "open-clip:ViT-B-32:laion2b_s34b_b79k",
      source_fingerprint: cachedAsset.source_fingerprint,
      indexed_at: "2026-06-17T12:00:00.000Z",
      extraction_signature: "image-thumbnail:224",
    });

    await vectorRepository.saveEmbedding({
      record: cachedEmbedding,
      vector: Array.from({ length: 16 }, (_, index) => index / 10),
    });

    const pipeline = createIndexPipeline({
      scanLibraryFn: () => {
        throw new Error("scan should not run on cache hit");
      },
      extractRepresentationsFn: () => {
        throw new Error("extract should not run on cache hit");
      },
      catalogRepository,
      vectorRepository,
      clock: (() => {
        const values = [0, 0, 5];
        let index = 0;
        return () => values[index++] ?? values[values.length - 1];
      })(),
    });

    const result = await pipeline.run({
      config: structuredClone(DEFAULT_CONFIG),
      limit: 1,
      timeoutSeconds: 30,
      useCache: true,
    });

    assert.equal(result.cache_mode, "hit");
    assert.deepEqual(result.stages, ["cache-read"]);
    assert.equal(result.scanned_asset_count, 1);
    assert.equal(result.extracted_representation_count, 0);
    assert.equal(result.persisted_asset_count, 1);
    assert.equal(result.persisted_embedding_count, 1);
    assert.equal(result.persisted_assets[0], "A1B2C3/L0/001");
    assert.equal(result.vector_index_state.temp_file_usage, false);
    assert.equal(result.vector_index_state.ready_embeddings, 1);
    assert.equal(result.timings.cache_read_ms, 5);
    assert.equal(result.timings.total_ms, 5);
    assert.equal(result.slowest_stage.stage, "cache-read");
  });
});

test("index pipeline cache hit still reuses legacy video poster frame embeddings under storyboard config", async () => {
  await withTempDir(async (tempDir) => {
    const catalogRepository = createCatalogRepository({
      filePath: path.join(tempDir, "catalog-store.json"),
    });
    const vectorRepository = createVectorRepository({
      filePath: path.join(tempDir, "vector-store.json"),
    });

    await Promise.all([
      catalogRepository.initialize(),
      vectorRepository.initialize(),
    ]);

    const cachedAsset = await catalogRepository.upsertAsset({
      local_identifier: "VID/L0/001",
      asset_type: "video",
      pixel_width: 1920,
      pixel_height: 1080,
      duration_seconds: 12.4,
      modification_date: "2026-06-18T08:00:00.000Z",
      indexed_at: "2026-06-18T08:00:00.000Z",
      last_seen_at: "2026-06-18T08:00:00.000Z",
    });

    const cachedEmbedding = buildEmbeddingRecord({
      asset_id: cachedAsset.asset_id,
      local_identifier: cachedAsset.local_identifier,
      representation_kind: "video-poster-frame",
      embedding_provider: "open-clip",
      embedding_model: DEFAULT_CONFIG.embedding.model,
      model_identity: "open-clip:ViT-B-32:laion2b_s34b_b79k",
      source_fingerprint: cachedAsset.source_fingerprint,
      indexed_at: "2026-06-18T08:00:00.000Z",
      extraction_signature: "video-poster-frame:224",
    });

    await vectorRepository.saveEmbedding({
      record: cachedEmbedding,
      vector: Array.from({ length: 8 }, (_, index) => index / 10),
    });

    const pipeline = createIndexPipeline({
      scanLibraryFn: () => {
        throw new Error("scan should not run on cache hit");
      },
      extractRepresentationsFn: () => {
        throw new Error("extract should not run on cache hit");
      },
      catalogRepository,
      vectorRepository,
    });

    const config = structuredClone(DEFAULT_CONFIG);
    config.extractor.video_strategy = "storyboard";

    const result = await pipeline.run({
      config,
      limit: 1,
      timeoutSeconds: 30,
      useCache: true,
    });

    assert.equal(result.cache_mode, "hit");
    assert.equal(result.persisted_embedding_count, 1);
    assert.equal(result.persisted_embeddings[0].representation_kind, "video-poster-frame");
  });
});

test("index pipeline cache hit does not reuse embeddings from a different model identity", async () => {
  await withTempDir(async (tempDir) => {
    const catalogRepository = createCatalogRepository({
      filePath: path.join(tempDir, "catalog-store.json"),
    });
    const vectorRepository = createVectorRepository({
      filePath: path.join(tempDir, "vector-store.json"),
    });

    await Promise.all([
      catalogRepository.initialize(),
      vectorRepository.initialize(),
    ]);

    const cachedAsset = await catalogRepository.upsertAsset({
      local_identifier: "IMG/L0/DIFFMODEL",
      asset_type: "image",
      pixel_width: 4032,
      pixel_height: 3024,
      modification_date: "2026-06-18T08:00:00.000Z",
      indexed_at: "2026-06-18T08:00:00.000Z",
      last_seen_at: "2026-06-18T08:00:00.000Z",
    });

    await vectorRepository.saveEmbedding({
      record: buildEmbeddingRecord({
        asset_id: cachedAsset.asset_id,
        local_identifier: cachedAsset.local_identifier,
        representation_kind: "image-thumbnail",
        embedding_provider: "open-clip",
        embedding_model: DEFAULT_CONFIG.embedding.model,
        model_identity: "open-clip:ViT-B-32:older-pretrained",
        source_fingerprint: cachedAsset.source_fingerprint,
        indexed_at: "2026-06-18T08:00:00.000Z",
        extraction_signature: "image-thumbnail:224",
      }),
      vector: Array.from({ length: 8 }, (_, index) => index / 10),
    });

    const pipeline = createIndexPipeline({
      scanLibraryFn: () => {
        throw new Error("scan should not run on cache hit");
      },
      extractRepresentationsFn: () => {
        throw new Error("extract should not run on cache hit");
      },
      catalogRepository,
      vectorRepository,
      clock: (() => {
        const values = [0, 0, 5];
        let index = 0;
        return () => values[index++] ?? values[values.length - 1];
      })(),
    });

    const result = await pipeline.run({
      config: structuredClone(DEFAULT_CONFIG),
      limit: 1,
      timeoutSeconds: 30,
      useCache: true,
    });

    assert.equal(result.cache_mode, "hit");
    assert.equal(result.persisted_asset_count, 0);
    assert.equal(result.persisted_embedding_count, 0);
    assert.equal(result.skipped_representation_count, 1);
    assert.deepEqual(result.breakdown.skip_reasons, [
      { name: "missing-active-embedding", count: 1 },
    ]);
  });
});

test("index command profile output includes timings, throughput, and breakdown", async () => {
  const config = structuredClone(DEFAULT_CONFIG);
  config.embedding = {
    ...(config.embedding ?? {}),
    candidate_preset: "fallback-safe",
    model: "ViT-H-14",
    pretrained: "laion2b_s32b_b79k",
    target_resolution: 378,
  };
  const result = await runIndexLikeCommand({
    cwd: "/tmp/mvi",
    args: ["--limit", "100", "--no-cache", "--profile"],
    defaultUseCache: true,
    summary: "Index completed.",
    commandLabel: "index",
    loadConfigFn: async () => ({
      config,
      configPath: "/tmp/mvi/media-vector-index.config.json",
      exists: true,
    }),
    createStorageRepositoriesFn: () => ({
      storageRoot: "/tmp/mvi/.data",
      catalogDbPath: "/tmp/mvi/.data/catalog-store.json",
      vectorBackend: "qdrant",
      vectorServiceUrl: "http://127.0.0.1:6333",
      vectorCollectionName: "media-index",
      catalogRepository: {
        async initialize() {},
      },
      vectorRepository: {
        async initialize() {},
      },
    }),
    createIndexPipelineFn: () => ({
      async run() {
        return {
          implemented: true,
          phase: "ingestion",
          status: "completed",
          cache_mode: "refresh",
          scan_state: {
            framework_connection: "connected",
            permission_status: "authorized",
            library_access: "connected",
          },
          vector_index_state: {
            temp_file_usage: false,
            indexed_images: 70,
            indexed_videos: 20,
          },
          scanned_asset_count: 100,
          extracted_representation_count: 95,
          persisted_asset_count: 90,
          persisted_embedding_count: 90,
          skipped_representation_count: 5,
          timings: {
            total_ms: 5000,
            cache_read_ms: 0,
            scan_ms: 500,
            extract_ms: 1200,
            prepare_ms: 300,
            embed_ms: 2200,
            persist_ms: 800,
          },
          throughput: {
            scan_candidates_per_sec: 200,
            representations_extracted_per_sec: 79.167,
            embeddings_persisted_per_sec: 112.5,
          },
          breakdown: {
            image_representation_count: 80,
            video_representation_count: 15,
            prepared_image_count: 75,
            prepared_video_count: 15,
            skipped_image_count: 4,
            skipped_video_count: 1,
            failed_embedding_count: 2,
            skip_reasons: [
              { name: "timeout", count: 3 },
              { name: "missing-avasset", count: 2 },
            ],
          },
          slowest_stage: {
            stage: "embed",
            duration_ms: 2200,
            percent_of_total: 44,
          },
        };
      },
    }),
  });

  assert.equal(result.profile_enabled, true);
  assert.equal(result.timings.embed_ms, 2200);
  assert.equal(result.throughput.embeddings_persisted_per_sec, 112.5);
  assert.equal(result.breakdown.prepared_video_count, 15);
  assert.equal(result.slowest_stage.stage, "embed");
  assert.ok(result.lines.includes("Total time: 5.00s"));
  assert.ok(result.lines.includes("Timing embed: 2.20s"));
  assert.ok(result.lines.includes("Throughput persist: 112.500 embeddings/sec"));
  assert.ok(result.lines.includes("Representation breakdown: image 80, video 15"));
  assert.ok(result.lines.includes("Top skip reasons: timeout:3, missing-avasset:2"));
  assert.ok(
    result.lines.includes("Active model identity: open-clip:ViT-H-14:laion2b_s32b_b79k")
  );
  assert.ok(result.lines.includes("Active candidate preset: fallback-safe"));
  assert.ok(result.lines.includes("Target extractor resolution: 378"));
  assert.equal(
    result.lines.some((line) => line.includes("Re-index guidance: after changing embedding preset/model/pretrained/resolution")),
    true
  );
});

test("index pipeline extracts in chunks to avoid oversized bridge payloads", async () => {
  await withTempDir(async (tempDir) => {
    const catalogRepository = createCatalogRepository({
      filePath: path.join(tempDir, "catalog-store.json"),
    });
    const { fetchFn } = createMockQdrantFetch();
    const vectorRepository = createVectorRepository({
      backend: "qdrant",
      serviceUrl: "http://127.0.0.1:6333",
      collectionName: "media-index",
      distance: "cosine",
      fetchFn,
    });

    await catalogRepository.initialize();
    await vectorRepository.initialize();

    const extractionCalls = [];
    let bulkPersistCallCount = 0;
    const pipeline = createIndexPipeline({
      scanLibraryFn: async () => ({
        valid_asset_count: 3,
        assets: [
          { local_identifier: "A/L0/001", asset_type: "image" },
          { local_identifier: "B/L0/001", asset_type: "image" },
          { local_identifier: "C/L0/001", asset_type: "video" },
        ],
      }),
      extractRepresentationsFn: async ({ limit, offset, videoStrategy }) => {
        extractionCalls.push({ limit, offset, videoStrategy });
        const source = [
          {
            local_identifier: "A/L0/001",
            asset_type: "image",
            representation_kind: "image-thumbnail",
            byte_length: 4,
            bytes_base64: "YWJjZA==",
            metadata: { status: "ok" },
          },
          {
            local_identifier: "B/L0/001",
            asset_type: "image",
            representation_kind: "image-thumbnail",
            byte_length: 4,
            bytes_base64: "ZWZnaA==",
            metadata: { status: "ok" },
          },
          {
            local_identifier: "C/L0/001",
            asset_type: "video",
            representation_kind: "video-poster-frame",
            byte_length: 4,
            bytes_base64: "aWprbA==",
            metadata: { status: "ok" },
          },
        ];
        const slice = source.slice(offset, offset + limit);

        return {
          implemented: true,
          available_asset_count: source.length,
          representation_count: slice.length,
          image_representation_count: slice.filter((item) => item.asset_type === "image").length,
          video_representation_count: slice.filter((item) => item.asset_type === "video").length,
          representations: slice,
          errors: [],
        };
      },
      createEmbeddingProviderFn: () => ({
        modelIdentity: "open-clip:ViT-B-32:test",
        async embedRepresentations({ representations }) {
          return representations.map((representation) => ({
            local_identifier: representation.local_identifier,
            representation_kind: representation.representation_kind,
            status: "ready",
            vector: [0.1, 0.2, 0.3],
            embedding_provider: "open-clip",
            embedding_model: "ViT-B-32",
            model_identity: "open-clip:ViT-B-32:test",
          }));
        },
      }),
      catalogRepository,
      vectorRepository: {
        ...vectorRepository,
        async upsertEmbeddings(items) {
          bulkPersistCallCount += 1;
          return vectorRepository.upsertEmbeddings(items);
        },
      },
    });

    const config = structuredClone(DEFAULT_CONFIG);
    config.indexer = {
      ...(config.indexer ?? {}),
      extraction_batch_size: 2,
    };

    const result = await pipeline.run({
      config,
      limit: 3,
      timeoutSeconds: 30,
      useCache: false,
    });

    assert.deepEqual(extractionCalls, [
      { limit: 2, offset: 0, videoStrategy: "storyboard" },
      { limit: 1, offset: 2, videoStrategy: "storyboard" },
    ]);
    assert.equal(result.extracted_representation_count, 3);
    assert.equal(result.persisted_embedding_count, 3);
    assert.equal(result.breakdown.prepared_image_count, 2);
    assert.equal(result.breakdown.prepared_video_count, 1);
    assert.equal(bulkPersistCallCount, 2);
  });
});

test("index pipeline keeps completed chunks persisted when a later chunk fails", async () => {
  await withTempDir(async (tempDir) => {
    const catalogRepository = createCatalogRepository({
      filePath: path.join(tempDir, "catalog-store.json"),
    });
    const { fetchFn } = createMockQdrantFetch();
    const vectorRepository = createVectorRepository({
      backend: "qdrant",
      serviceUrl: "http://127.0.0.1:6333",
      collectionName: "media-index",
      distance: "cosine",
      fetchFn,
    });

    await catalogRepository.initialize();
    await vectorRepository.initialize();

    const pipeline = createIndexPipeline({
      scanLibraryFn: async () => ({
        valid_asset_count: 3,
        assets: [
          { local_identifier: "A/L0/001", asset_type: "image" },
          { local_identifier: "B/L0/001", asset_type: "image" },
          { local_identifier: "C/L0/001", asset_type: "video" },
        ],
      }),
      extractRepresentationsFn: async ({ limit, offset }) => {
        if (offset === 2) {
          throw new Error("chunk exploded");
        }

        const source = [
          {
            local_identifier: "A/L0/001",
            asset_type: "image",
            representation_kind: "image-thumbnail",
            byte_length: 4,
            bytes_base64: "YWJjZA==",
            metadata: { status: "ok" },
          },
          {
            local_identifier: "B/L0/001",
            asset_type: "image",
            representation_kind: "image-thumbnail",
            byte_length: 4,
            bytes_base64: "ZWZnaA==",
            metadata: { status: "ok" },
          },
        ];
        const slice = source.slice(offset, offset + limit);

        return {
          implemented: true,
          available_asset_count: 3,
          representation_count: slice.length,
          image_representation_count: slice.filter((item) => item.asset_type === "image").length,
          video_representation_count: slice.filter((item) => item.asset_type === "video").length,
          representations: slice,
          errors: [],
        };
      },
      createEmbeddingProviderFn: () => ({
        modelIdentity: "open-clip:ViT-B-32:test",
        async embedRepresentations({ representations }) {
          return representations.map((representation) => ({
            local_identifier: representation.local_identifier,
            representation_kind: representation.representation_kind,
            status: "ready",
            vector: [0.1, 0.2, 0.3],
            embedding_provider: "open-clip",
            embedding_model: "ViT-B-32",
            model_identity: "open-clip:ViT-B-32:test",
          }));
        },
      }),
      catalogRepository,
      vectorRepository,
    });

    const config = structuredClone(DEFAULT_CONFIG);
    config.indexer = {
      ...(config.indexer ?? {}),
      extraction_batch_size: 2,
    };

    await assert.rejects(
      pipeline.run({
        config,
        limit: 3,
        timeoutSeconds: 30,
        useCache: false,
      }),
      (error) => {
        assert.equal(error.code, "INDEX_PIPELINE_PARTIAL_FAILURE");
        assert.equal(error.details.persisted_embedding_count, 2);
        return true;
      }
    );

    assert.equal(await catalogRepository.countAssets(), 2);
    assert.equal(await vectorRepository.countEmbeddings(), 2);
  });
});

test("index pipeline retries transient qdrant bulk persist failures before succeeding", async () => {
  await withTempDir(async (tempDir) => {
    const catalogRepository = createCatalogRepository({
      filePath: path.join(tempDir, "catalog-store.json"),
    });
    await catalogRepository.initialize();

    let persistAttempts = 0;
    const progressEvents = [];

    const pipeline = createIndexPipeline({
      scanLibraryFn: async () => ({
        valid_asset_count: 2,
        assets: [
          { local_identifier: "A/L0/001", asset_type: "image" },
          { local_identifier: "B/L0/001", asset_type: "image" },
        ],
      }),
      extractRepresentationsFn: async ({ limit, offset }) => {
        const source = [
          {
            local_identifier: "A/L0/001",
            asset_type: "image",
            representation_kind: "image-thumbnail",
            byte_length: 4,
            bytes_base64: "YWJjZA==",
            metadata: { status: "ok" },
          },
          {
            local_identifier: "B/L0/001",
            asset_type: "image",
            representation_kind: "image-thumbnail",
            byte_length: 4,
            bytes_base64: "ZWZnaA==",
            metadata: { status: "ok" },
          },
        ];
        const slice = source.slice(offset, offset + limit);

        return {
          implemented: true,
          available_asset_count: source.length,
          representation_count: slice.length,
          image_representation_count: slice.length,
          video_representation_count: 0,
          representations: slice,
          errors: [],
        };
      },
      createEmbeddingProviderFn: () => ({
        modelIdentity: "open-clip:ViT-B-32:test",
        async embedRepresentations({ representations }) {
          return representations.map((representation) => ({
            local_identifier: representation.local_identifier,
            representation_kind: representation.representation_kind,
            status: "ready",
            vector: [0.1, 0.2, 0.3],
            embedding_provider: "open-clip",
            embedding_model: "ViT-B-32",
            model_identity: "open-clip:ViT-B-32:test",
          }));
        },
      }),
      catalogRepository,
      vectorRepository: {
        async initialize() {},
        async upsertEmbeddings(items) {
          persistAttempts += 1;
          if (persistAttempts === 1) {
            throw new AppError("Failed to reach Qdrant at http://127.0.0.1:6333.", {
              code: "VECTOR_BACKEND_UNREACHABLE",
            });
          }

          return items.map(({ record }) => record);
        },
        async countEmbeddings() {
          return 0;
        },
        async getActiveEmbedding() {
          return null;
        },
      },
      onProgress(event) {
        progressEvents.push(event);
      },
    });

    const config = structuredClone(DEFAULT_CONFIG);
    config.indexer = {
      ...(config.indexer ?? {}),
      extraction_batch_size: 2,
      write_batch_size: 2,
    };

    const result = await pipeline.run({
      config,
      limit: 2,
      timeoutSeconds: 30,
      useCache: false,
    });

    assert.equal(persistAttempts, 2);
    assert.equal(result.persisted_embedding_count, 2);
    assert.equal(
      progressEvents.some((event) => event.event === "persist-retry" && event.attempt === 1),
      true
    );
  });
});

test("embedding provider factory supports open clip and forwards image/video representations in one batch", async () => {
  let capturedCommand = null;
  let capturedPayload = null;
  const provider = createEmbeddingProvider({
    config: structuredClone(DEFAULT_CONFIG),
    bridgeRunner: (command, payload) => {
      capturedCommand = command;
      capturedPayload = payload;
      return {
      ok: true,
      embeddings: [
        {
          local_identifier: "A1B2C3/L0/001",
          representation_kind: "image-thumbnail",
          status: "ready",
          vector: ["0.1", 0.2, 0.3],
          embedding_provider: "open-clip",
          embedding_model: "ViT-B-32",
          model_identity: "open-clip:ViT-B-32:laion2b_s34b_b79k",
        },
        {
          local_identifier: "D4E5F6/L0/002",
          representation_kind: "video-poster-frame",
          status: "ready",
          vector: ["0.4", 0.5, 0.6],
          embedding_provider: "open-clip",
          embedding_model: "ViT-B-32",
          model_identity: "open-clip:ViT-B-32:laion2b_s34b_b79k",
        },
      ],
    };
    },
  });

  const results = await provider.embedRepresentations({
    representations: [
      {
        local_identifier: "A1B2C3/L0/001",
        representation_kind: "image-thumbnail",
        asset_type: "image",
        bytes_base64: Buffer.from("image-bytes").toString("base64"),
      },
      {
        local_identifier: "D4E5F6/L0/002",
        representation_kind: "video-poster-frame",
        asset_type: "video",
        bytes_base64: Buffer.from("video-bytes").toString("base64"),
      },
    ],
  });

  assert.equal(provider.modelIdentity, "open-clip:ViT-B-32:laion2b_s34b_b79k");
  assert.equal(capturedCommand, "embed-image-batch");
  assert.equal(capturedPayload.representations.length, 2);
  assert.equal(capturedPayload.representations[1].asset_type, "video");
  assert.deepEqual(results[0].vector, [0.1, 0.2, 0.3]);
  assert.deepEqual(results[1].vector, [0.4, 0.5, 0.6]);
});

test("embedding provider unavailable error includes install guidance", async () => {
  const provider = createEmbeddingProvider({
    config: structuredClone(DEFAULT_CONFIG),
    bridgeRunner: () => ({
      ok: false,
      errors: ["open_clip import failed: No module named 'open_clip'"],
      requirements: [
        {
          kind: "python-library",
          name: "open_clip_torch",
          install_command: "python3 -m pip install open_clip_torch",
          message: "Install OpenCLIP so the provider can auto-download and run pretrained CLIP checkpoints.",
        },
      ],
    }),
  });

  await assert.rejects(
    () =>
      provider.embedRepresentations({
        representations: [
          {
            local_identifier: "A1B2C3/L0/001",
            representation_kind: "image-thumbnail",
            asset_type: "image",
            bytes_base64: Buffer.from("image-bytes").toString("base64"),
          },
        ],
      }),
    (error) => {
      assert.equal(error.code, "EMBEDDING_PROVIDER_UNAVAILABLE");
      assert.equal(error.details.requirements[0].name, "open_clip_torch");
      assert.equal(
        error.details.requirements[0].install_command,
        "python3 -m pip install open_clip_torch"
      );
      return true;
    }
  );
});

test("embedding provider factory supports text query embedding", async () => {
  const provider = createEmbeddingProvider({
    config: structuredClone(DEFAULT_CONFIG),
    bridgeRunner: (command, payload) => {
      assert.equal(command, "embed-text-query");
      assert.equal(payload.text, "sunset beach");
      return {
        ok: true,
        embedding: {
          text: "sunset beach",
          status: "ready",
          vector: ["0.7", 0.2, 0.1],
          embedding_provider: "open-clip",
          embedding_model: "ViT-B-32",
          model_identity: "open-clip:ViT-B-32:laion2b_s34b_b79k",
        },
      };
    },
  });

  const result = await provider.embedQuery({ text: " sunset beach " });

  assert.equal(result.text, "sunset beach");
  assert.deepEqual(result.vector, [0.7, 0.2, 0.1]);
});

test("search service ranks local image and video assets by cosine similarity", async () => {
  await withTempDir(async (tempDir) => {
    const catalogRepository = createCatalogRepository({
      filePath: path.join(tempDir, "catalog-store.json"),
    });
    const vectorRepository = createVectorRepository({
      filePath: path.join(tempDir, "vector-store.json"),
    });

    await Promise.all([
      catalogRepository.initialize(),
      vectorRepository.initialize(),
    ]);

    const imageAsset = await catalogRepository.upsertAsset({
      local_identifier: "IMG/001",
      asset_type: "image",
      pixel_width: 3024,
      pixel_height: 4032,
      modification_date: "2026-06-18T10:00:00.000Z",
      indexed_at: "2026-06-18T10:00:00.000Z",
      last_seen_at: "2026-06-18T10:00:00.000Z",
    });
    const videoAsset = await catalogRepository.upsertAsset({
      local_identifier: "VID/002",
      asset_type: "video",
      pixel_width: 1920,
      pixel_height: 1080,
      duration_seconds: 8.4,
      modification_date: "2026-06-18T11:00:00.000Z",
      indexed_at: "2026-06-18T11:00:00.000Z",
      last_seen_at: "2026-06-18T11:00:00.000Z",
    });

    await vectorRepository.saveEmbedding({
      record: buildEmbeddingRecord({
        asset_id: imageAsset.asset_id,
        local_identifier: imageAsset.local_identifier,
        representation_kind: "image-thumbnail",
        embedding_provider: "open-clip",
        embedding_model: "ViT-B-32",
        model_identity: "open-clip:ViT-B-32:laion2b_s34b_b79k",
        source_fingerprint: imageAsset.source_fingerprint,
        indexed_at: "2026-06-18T10:00:00.000Z",
        extraction_signature: "image-thumbnail:224",
      }),
      vector: [0.98, 0.02, 0],
    });
    await vectorRepository.saveEmbedding({
      record: buildEmbeddingRecord({
        asset_id: videoAsset.asset_id,
        local_identifier: videoAsset.local_identifier,
        representation_kind: "video-poster-frame",
        embedding_provider: "open-clip",
        embedding_model: "ViT-B-32",
        model_identity: "open-clip:ViT-B-32:laion2b_s34b_b79k",
        source_fingerprint: videoAsset.source_fingerprint,
        indexed_at: "2026-06-18T11:00:00.000Z",
        extraction_signature: "video-poster-frame:224",
      }),
      vector: [0.7, 0.7, 0],
    });

    const searchService = createSearchService({
      catalogRepository,
      vectorRepository,
      createEmbeddingProviderFn: () => ({
        modelIdentity: "open-clip:ViT-B-32:laion2b_s34b_b79k",
        async embedQuery({ text }) {
          assert.equal(text, "sunset beach");
          return {
            text,
            vector: [1, 0, 0],
            embedding_provider: "open-clip",
            embedding_model: "ViT-B-32",
            model_identity: "open-clip:ViT-B-32:laion2b_s34b_b79k",
          };
        },
      }),
    });

    const result = await searchService.search({
      query: "  sunset beach  ",
      config: structuredClone(DEFAULT_CONFIG),
      limit: 5,
    });

    assert.equal(result.result_count, 2);
    assert.equal(result.searched_embedding_count, 2);
    assert.equal(result.results[0].local_identifier, "IMG/001");
    assert.equal(result.results[0].asset_type, "image");
    assert.equal(result.results[0].representation_kind, "image-thumbnail");
    assert.equal(result.results[0].rank, 1);
    assert.equal(result.results[0].album_name, "AI Search Results");
    assert.equal(result.results[1].local_identifier, "VID/002");
    assert.equal(result.results[1].asset_type, "video");
    assert.equal(result.results[1].representation_kind, "video-poster-frame");
    assert.match(result.results[0].result_id, /^result:[a-f0-9]{64}$/);
    assert.equal(result.results[0].match_evidence.query_text, "sunset beach");
    assert.equal(result.results[0].match_evidence.strategy, "semantic-vector");
  });
});

test("search service rejects empty queries", async () => {
  await withTempDir(async (tempDir) => {
    const catalogRepository = createCatalogRepository({
      filePath: path.join(tempDir, "catalog-store.json"),
    });
    const vectorRepository = createVectorRepository({
      filePath: path.join(tempDir, "vector-store.json"),
    });

    await Promise.all([
      catalogRepository.initialize(),
      vectorRepository.initialize(),
    ]);

    const searchService = createSearchService({
      catalogRepository,
      vectorRepository,
      createEmbeddingProviderFn: () => ({
        async embedQuery() {
          throw new Error("should not run");
        },
      }),
    });

    await assert.rejects(
      () =>
        searchService.search({
          query: "   ",
          config: structuredClone(DEFAULT_CONFIG),
        }),
      (error) => {
        assert.equal(error.code, "SEARCH_QUERY_REQUIRED");
        return true;
      }
    );
  });
});

test("search service queries vector repository by model identity", async () => {
  const calls = [];
  const searchService = createSearchService({
    catalogRepository: {
      async getAssetByAssetId(assetId) {
        return {
          asset_id: assetId,
          local_identifier: "IMG/IDENTITY/001",
          asset_type: "image",
        };
      },
    },
    vectorRepository: {
      async countEmbeddings(filters) {
        calls.push({ fn: "countEmbeddings", filters });
        return 1;
      },
      async searchByVector(filters) {
        calls.push({ fn: "searchByVector", filters });
        return [
          {
            embedding: {
              asset_id: "asset:identity-1",
              embedding_id: "embedding:identity-1",
              representation_kind: "image-thumbnail",
              source_fingerprint: "fp:identity-1",
              embedding_dimensions: 3,
              indexed_at: "2026-06-18T10:00:00.000Z",
            },
            score: 0.99,
          },
        ];
      },
    },
    createEmbeddingProviderFn: () => ({
      async embedQuery({ text }) {
        return {
          text,
          vector: [1, 0, 0],
          embedding_provider: "open-clip",
          embedding_model: "ViT-B-32",
          model_identity: "open-clip:ViT-B-32:special-pretrained",
        };
      },
    }),
  });

  const result = await searchService.search({
    query: "identity check",
    config: structuredClone(DEFAULT_CONFIG),
    limit: 5,
  });

  assert.equal(result.result_count, 1);
  assert.equal(calls[0].filters.model_identity, "open-clip:ViT-B-32:special-pretrained");
  assert.equal(calls[1].filters.model_identity, "open-clip:ViT-B-32:special-pretrained");
});

test("search service can skip exact embedding count for benchmark compare runs", async () => {
  const calls = [];
  const searchService = createSearchService({
    catalogRepository: {
      async getAssetByAssetId(assetId) {
        return {
          asset_id: assetId,
          local_identifier: "IMG/BENCH/001",
          asset_type: "image",
        };
      },
    },
    vectorRepository: {
      async countEmbeddings(filters) {
        calls.push({ fn: "countEmbeddings", filters });
        return 1;
      },
      async searchByVector(filters) {
        calls.push({ fn: "searchByVector", filters });
        return [
          {
            embedding: {
              asset_id: "asset:bench-1",
              embedding_id: "embedding:bench-1",
              representation_kind: "image-thumbnail",
              source_fingerprint: "fp:bench-1",
              embedding_dimensions: 3,
              indexed_at: "2026-06-19T07:00:00.000Z",
            },
            score: 0.91,
          },
        ];
      },
    },
    createEmbeddingProviderFn: () => ({
      async embedQuery({ text }) {
        return {
          text,
          vector: [1, 0, 0],
          embedding_provider: "open-clip",
          embedding_model: "ViT-H-14",
          model_identity: "open-clip:ViT-H-14:laion2b_s32b_b79k",
        };
      },
    }),
  });

  const result = await searchService.search({
    query: "benchmark compare",
    config: structuredClone(DEFAULT_CONFIG),
    limit: 5,
    includeEmbeddingCount: false,
  });

  assert.equal(result.result_count, 1);
  assert.equal(result.searched_embedding_count, null);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].fn, "searchByVector");
  assert.match(
    result.notes.join("\n"),
    /Exact embedding count was skipped for this benchmark compare run\./
  );
});

test("album service ensures results album using configured album name", async () => {
  const albumService = createAlbumService({
    ensureResultsAlbumFn: ({ albumName }) => ({
      implemented: true,
      phase: "search",
      album_name: albumName,
      requested_album_name: albumName,
      album_local_identifier: "album/001",
      created: false,
      found_existing: true,
      estimated_asset_count: 0,
      errors: [],
    }),
  });

  const result = await albumService.ensureResultsAlbum({
    config: structuredClone(DEFAULT_CONFIG),
  });

  assert.equal(result.implemented, true);
  assert.equal(result.album_name, "AI Search Results");
  assert.equal(result.found_existing, true);
  assert.equal(result.created, false);
});

test("album service uses custom configured album name", async () => {
  const albumService = createAlbumService({
    ensureResultsAlbumFn: ({ albumName }) => ({
      implemented: true,
      phase: "search",
      album_name: albumName,
      requested_album_name: albumName,
      album_local_identifier: "album/custom",
      created: true,
      found_existing: false,
      estimated_asset_count: 0,
      errors: [],
    }),
  });

  const config = structuredClone(DEFAULT_CONFIG);
  config.app.results_album_name = "My AI Album";

  const result = await albumService.ensureResultsAlbum({ config });

  assert.equal(result.album_name, "My AI Album");
  assert.equal(result.requested_album_name, "My AI Album");
  assert.equal(result.created, true);
});

test("album output flow preserves order, deduplicates local identifiers, and tracks unresolved results", async () => {
  const albumService = createAlbumService({
    ensureResultsAlbumFn: ({ albumName }) => ({
      implemented: true,
      phase: "search",
      album_name: albumName,
      requested_album_name: albumName,
      album_local_identifier: "album/output",
      created: false,
      found_existing: true,
      estimated_asset_count: 0,
      errors: [],
    }),
  });

  const result = await albumService.buildAlbumOutput({
    config: structuredClone(DEFAULT_CONFIG),
    results: [
      {
        result_id: "result:1",
        local_identifier: "IMG/001",
        album_name: "AI Search Results",
      },
      {
        result_id: "result:2",
        local_identifier: "VID/002",
        album_name: "AI Search Results",
      },
      {
        result_id: "result:3",
        local_identifier: "IMG/001",
        album_name: "AI Search Results",
      },
      {
        result_id: "result:4",
        local_identifier: null,
        album_name: "AI Search Results",
      },
    ],
  });

  assert.equal(result.album_name, "AI Search Results");
  assert.equal(result.album_write_mode, "replace");
  assert.equal(result.requested_asset_count, 2);
  assert.deepEqual(result.requested_local_identifiers, ["IMG/001", "VID/002"]);
  assert.equal(result.results_received_count, 4);
  assert.deepEqual(result.unresolved_results, [
    {
      result_id: "result:4",
      local_identifier: null,
      reason: "missing-local-identifier",
    },
  ]);
});

test("album output flow falls back to configured album name when results omit one", async () => {
  const albumService = createAlbumService({
    ensureResultsAlbumFn: ({ albumName }) => ({
      implemented: true,
      phase: "search",
      album_name: albumName,
      requested_album_name: albumName,
      album_local_identifier: "album/fallback",
      created: true,
      found_existing: false,
      estimated_asset_count: 0,
      errors: [],
    }),
  });

  const config = structuredClone(DEFAULT_CONFIG);
  config.app.results_album_name = "Configured Album";

  const result = await albumService.buildAlbumOutput({
    config,
    results: [
      {
        result_id: "result:1",
        local_identifier: "IMG/100",
      },
    ],
  });

  assert.equal(result.album_name, "Configured Album");
  assert.equal(result.requested_local_identifiers[0], "IMG/100");
  assert.equal(result.created, true);
});

test("album output flow rejects mixed album targets", async () => {
  const albumService = createAlbumService({
    ensureResultsAlbumFn: () => {
      throw new Error("should not run");
    },
  });

  await assert.rejects(
    () =>
      albumService.buildAlbumOutput({
        config: structuredClone(DEFAULT_CONFIG),
        results: [
          {
            result_id: "result:1",
            local_identifier: "IMG/001",
            album_name: "Album A",
          },
          {
            result_id: "result:2",
            local_identifier: "VID/002",
            album_name: "Album B",
          },
        ],
      }),
    (error) => {
      assert.equal(error.code, "ALBUM_OUTPUT_MIXED_ALBUM_NAMES");
      return true;
    }
  );
});

test("album output write-back sends ordered local identifiers to the bridge and merges unresolved rows", async () => {
  const albumWrites = [];
  const albumService = createAlbumService({
    ensureResultsAlbumFn: ({ albumName }) => ({
      implemented: true,
      phase: "search",
      album_name: albumName,
      requested_album_name: albumName,
      album_local_identifier: "album/writeback",
      created: false,
      found_existing: true,
      estimated_asset_count: 1,
      errors: [],
    }),
    writeResultsAlbumFn: (payload) => {
      albumWrites.push(payload);
      return {
        implemented: true,
        phase: "search",
        album_name: payload.albumName,
        requested_album_name: payload.albumName,
        album_local_identifier: "album/writeback",
        album_write_mode: payload.albumWriteMode,
        created: false,
        found_existing: true,
        estimated_asset_count: 2,
        requested_asset_count: payload.localIdentifiers.length,
        applied_asset_count: 1,
        resolved_asset_count: 1,
        unresolved_results: [
          {
            result_id: null,
            local_identifier: "VID/404",
            reason: "asset-not-found",
          },
        ],
        errors: [],
        notes: ["Album write-back mutated the native Photos album."],
      };
    },
  });

  const result = await albumService.writeAlbumOutput({
    config: structuredClone(DEFAULT_CONFIG),
    results: [
      {
        result_id: "result:1",
        local_identifier: "IMG/001",
        album_name: "AI Search Results",
      },
      {
        result_id: "result:2",
        local_identifier: "VID/404",
        album_name: "AI Search Results",
      },
      {
        result_id: "result:3",
        local_identifier: null,
        album_name: "AI Search Results",
      },
    ],
  });

  assert.deepEqual(albumWrites, [
    {
      albumName: "AI Search Results",
      albumWriteMode: "replace",
      localIdentifiers: ["IMG/001", "VID/404"],
    },
  ]);
  assert.equal(result.requested_asset_count, 2);
  assert.equal(result.applied_asset_count, 1);
  assert.equal(result.resolved_asset_count, 1);
  assert.deepEqual(result.requested_local_identifiers, ["IMG/001", "VID/404"]);
  assert.deepEqual(result.unresolved_results, [
    {
      result_id: "result:3",
      local_identifier: null,
      reason: "missing-local-identifier",
    },
    {
      result_id: null,
      local_identifier: "VID/404",
      reason: "asset-not-found",
    },
  ]);
  assert.ok(
    result.notes.includes("Album write-back mutated the native Photos album.")
  );
});

test("search command orchestrates semantic retrieval and album write-back with debug output", async () => {
  const searchCalls = [];
  const albumCalls = [];

  const result = await runSearchCommand({
    cwd: "/tmp/mvi",
    args: ["sunset", "beach", "--limit", "3"],
    loadConfigFn: async () => ({
      config: structuredClone(DEFAULT_CONFIG),
      configPath: "/tmp/mvi/media-vector-index.config.json",
      exists: true,
    }),
    createStorageRepositoriesFn: () => ({
      storageRoot: "/tmp/mvi/.data",
      catalogDbPath: "/tmp/mvi/.data/catalog-store.json",
      vectorBackend: "qdrant",
      vectorServiceUrl: "http://127.0.0.1:6333",
      vectorCollectionName: "media-index",
      catalogRepository: {
        async initialize() {},
      },
      vectorRepository: {
        async initialize() {},
      },
    }),
    createSearchServiceFn: () => ({
      async search(payload) {
        searchCalls.push(payload);
        return {
          implemented: true,
          phase: "search-and-retrieval",
          status: "completed",
          query_text: "sunset beach",
          result_count: 1,
          searched_embedding_count: 9,
          results: [
            {
              result_id: "result:1",
              local_identifier: "IMG/001",
              asset_type: "image",
              representation_kind: "image-thumbnail",
              album_name: "AI Search Results",
              score: 0.9987,
              rank: 1,
            },
          ],
          notes: ["Semantic search ranked local image/video embeddings."],
        };
      },
    }),
    createAlbumServiceFn: () => ({
      async writeAlbumOutput(payload) {
        albumCalls.push(payload);
        return {
          implemented: true,
          phase: "search",
          album_name: "AI Search Results",
          album_local_identifier: "album/001",
          album_write_mode: "replace",
          requested_asset_count: 1,
          applied_asset_count: 1,
          resolved_asset_count: 1,
          unresolved_results: [],
          notes: ["Album write-back mutated the native Photos album."],
        };
      },
    }),
  });

  assert.deepEqual(searchCalls, [
    {
      query: "sunset beach",
      config: structuredClone(DEFAULT_CONFIG),
      limit: 3,
    },
  ]);
  assert.deepEqual(albumCalls, [
    {
      results: [
        {
          result_id: "result:1",
          local_identifier: "IMG/001",
          asset_type: "image",
          representation_kind: "image-thumbnail",
          album_name: "AI Search Results",
          score: 0.9987,
          rank: 1,
        },
      ],
      config: structuredClone(DEFAULT_CONFIG),
    },
  ]);
  assert.equal(result.summary, "Semantic search completed and Photos album updated.");
  assert.equal(result.query_text, "sunset beach");
  assert.equal(result.result_count, 1);
  assert.equal(result.applied_asset_count, 1);
  assert.ok(result.lines.includes("Query: sunset beach"));
  assert.ok(result.lines.includes("Applied asset writes: 1"));
  assert.ok(
    result.lines.some((line) =>
      line.includes("Top match #1: score=0.9987 asset=image representation=image-thumbnail localIdentifier=IMG/001")
    )
  );
});

test("shared search workflow returns the same structured payload as the CLI search path", async () => {
  const result = await executeSearchWorkflow({
    cwd: "/tmp/mvi",
    query: "sunset beach",
    limit: 4,
    loadConfigFn: async () => ({
      config: structuredClone(DEFAULT_CONFIG),
      configPath: "/tmp/mvi/media-vector-index.config.json",
      exists: true,
    }),
    createStorageRepositoriesFn: () => ({
      storageRoot: "/tmp/mvi/.data",
      catalogDbPath: "/tmp/mvi/.data/catalog-store.json",
      vectorBackend: "qdrant",
      vectorServiceUrl: "http://127.0.0.1:6333",
      vectorCollectionName: "media-index",
      catalogRepository: {
        async initialize() {},
      },
      vectorRepository: {
        async initialize() {},
      },
    }),
    createSearchServiceFn: () => ({
      async search() {
        return {
          implemented: true,
          phase: "search-and-retrieval",
          status: "completed",
          query_text: "sunset beach",
          result_count: 1,
          searched_embedding_count: 11,
          results: [
            {
              result_id: "result:1",
              local_identifier: "IMG/001",
              asset_type: "image",
              representation_kind: "image-thumbnail",
              album_name: "AI Search Results",
              score: 0.9812,
              rank: 1,
            },
          ],
          notes: ["Semantic search ranked local image/video embeddings."],
        };
      },
    }),
    createAlbumServiceFn: () => ({
      async writeAlbumOutput() {
        return {
          implemented: true,
          phase: "search",
          album_name: "AI Search Results",
          album_local_identifier: "album/001",
          album_write_mode: "replace",
          requested_asset_count: 1,
          applied_asset_count: 1,
          resolved_asset_count: 1,
          unresolved_results: [],
          notes: ["Album write-back mutated the native Photos album."],
        };
      },
    }),
  });

  assert.equal(result.command, "search");
  assert.equal(result.query_text, "sunset beach");
  assert.equal(result.limit, 4);
  assert.equal(result.result_count, 1);
  assert.equal(result.applied_asset_count, 1);
  assert.ok(result.lines.includes("Results returned: 1"));
});

test("shared search workflow skips Photos album write-back when config disables it", async () => {
  const config = structuredClone(DEFAULT_CONFIG);
  config.retriever.write_to_photos_results_album = false;
  let albumTouched = false;

  const result = await executeSearchWorkflow({
    cwd: "/tmp/mvi",
    query: "sunset beach",
    limit: 4,
    loadConfigFn: async () => ({
      config,
      configPath: "/tmp/mvi/media-vector-index.config.json",
      exists: true,
    }),
    createStorageRepositoriesFn: () => ({
      storageRoot: "/tmp/mvi/.data",
      catalogDbPath: "/tmp/mvi/.data/catalog-store.json",
      vectorBackend: "qdrant",
      vectorServiceUrl: "http://127.0.0.1:6333",
      vectorCollectionName: "media-index",
      catalogRepository: {
        async initialize() {},
      },
      vectorRepository: {
        async initialize() {},
      },
    }),
    createSearchServiceFn: () => ({
      async search() {
        return {
          implemented: true,
          phase: "search-and-retrieval",
          status: "completed",
          query_text: "sunset beach",
          result_count: 1,
          searched_embedding_count: 11,
          results: [
            {
              result_id: "result:1",
              local_identifier: "IMG/001",
              asset_type: "image",
              representation_kind: "image-thumbnail",
              album_name: "AI Search Results",
              score: 0.9812,
              rank: 1,
            },
          ],
          notes: ["Semantic search ranked local image/video embeddings."],
        };
      },
    }),
    createAlbumServiceFn: () => ({
      async writeAlbumOutput() {
        albumTouched = true;
        throw new Error("should not run");
      },
    }),
  });

  assert.equal(albumTouched, false);
  assert.equal(
    result.summary,
    "Semantic search completed without Photos album write-back."
  );
  assert.equal(result.album_write_mode, "skipped");
  assert.equal(result.applied_asset_count, 0);
  assert.ok(
    result.notes.includes(
      "Album write-back was disabled by config for this search run."
    )
  );
});

test("search command rejects an empty query before touching repositories", async () => {
  let storageTouched = false;

  await assert.rejects(
    () =>
      runSearchCommand({
        cwd: "/tmp/mvi",
        args: ["--limit", "5"],
        loadConfigFn: async () => ({
          config: structuredClone(DEFAULT_CONFIG),
          configPath: "/tmp/mvi/media-vector-index.config.json",
          exists: true,
        }),
        createStorageRepositoriesFn: () => {
          storageTouched = true;
          throw new Error("should not run");
        },
      }),
    (error) => {
      assert.equal(error.code, "SEARCH_QUERY_REQUIRED");
      return true;
    }
  );

  assert.equal(storageTouched, false);
});

test("config validation rejects a non-boolean retriever.write_to_photos_results_album", () => {
  const config = structuredClone(DEFAULT_CONFIG);
  config.retriever.write_to_photos_results_album = "no";

  assert.throws(
    () => validateConfig(config),
    (error) => {
      assert.equal(error.code, "CONFIG_FIELD_INVALID");
      assert.equal(
        error.details?.field,
        "retriever.write_to_photos_results_album"
      );
      return true;
    }
  );
});

test("config validation rejects an unsupported extractor.video_strategy", () => {
  const config = structuredClone(DEFAULT_CONFIG);
  config.extractor.video_strategy = "full-video";

  assert.throws(
    () => validateConfig(config),
    (error) => {
      assert.equal(error.code, "CONFIG_FIELD_INVALID");
      assert.equal(error.details.field, "extractor.video_strategy");
      return true;
    }
  );
});

test("search webserver serves the HTML entrypoint and health payload", async () => {
  const server = createSearchWebServer({
    cwd: "/tmp/mvi",
    loadConfigFn: async () => ({
      config: structuredClone(DEFAULT_CONFIG),
      configPath: "/tmp/mvi/media-vector-index.config.json",
      exists: true,
    }),
    executeSearchFn: async () => ({
      query_text: "unused",
    }),
  });

  const [htmlResponse, healthResponse] = await Promise.all([
    dispatchServerRequest(server, {
      method: "GET",
      url: "/",
    }),
    dispatchServerRequest(server, {
      method: "GET",
      url: "/api/health",
    }),
  ]);

  assert.equal(htmlResponse.status, 200);
  assert.match(htmlResponse.body, /Media Vector Index/);

  assert.equal(healthResponse.status, 200);
  const healthPayload = healthResponse.json();
  assert.equal(healthPayload.status, "ok");
  assert.equal(healthPayload.default_limit, DEFAULT_CONFIG.retriever.default_limit);
});

test("search webserver POST /api/search returns the search payload", async () => {
  const searchCalls = [];
  const server = createSearchWebServer({
    cwd: "/tmp/mvi",
    loadConfigFn: async () => ({
      config: structuredClone(DEFAULT_CONFIG),
      configPath: "/tmp/mvi/media-vector-index.config.json",
      exists: true,
    }),
    executeSearchFn: async (payload) => {
      searchCalls.push(payload);
      return {
        summary: "Semantic search completed and Photos album updated.",
        query_text: payload.query,
        limit: payload.limit,
        result_count: 1,
        searched_embedding_count: 5,
        album_name: "AI Search Results",
        album_write_mode: "replace",
        requested_asset_count: 1,
        applied_asset_count: 1,
        unresolved_results: [],
        results: [
          {
            rank: 1,
            score: 0.92,
            asset_type: "image",
            representation_kind: "image-thumbnail",
            local_identifier: "IMG/001",
          },
        ],
      };
    },
  });

  const response = await dispatchServerRequest(server, {
    method: "POST",
    url: "/api/search",
    body: {
      query: "sunset beach",
      limit: 7,
    },
  });

  assert.equal(response.status, 200);
  const payload = response.json();
  assert.equal(payload.query_text, "sunset beach");
  assert.equal(payload.limit, 7);
  assert.deepEqual(searchCalls, [
    {
      cwd: "/tmp/mvi",
      query: "sunset beach",
      limit: 7,
    },
  ]);
});

test("search webserver validates empty queries and invalid limits", async () => {
  const server = createSearchWebServer({
    cwd: "/tmp/mvi",
    loadConfigFn: async () => ({
      config: structuredClone(DEFAULT_CONFIG),
      configPath: "/tmp/mvi/media-vector-index.config.json",
      exists: true,
    }),
  });

  const emptyQueryResponse = await dispatchServerRequest(server, {
    method: "POST",
    url: "/api/search",
    body: {
      query: "   ",
    },
  });
  const invalidLimitResponse = await dispatchServerRequest(server, {
    method: "POST",
    url: "/api/search",
    body: {
      query: "sunset",
      limit: 0,
    },
  });

  assert.equal(emptyQueryResponse.status, 400);
  assert.equal(emptyQueryResponse.json().code, "SEARCH_QUERY_REQUIRED");
  assert.equal(invalidLimitResponse.status, 400);
  assert.equal(invalidLimitResponse.json().code, "SEARCH_LIMIT_INVALID");
});

test("search webserver returns structured errors with diagnostic log paths", async () => {
  const server = createSearchWebServer({
    cwd: "/tmp/mvi",
    loadConfigFn: async () => ({
      config: structuredClone(DEFAULT_CONFIG),
      configPath: "/tmp/mvi/media-vector-index.config.json",
      exists: true,
    }),
    executeSearchFn: async () => {
      const error = new Error("vector backend unavailable");
      error.code = "VECTOR_BACKEND_UNAVAILABLE";
      throw error;
    },
    writeDiagnosticLogFn: async () => "/tmp/mvi/logs/web-error.json",
  });

  const response = await dispatchServerRequest(server, {
    method: "POST",
    url: "/api/search",
    body: {
      query: "sunset beach",
    },
  });

  assert.equal(response.status, 500);
  const payload = response.json();
  assert.equal(payload.code, "UNHANDLED_ERROR");
  assert.equal(payload.details.diagnostic_log_path, "/tmp/mvi/logs/web-error.json");
});

test("serve command starts the local search webserver on the requested port", async () => {
  const result = await runServeCommand({
    cwd: "/tmp/mvi",
    args: ["--port", "4175"],
    startSearchWebServerFn: async ({ host, port }) => ({
      address: {
        host,
        port,
        url: `http://${host}:${port}`,
      },
    }),
  });

  assert.equal(result.command, "serve");
  assert.equal(result.port, 4175);
  assert.ok(result.url.endsWith(":4175"));
  assert.equal(result.host, "127.0.0.1");
});

test("embedding capability lines render concrete requirement guidance", async () => {
  const lines = buildCapabilityLines({
    provider: "open-clip",
    model: "ViT-B-32",
    pretrained: "laion2b_s34b_b79k",
    platform: "Darwin",
    capabilities: {
      torch_available: true,
      open_clip_available: false,
      pillow_available: true,
      runtime_device: "mps",
      downloads_model_on_first_run: true,
    },
    requirements: [
      {
        kind: "python-library",
        name: "open_clip_torch",
        install_command: "python3 -m pip install open_clip_torch",
        message: "Install OpenCLIP so the provider can auto-download and run pretrained CLIP checkpoints.",
      },
      {
        kind: "network-or-cache",
        name: "pretrained model download",
        message: "Ensure the machine has internet access on first run so OpenCLIP can download pretrained weights, or warm the cache ahead of time.",
      },
    ],
  });

  assert.ok(
    lines.some((line) => line.includes("Install: python3 -m pip install open_clip_torch"))
  );
  assert.ok(lines.some((line) => line.includes("pretrained model download")));
});
