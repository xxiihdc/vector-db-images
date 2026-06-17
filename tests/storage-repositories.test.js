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
