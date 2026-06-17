#!/usr/bin/env node

import { cwd as getCwd } from "node:process";
import { buildHelpText } from "./formatters/help.js";
import { hasJsonFlag, printOutput } from "./formatters/output.js";
import { runInitCommand } from "./commands/init.js";
import { runPhotosCheckCommand } from "./commands/photos-check.js";
import { runPhotosScanCommand } from "./commands/photos-scan.js";
import { runPhotosDebugCommand } from "./commands/photos-debug.js";
import { AppError, toErrorPayload } from "../shared/errors/app-error.js";

async function dispatch(argv) {
  const [command, subcommand, ...rest] = argv;
  const cwd = getCwd();

  if (!command || command === "help" || command === "--help") {
    return buildHelpText();
  }

  if (command === "init") {
    return runInitCommand({ cwd, args: [subcommand, ...rest].filter(Boolean) });
  }

  if (command === "photos" && subcommand === "check") {
    return runPhotosCheckCommand({ cwd, args: rest });
  }

  if (command === "photos" && subcommand === "scan") {
    return runPhotosScanCommand({ cwd, args: rest });
  }

  if (command === "photos" && subcommand === "debug") {
    return runPhotosDebugCommand({ cwd, args: rest });
  }

  throw new AppError("Unknown command.", {
    code: "CLI_UNKNOWN_COMMAND",
    details: { argv },
  });
}

async function main() {
  const argv = process.argv.slice(2);
  const json = hasJsonFlag(argv);

  try {
    const payload = await dispatch(argv.filter((arg) => arg !== "--json"));
    printOutput(payload, { json });
  } catch (error) {
    const payload = toErrorPayload(error);
    printOutput(payload, { json: true });
    process.exitCode = 1;
  }
}

await main();
