import path from "node:path";
import {
  ensureDir,
  pathExists,
  readJsonFile,
  writeJsonFile,
} from "../../shared/utils/fs.js";

export function createTelegramOffsetStore({
  offsetStorePath,
} = {}) {
  return {
    async readOffset() {
      if (!(await pathExists(offsetStorePath))) {
        return null;
      }

      const payload = await readJsonFile(offsetStorePath);
      return Number.isSafeInteger(payload?.next_update_offset)
        ? payload.next_update_offset
        : null;
    },
    async writeOffset(nextUpdateOffset) {
      await ensureDir(path.dirname(offsetStorePath));
      await writeJsonFile(offsetStorePath, {
        next_update_offset: nextUpdateOffset,
      });
    },
  };
}
