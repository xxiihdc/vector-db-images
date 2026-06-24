#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { loadProjectEnv } from "../src/shared/utils/project-env.js";
import { resolveProjectRoot } from "../src/shared/utils/project-paths.js";

const args = process.argv.slice(2);
loadProjectEnv();
const projectRoot = resolveProjectRoot();
const result = spawnSync(
  "node",
  [
    "./src/cli/main.js",
    "embedding",
    "benchmark",
    "--asset-limit",
    "5",
    "--query-limit",
    "2",
    ...args,
    "--json",
  ],
  {
    cwd: projectRoot,
    encoding: "utf8",
  }
);

if (result.stdout) {
  process.stdout.write(result.stdout);
}

if (result.stderr) {
  process.stderr.write(result.stderr);
}

process.exit(result.status ?? 1);
