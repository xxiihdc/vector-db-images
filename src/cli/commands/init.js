import { initializeProjectScaffold } from "../../config/load-config.js";
import { formatStorageSummaryLines } from "../../storage/storage-layout.js";

export async function runInitCommand({ cwd, args }) {
  const force = args.includes("--force");
  const result = await initializeProjectScaffold(cwd, { force });
  const storageLines = formatStorageSummaryLines(result);

  if (!result.created) {
    return {
      summary: "Scaffold already initialized.",
      lines: [
        `Config already exists at ${result.configPath}.`,
        ...storageLines,
        result.vectorInfo?.reachable === false
          ? `Vector backend status: unreachable (${result.vectorInfo?.error?.message ?? "Unknown error"})`
          : `Vector backend status: reachable`,
        "Use `mvi init --force` to rewrite the default config.",
      ],
    };
  }

  const vectorStatusLine =
    result.vectorInfo?.reachable === false
      ? `Vector backend status: unreachable (${result.vectorInfo?.error?.message ?? "Unknown error"})`
      : `Vector backend status: reachable`;

  return {
    summary: "Scaffold initialized.",
    lines: [
      `Config: ${result.configPath}`,
      ...storageLines,
      vectorStatusLine,
    ],
  };
}
