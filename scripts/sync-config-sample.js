#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import process from "node:process";
import {
  DEFAULT_CONFIG,
  DEFAULT_CONFIG_FILE_NAME,
} from "../src/config/defaults/config.js";
import { writeJsonFile } from "../src/shared/utils/fs.js";

const checkOnly = process.argv.includes("--check");

async function main() {
  const samplePath = new URL(`../${DEFAULT_CONFIG_FILE_NAME}`, import.meta.url);
  const current = JSON.parse(await readFile(samplePath, "utf8"));
  const expected = DEFAULT_CONFIG;
  const currentText = `${JSON.stringify(current, null, 2)}\n`;
  const expectedText = `${JSON.stringify(expected, null, 2)}\n`;

  if (currentText === expectedText) {
    console.log(`Config sample is in sync: ${DEFAULT_CONFIG_FILE_NAME}`);
    return;
  }

  if (checkOnly) {
    console.error(
      `Config sample is out of sync. Run \`npm run config:sync-sample\` to rewrite ${DEFAULT_CONFIG_FILE_NAME}.`
    );
    process.exitCode = 1;
    return;
  }

  await writeJsonFile(samplePath, expected);
  console.log(`Updated config sample: ${DEFAULT_CONFIG_FILE_NAME}`);
}

await main();
