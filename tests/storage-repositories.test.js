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

async function withTempDir(callback) {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "mvi-storage-test-"));

  try {
    await callback(tempDir);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
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

test("init scaffold writes real storage files instead of placeholders", async () => {
  await withTempDir(async (tempDir) => {
    const result = await initializeProjectScaffold(tempDir, { force: true });

    assert.equal(result.created, true);
    assert.match(result.catalogDbPath, /catalog-store\.json$/);
    assert.match(result.vectorDbPath, /vector-store\.json$/);
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
      vectorDbPath: path.resolve(tempDir, STORAGE_LAYOUT.vector_db_path),
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
