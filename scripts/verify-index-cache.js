#!/usr/bin/env node

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

function summarize(label, payload) {
  const lines = [
    `${label}:`,
    `  cache_mode=${payload.cache_mode}`,
    `  scanned_asset_count=${payload.scanned_asset_count}`,
    `  extracted_representation_count=${payload.extracted_representation_count}`,
    `  persisted_asset_count=${payload.persisted_asset_count}`,
    `  persisted_embedding_count=${payload.persisted_embedding_count}`,
  ];

  return lines.join("\n");
}

async function runIndex(args) {
  const { stdout } = await execFileAsync("node", ["./src/cli/main.js", "index", ...args], {
    cwd: process.cwd(),
    maxBuffer: 16 * 1024 * 1024,
  });

  return JSON.parse(stdout);
}

async function main() {
  const cacheHit = await runIndex(["--limit", "1", "--json"]);
  const refresh = await runIndex(["--limit", "1", "--no-cache", "--json"]);

  console.log("Index cache verification completed.");
  console.log("");
  console.log(summarize("Cache hit", cacheHit));
  console.log("");
  console.log(summarize("Forced refresh", refresh));
}

await main();
