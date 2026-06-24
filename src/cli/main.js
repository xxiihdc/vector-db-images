#!/usr/bin/env node

import { cwd as getCwd } from "node:process";
import { hasJsonFlag, printOutput } from "./formatters/output.js";
import { dispatchCliCommand } from "./dispatch.js";
import { loadProjectEnv } from "../shared/utils/project-env.js";
import { resolveProjectRoot } from "../shared/utils/project-paths.js";
import {
  AppError,
  toDiagnosticErrorPayload,
  toErrorPayload,
} from "../shared/errors/app-error.js";
import { writeDiagnosticLog } from "../shared/utils/diagnostics.js";

async function main() {
  const argv = process.argv.slice(2);
  const json = hasJsonFlag(argv);
  loadProjectEnv({ cwd: getCwd() });
  const cwd = resolveProjectRoot(getCwd());
  const abortController = new AbortController();
  const stop = () => abortController.abort();

  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  try {
    const payload = await dispatchCliCommand(argv.filter((arg) => arg !== "--json"), {
      cwd,
      signal: abortController.signal,
    });
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
  } finally {
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
  }
}

await main();
