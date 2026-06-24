#!/usr/bin/env node

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  applyOpenClipCandidateToConfig,
  getOpenClipCandidateByPreset,
} from "../src/embedding/providers/open-clip/model-candidates.js";
import { loadProjectEnv } from "../src/shared/utils/project-env.js";
import { resolveProjectRoot } from "../src/shared/utils/project-paths.js";

const execFileAsync = promisify(execFile);
loadProjectEnv();
const projectRoot = resolveProjectRoot();
const CONFIG_PATH = path.resolve(projectRoot, "media-vector-index.config.json");

function summarize(label, payload) {
  const lines = [
    `${label}:`,
    `  cache_mode=${payload.cache_mode}`,
    `  model_identity=${payload.vector_index_state?.provider_model_identity ?? "n/a"}`,
    `  persisted_asset_count=${payload.persisted_asset_count}`,
    `  persisted_embedding_count=${payload.persisted_embedding_count}`,
    `  skipped_representation_count=${payload.skipped_representation_count}`,
  ];

  return lines.join("\n");
}

async function runIndex(command, args) {
  const { stdout } = await execFileAsync("node", ["./src/cli/main.js", command, ...args], {
    cwd: projectRoot,
    maxBuffer: 16 * 1024 * 1024,
  });

  return JSON.parse(stdout);
}

async function loadConfig() {
  return JSON.parse(await readFile(CONFIG_PATH, "utf8"));
}

async function saveConfig(config) {
  await writeFile(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

async function main() {
  const baselineConfig = await loadConfig();
  const upgradeCandidate = getOpenClipCandidateByPreset(process.argv[2] ?? "fallback-safe");

  if (!upgradeCandidate) {
    throw new Error("Unknown upgrade preset. Pass one of the configured model candidate presets.");
  }

  const upgradeConfig = applyOpenClipCandidateToConfig(baselineConfig, upgradeCandidate);

  try {
    const cacheHit = await runIndex("index", ["--limit", "1", "--json"]);

    await saveConfig(upgradeConfig);
    const upgradeRefresh = await runIndex("reindex", ["--limit", "1", "--json"]);

    await saveConfig(baselineConfig);
    const rollbackRefresh = await runIndex("reindex", ["--limit", "1", "--json"]);

    console.log("Index cache and rollback verification completed.");
    console.log("");
    console.log(summarize("Cache hit", cacheHit));
    console.log("");
    console.log(summarize(`Upgrade refresh (${upgradeCandidate.preset})`, upgradeRefresh));
    console.log("");
    console.log(summarize("Rollback refresh (baseline restored)", rollbackRefresh));
  } finally {
    await saveConfig(baselineConfig);
  }
}

await main();
