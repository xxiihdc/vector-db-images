import { initializeProjectScaffold } from "../../config/load-config.js";

export async function runInitCommand({ cwd, args }) {
  const force = args.includes("--force");
  const result = await initializeProjectScaffold(cwd, { force });

  if (!result.created) {
    return {
      summary: "Scaffold already initialized.",
      lines: [
        `Config already exists at ${result.configPath}.`,
        "Use `mvi init --force` to rewrite the default config.",
      ],
    };
  }

  return {
    summary: "Scaffold initialized.",
    lines: [
      `Config: ${result.configPath}`,
      `Storage root: ${result.storageRoot}`,
      `Catalog placeholder: ${result.catalogDbPath}`,
      `Vector placeholder: ${result.vectorDbPath}`,
    ],
  };
}
