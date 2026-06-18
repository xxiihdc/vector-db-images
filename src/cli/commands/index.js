import { runIndexLikeCommand } from "./index-command-base.js";
import { runIndexFileCommand } from "./index-file.js";

export async function runIndexCommand({ cwd, args = [] }) {
  if (args[0] === "file") {
    return runIndexFileCommand({
      cwd,
      args: args.slice(1),
    });
  }

  return runIndexLikeCommand({
    cwd,
    args,
    defaultUseCache: true,
    summary: "Index pipeline completed with explicit active model identity.",
    commandLabel: "index",
  });
}
