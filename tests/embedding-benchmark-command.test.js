import test from "node:test";
import assert from "node:assert/strict";
import { runEmbeddingBenchmarkCommand } from "../src/cli/commands/embedding-benchmark.js";

test("embedding benchmark command parses candidate ladder and renders summary lines", async () => {
  const payload = await runEmbeddingBenchmarkCommand({
    cwd: "/tmp/mvi",
    args: [
      "--candidates",
      "baseline,stretch",
      "--asset-limit",
      "12",
      "--query-limit",
      "3",
      "--query-pack",
      "./specs/001-stronger-embedding-model/benchmark-query-pack.json",
    ],
    runEmbeddingBenchmarkFn: async (options) => {
      assert.deepEqual(options.candidatePresets, ["baseline", "stretch"]);
      assert.equal(options.assetLimit, 12);
      assert.equal(options.queryLimit, 3);
      assert.equal(
        options.queryPackPath,
        "./specs/001-stronger-embedding-model/benchmark-query-pack.json"
      );

      return {
        implemented: true,
        status: "completed",
        summary: "Embedding benchmark ladder completed.",
        config_exists: true,
        query_pack_path: options.queryPackPath,
        results_artifact_path:
          "/tmp/mvi/specs/001-stronger-embedding-model/benchmark-results/run.json",
        asset_limit: options.assetLimit,
        query_limit: options.queryLimit,
        results: [
          {
            rank: 1,
            candidate_preset: "baseline",
            status: "bench-passed",
            model_identity: "open-clip:ViT-B-32:laion2b_s34b_b79k",
            capability_ok: true,
            runtime_device: "mps",
            recommended_extractor_size: 224,
            indexing_status: "completed",
            indexing_items_per_second: 3.25,
            query_latency_ms: 18.2,
            quality_notes: ["sunset beach: top=IMG/001 score=0.9921"],
          },
          {
            rank: 2,
            candidate_preset: "stretch",
            status: "probe-failed",
            model_identity: "open-clip:PE-Core-bigG-14-448:metaclip_fullcc",
            capability_ok: false,
            runtime_device: "cpu",
            recommended_extractor_size: 448,
            indexing_status: "skipped",
            indexing_items_per_second: null,
            query_latency_ms: null,
            failure_mode: "capability-probe-failed",
            quality_notes: ["Capability probe failed before indexing, so this rung was skipped."],
          },
        ],
      };
    },
  });

  assert.equal(payload.command, "embedding benchmark");
  assert.match(payload.lines[0], /Config present: yes/);
  assert.match(payload.lines.join("\n"), /1\. baseline \[bench-passed\]/);
  assert.match(payload.lines.join("\n"), /2\. stretch \[probe-failed\]/);
  assert.match(payload.lines.join("\n"), /extractor=448/);
});
