#!/usr/bin/env node

import { spawnSync } from "node:child_process";

const args = process.argv.slice(2);
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
    cwd: process.cwd(),
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
