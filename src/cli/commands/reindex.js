import { runIndexLikeCommand } from "./index-command-base.js";

export async function runReindexCommand({ cwd, args = [] }) {
  return runIndexLikeCommand({
    cwd,
    args,
    defaultUseCache: false,
    summary: "Re-index refresh completed for the active model identity.",
    commandLabel: "reindex",
  });
}
