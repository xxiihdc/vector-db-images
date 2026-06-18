import { runEmbeddingBenchmark } from "../../app/search/run-embedding-benchmark.js";
import { buildEmbeddingBenchmarkReportLines } from "../formatters/embedding-benchmark-report.js";

function parseCandidatePresets(rawValue) {
  return String(rawValue ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function readIntegerFlag(args, name) {
  const index = args.indexOf(name);

  if (index === -1) {
    return undefined;
  }

  const parsed = Number.parseInt(args[index + 1] ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function readStringFlag(args, name) {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1] ?? undefined;
}

export async function runEmbeddingBenchmarkCommand({
  cwd,
  args = [],
  runEmbeddingBenchmarkFn = runEmbeddingBenchmark,
} = {}) {
  const candidatePresets = parseCandidatePresets(readStringFlag(args, "--candidates"));
  const assetLimit = readIntegerFlag(args, "--asset-limit");
  const queryLimit = readIntegerFlag(args, "--query-limit");
  const timeoutSeconds = readIntegerFlag(args, "--timeout-seconds");
  const queryPackPath = readStringFlag(args, "--query-pack");
  const payload = await runEmbeddingBenchmarkFn({
    cwd,
    candidatePresets,
    assetLimit,
    queryLimit,
    timeoutSeconds,
    queryPackPath,
  });

  return {
    ...payload,
    command: "embedding benchmark",
    lines: buildEmbeddingBenchmarkReportLines(payload),
  };
}
