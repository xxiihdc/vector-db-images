#!/usr/bin/env node

import { cwd as getCwd } from "node:process";
import { buildHelpText } from "./formatters/help.js";
import { hasJsonFlag, printOutput } from "./formatters/output.js";
import { runInitCommand } from "./commands/init.js";
import { runPhotosCheckCommand } from "./commands/photos-check.js";
import { runPhotosRequestAccessCommand } from "./commands/photos-request-access.js";
import { runPhotosScanCommand } from "./commands/photos-scan.js";
import { runPhotosDebugCommand } from "./commands/photos-debug.js";
import { runPhotosProbeOriginalsCommand } from "./commands/photos-probe-originals.js";
import { runPhotosExtractCommand } from "./commands/photos-extract.js";
import { runPhotosCapabilitiesCommand } from "./commands/photos-capabilities.js";
import { runEmbeddingCapabilitiesCommand } from "./commands/embedding-capabilities.js";
import { runIndexCommand } from "./commands/index.js";
import { runReindexCommand } from "./commands/reindex.js";
import { runSearchCommand } from "./commands/search.js";
import {
  AppError,
  toDiagnosticErrorPayload,
  toErrorPayload,
} from "../shared/errors/app-error.js";
import { writeDiagnosticLog } from "../shared/utils/diagnostics.js";

async function dispatch(argv) {
  const [command, subcommand, ...rest] = argv;
  const cwd = getCwd();

  if (!command || command === "help" || command === "--help") {
    return buildHelpText();
  }

  if (command === "init") {
    return runInitCommand({ cwd, args: [subcommand, ...rest].filter(Boolean) });
  }

  if (command === "index") {
    return runIndexCommand({ cwd, args: [subcommand, ...rest].filter(Boolean) });
  }

  if (command === "reindex") {
    return runReindexCommand({ cwd, args: [subcommand, ...rest].filter(Boolean) });
  }

  if (command === "search") {
    return runSearchCommand({ cwd, args: [subcommand, ...rest].filter(Boolean) });
  }

  if (command === "photos" && subcommand === "check") {
    return runPhotosCheckCommand({ cwd, args: rest });
  }

  if (command === "photos" && subcommand === "request-access") {
    return runPhotosRequestAccessCommand({ cwd, args: rest });
  }

  if (command === "photos" && subcommand === "scan") {
    return runPhotosScanCommand({ cwd, args: rest });
  }

  if (command === "photos" && subcommand === "debug") {
    return runPhotosDebugCommand({ cwd, args: rest });
  }

  if (command === "photos" && subcommand === "capabilities") {
    return runPhotosCapabilitiesCommand({ cwd, args: rest });
  }

  if (command === "photos" && subcommand === "probe-originals") {
    return runPhotosProbeOriginalsCommand({ cwd, args: rest });
  }

  if (command === "photos" && subcommand === "extract") {
    return runPhotosExtractCommand({ cwd, args: rest });
  }

  if (command === "embedding" && subcommand === "capabilities") {
    return runEmbeddingCapabilitiesCommand({ cwd, args: rest });
  }

  throw new AppError("Unknown command.", {
    code: "CLI_UNKNOWN_COMMAND",
    details: { argv },
  });
}

async function main() {
  const argv = process.argv.slice(2);
  const json = hasJsonFlag(argv);
  const cwd = getCwd();

  try {
    const payload = await dispatch(argv.filter((arg) => arg !== "--json"));
    printOutput(payload, { json });
  } catch (error) {
    let diagnosticLogPath = null;

    try {
      diagnosticLogPath = await writeDiagnosticLog({
        cwd,
        category: "cli-error",
        payload: {
          timestamp: new Date().toISOString(),
          argv,
          error: toDiagnosticErrorPayload(error),
        },
      });
    } catch (diagnosticError) {
      diagnosticLogPath = null;
      console.error(
        `Failed to write diagnostic log: ${diagnosticError?.message ?? "Unknown error"}`
      );
    }

    const payload = toErrorPayload(error);
    if (diagnosticLogPath) {
      payload.details = {
        ...(payload.details ?? {}),
        diagnostic_log_path: diagnosticLogPath,
      };
    }
    printOutput(payload, { json: true });
    process.exitCode = 1;
  }
}

await main();
