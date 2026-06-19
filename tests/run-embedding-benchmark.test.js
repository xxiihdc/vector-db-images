import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, writeFile } from "node:fs/promises";
import { runEmbeddingBenchmark } from "../src/app/search/run-embedding-benchmark.js";

test("embedding benchmark disables exact embedding count during compare queries", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "mvi-benchmark-test-"));
  const queryPackPath = path.join(tempDir, "benchmark-query-pack.json");
  await writeFile(
    queryPackPath,
    JSON.stringify({
      name: "test-query-pack",
      text_queries: ["sunset beach", "dog running", "group photo indoors"],
    }),
    "utf8"
  );
  const searchCalls = [];
  const payload = await runEmbeddingBenchmark({
    cwd: tempDir,
    candidatePresets: ["baseline"],
    assetLimit: 10,
    queryLimit: 2,
    queryPackPath,
    loadConfigFn: async () => ({
      exists: true,
      configPath: path.join(tempDir, "media-vector-index.config.json"),
      config: {
        app: { results_album_name: "AI Search Results" },
        extractor: { video_strategy: "storyboard" },
        retriever: { default_limit: 50 },
        embedding: {
          benchmark_asset_limit: 10,
          batch_size: 8,
          benchmark_batch_size: 8,
        },
      },
    }),
    createStorageRepositoriesFn: () => ({
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
          status: "completed",
          throughput: { embeddings_persisted_per_sec: 123.4 },
          persisted_embedding_count: 10,
        };
      },
    }),
    createSearchServiceFn: () => ({
      async search(options) {
        searchCalls.push(options);
        return {
          implemented: true,
          phase: "search-and-retrieval",
          status: "completed",
          query_text: options.query,
          result_count: 1,
          results: [
            {
              local_identifier: "IMG/001",
              score: 0.99,
            },
          ],
          searched_embedding_count: null,
          notes: ["Exact embedding count was skipped for this benchmark compare run."],
        };
      },
    }),
    probeOpenClipCapabilitiesFn: () => ({
      ok: true,
      capabilities: {
        runtime_device: "mps",
        recommended_extractor_size: 224,
      },
      requirements: [],
    }),
    now: () => new Date("2026-06-19T08:00:00.000Z"),
  });

  assert.equal(searchCalls.length, 3);
  for (const call of searchCalls) {
    assert.equal(call.includeEmbeddingCount, false);
  }
  assert.match(
    payload.results[0].quality_notes.join("\n"),
    /Compare path skipped exact embedding count to avoid non-critical backend metric reads\./
  );
});
