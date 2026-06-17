import { runIndexLikeCommand } from "./index-command-base.js";

export async function runIndexCommand({ cwd, args = [] }) {
  return runIndexLikeCommand({
    cwd,
    args,
    defaultUseCache: true,
    summary: "Minimum index pipeline completed.",
    commandLabel: "index",
  });
}
