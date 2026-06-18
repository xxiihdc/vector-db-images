import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createCatalogRepository } from "../src/storage/catalog/catalog-repository.js";
import { createVectorRepository } from "../src/storage/vector/vector-repository.js";
import { buildAssetRecord } from "../src/indexer/records/asset-record.js";
import { buildEmbeddingRecord } from "../src/indexer/records/embedding-record.js";
import { initializeProjectScaffold } from "../src/config/load-config.js";
import { DEFAULT_CONFIG } from "../src/config/defaults/config.js";
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

async function withTempDir(callback) {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "mvi-storage-test-"));

  try {
    await callback(tempDir);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

function createJsonResponse(status, payload) {
  return {
    status,
    async json() {
      return payload;
    },
  };
}

function matchesMustCondition(point, condition) {
  if (!condition?.key) {
    return true;
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
    collection: null,
    points: new Map(),
    calls: [],
  };

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
          collections: state.collection ? [{ name: state.collection.name }] : [],
        },
      });
    }

    if (pathname === "/collections/media-index" && method === "GET") {
      if (!state.collection) {
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
                size: state.collection.size,
                distance: state.collection.distance,
              },
            },
          },
        },
      });
    }

    if (pathname === "/collections/media-index" && method === "PUT") {
      state.collection = {
        name: "media-index",
        size: body.vectors.size,
        distance: body.vectors.distance,
      };
      return createJsonResponse(200, {
        status: "ok",
        result: true,
      });
    }

    if (pathname === "/collections/media-index/points" && method === "PUT") {
      for (const point of body.points ?? []) {
        state.points.set(point.id, structuredClone(point));
      }

      return createJsonResponse(200, {
        status: "ok",
        result: {
          operation_id: 1,
          status: "acknowledged",
        },
      });
    }

    if (pathname === "/collections/media-index/points/scroll" && method === "POST") {
      const filteredPoints = Array.from(state.points.values())
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

    if (pathname === "/collections/media-index/points/count" && method === "POST") {
      const count = Array.from(state.points.values()).filter((point) =>
        matchesFilter(point, body?.filter)
      ).length;

      return createJsonResponse(200, {
        status: "ok",
        result: {
          count,
        },
      });
    }

    if (pathname === "/collections/media-index/points/query" && method === "POST") {
      const hits = Array.from(state.points.values())
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
