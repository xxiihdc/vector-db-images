#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { readLocalImageFile } from "../src/shared/utils/local-image-file.js";
import { loadProjectEnv } from "../src/shared/utils/project-env.js";
import { resolveProjectRoot } from "../src/shared/utils/project-paths.js";

const scriptFilePath = fileURLToPath(import.meta.url);
const scriptDir = path.dirname(scriptFilePath);
loadProjectEnv({ cwd: path.resolve(scriptDir, "..") });
const repoRoot = resolveProjectRoot(path.resolve(scriptDir, ".."));

function normalizeImagePathArg(argv = []) {
  const combined = argv
    .slice(2)
    .join(" ")
    .replace(/\r\n/g, "\n")
    .replace(/\s*\n\s*/g, "")
    .trim();

  return combined;
}

function runCommand(command, args, { parseJson = false } = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    cwd: repoRoot,
  });

  if (result.stdout) {
    process.stdout.write(result.stdout);
  }

  if (result.stderr) {
    process.stderr.write(result.stderr);
  }

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }

  if (!parseJson) {
    return result.stdout ?? "";
  }

  return result.stdout ? JSON.parse(result.stdout) : null;
}

async function main() {
  const rawImagePath = normalizeImagePathArg(process.argv);

  if (!rawImagePath) {
    console.error("Usage: node ./scripts/verify-image-search.js <image-path>");
    console.error('Example: npm run verify:image-search -- "/absolute/path/to/exported image.jpg"');
    process.exit(1);
  }

  const imagePath = path.resolve(rawImagePath);

  console.log("Step 1/3: Verify sample config is in sync.");
  runCommand("npm", ["run", "config:check-sample"]);

  console.log("");
  console.log("Step 2/3: Index the local image file.");
  const indexPayload = runCommand("node", [
    "./src/cli/main.js",
    "index",
    "file",
    imagePath,
    "--json",
  ], { parseJson: true });

  console.log("");
  console.log("Step 3/3: Search back with the same image file.");
  const searchPayload = runCommand("node", [
    "./src/cli/main.js",
    "search",
    "image",
    imagePath,
    "--skip-album",
    "--limit",
    "5",
    "--json",
  ], { parseJson: true });

  const expectedLocalIdentifier = indexPayload?.local_identifier;
  const topResult = searchPayload?.results?.[0] ?? null;
  const topScore = Number(topResult?.score ?? 0);

  if (!expectedLocalIdentifier || !topResult) {
    console.error("Verification failed: missing indexed asset or search result.");
    process.exit(1);
  }

  if (topResult.local_identifier !== expectedLocalIdentifier) {
    console.error("Verification failed: top hit did not resolve to the indexed image.");
    console.error(`Expected: ${expectedLocalIdentifier}`);
    console.error(`Actual:   ${topResult.local_identifier}`);
    process.exit(1);
  }

  if (topScore < 0.999) {
    console.error("Verification failed: top hit score was lower than expected.");
    console.error(`Top score: ${topScore.toFixed(4)}`);
    process.exit(1);
  }

  const imageFile = await readLocalImageFile(imagePath);
  console.log("");
  console.log("Exact image search verification passed.");
  console.log(`Synthetic localIdentifier: ${imageFile.local_identifier}`);
  console.log(`Top score: ${topScore.toFixed(4)}`);
}

await main();
