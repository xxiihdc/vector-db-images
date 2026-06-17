import path from "node:path";
import { ensureDir, writeJsonFile } from "./fs.js";

function buildTimestamp() {
  return new Date().toISOString().replaceAll(":", "-");
}

export async function writeDiagnosticLog({ cwd, category, payload }) {
  const logsDir = path.resolve(cwd, "logs");
  await ensureDir(logsDir);

  const logPath = path.resolve(logsDir, `${buildTimestamp()}-${category}.json`);
  await writeJsonFile(logPath, payload);

  return logPath;
}
