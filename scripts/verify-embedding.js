#!/usr/bin/env node

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  applyOpenClipCandidateToConfig,
  OPEN_CLIP_MODEL_CANDIDATES,
} from "../src/embedding/providers/open-clip/model-candidates.js";
import { loadProjectEnv } from "../src/shared/utils/project-env.js";
import { resolveProjectRoot } from "../src/shared/utils/project-paths.js";

const execFileAsync = promisify(execFile);
loadProjectEnv();
const projectRoot = resolveProjectRoot();
const CONFIG_PATH = path.resolve(projectRoot, "media-vector-index.config.json");

async function loadConfig() {
  return JSON.parse(await readFile(CONFIG_PATH, "utf8"));
}

async function saveConfig(config) {
  await writeFile(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

async function runCapabilities() {
  const { stdout } = await execFileAsync(
    "node",
    ["./src/cli/main.js", "embedding", "capabilities", "--json"],
    {
      cwd: projectRoot,
      maxBuffer: 16 * 1024 * 1024,
    }
  );

  return JSON.parse(stdout);
}

function summarizeProbe(payload = {}) {
  const requirementNames = Array.isArray(payload.requirements)
    ? payload.requirements.map((requirement) => requirement.name).join(", ")
    : "";
  const warnings = Array.isArray(payload.warnings) ? payload.warnings.join(" | ") : "";

  return [
    `candidate=${payload.candidate?.candidate_preset ?? "custom"}`,
    `model_identity=${payload.model_identity ?? "unknown"}`,
    `ready=${payload.ok ? "yes" : "no"}`,
    `runtime_device=${payload.capabilities?.runtime_device ?? "unknown"}`,
    `load_ok=${payload.capabilities?.load_ok ? "yes" : "no"}`,
    `recommended_extractor_size=${payload.capabilities?.recommended_extractor_size ?? "unknown"}`,
    `requirements=${requirementNames || "none"}`,
    `warnings=${warnings || "none"}`,
  ].join("\n  ");
}

async function main() {
  console.log("Step 1/2: Verify sample config is in sync.");
  const { stdout: configCheck } = await execFileAsync("npm", ["run", "config:check-sample"], {
    cwd: projectRoot,
    maxBuffer: 16 * 1024 * 1024,
  });
  process.stdout.write(configCheck);

  console.log("");
  console.log("Step 2/2: Probe embedding candidates from baseline through fallback order.");

  const baselineConfig = await loadConfig();

  try {
    for (const candidate of OPEN_CLIP_MODEL_CANDIDATES) {
      const candidateConfig = applyOpenClipCandidateToConfig(baselineConfig, candidate);
      await saveConfig(candidateConfig);
      const payload = await runCapabilities();

      console.log("");
      console.log(`${candidate.preset}:`);
      console.log(`  ${summarizeProbe(payload)}`);
    }
  } finally {
    await saveConfig(baselineConfig);
  }
}

await main();
