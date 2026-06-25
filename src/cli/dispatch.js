import { buildHelpText } from "./formatters/help.js";
import { runInitCommand } from "./commands/init.js";
import { runPhotosCheckCommand } from "./commands/photos-check.js";
import { runPhotosRequestAccessCommand } from "./commands/photos-request-access.js";
import { runPhotosScanCommand } from "./commands/photos-scan.js";
import { runPhotosDebugCommand } from "./commands/photos-debug.js";
import { runPhotosProbeOriginalsCommand } from "./commands/photos-probe-originals.js";
import { runPhotosExtractCommand } from "./commands/photos-extract.js";
import { runPhotosCapabilitiesCommand } from "./commands/photos-capabilities.js";
import { runEmbeddingCapabilitiesCommand } from "./commands/embedding-capabilities.js";
import { runEmbeddingBenchmarkCommand } from "./commands/embedding-benchmark.js";
import { runIndexCommand } from "./commands/index.js";
import { runReindexCommand } from "./commands/reindex.js";
import { runSearchCommand } from "./commands/search.js";
import { runServeCommand } from "./commands/serve.js";
import { runLaunchCommand } from "./commands/launch.js";
import { runStorageVectorCheckCommand } from "./commands/storage-vector-check.js";
import { runTelegramListenCommand } from "./commands/telegram-listen.js";
import { AppError } from "../shared/errors/app-error.js";

export async function dispatchCliCommand(argv, options = {}) {
  const { cwd, signal } = options;
  const [command, subcommand, ...rest] = argv;

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

  if (command === "serve") {
    return runServeCommand({ cwd, args: [subcommand, ...rest].filter(Boolean) });
  }

  if (command === "launch") {
    return runLaunchCommand({
      cwd,
      args: [subcommand, ...rest].filter(Boolean),
      signal,
    });
  }

  if (command === "telegram" && subcommand === "listen") {
    return runTelegramListenCommand({ cwd, args: rest, signal });
  }

  if (command === "storage" && subcommand === "vector-check") {
    return runStorageVectorCheckCommand({ cwd, args: rest });
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

  if (command === "embedding" && subcommand === "benchmark") {
    return runEmbeddingBenchmarkCommand({ cwd, args: rest });
  }

  throw new AppError("Unknown command.", {
    code: "CLI_UNKNOWN_COMMAND",
    details: { argv },
  });
}
