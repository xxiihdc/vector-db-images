#!/usr/bin/env node

import { spawnSync } from "node:child_process";

function runCommand(command, args) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    cwd: process.cwd(),
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
    process.exitCode = result.status ?? 1;
    return false;
  }

  return true;
}

function main() {
  console.log("Step 1/2: Verify sample config is in sync.");
  const configCheckOk = runCommand("npm", ["run", "config:check-sample"]);
  if (!configCheckOk) {
    return;
  }

  console.log("");
  console.log("Step 2/2: Run focused semantic search core tests.");
  runCommand("node", [
    "--test",
    "--test-name-pattern",
    "embedding provider factory supports text query embedding|search service",
    "tests/storage-repositories.test.js",
  ]);
}

main();
