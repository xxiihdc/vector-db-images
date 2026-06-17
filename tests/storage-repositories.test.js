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
      embedding_provider: "local",
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

test("index pipeline persists assets and embeddings without duplicates across reruns", async () => {
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
      now: () => "2026-06-17T12:00:00.000Z",
    });

    const config = structuredClone(DEFAULT_CONFIG);
    config.embedding.model = "phase3-placeholder";

    const firstRun = await pipeline.run({
      config,
      limit: 2,
      timeoutSeconds: 30,
    });
    const secondRun = await pipeline.run({
      config,
      limit: 2,
      timeoutSeconds: 30,
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
    assert.equal(secondRun.persisted_asset_count, 2);
    assert.equal(secondRun.persisted_embedding_count, 2);
    assert.equal(await catalogRepository.countAssets(), 2);
    assert.equal(await vectorRepository.countEmbeddings(), 2);
    assert.equal(firstAssetEmbeddings.length, 1);
    assert.equal(secondAssetEmbeddings.length, 1);
    assert.equal(firstAssetEmbeddings[0].embedding_dimensions, 16);
    assert.equal(secondAssetEmbeddings[0].embedding_dimensions, 16);
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
      embedding_provider: "local",
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
  });
});
