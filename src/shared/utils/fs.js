import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export async function pathExists(targetPath) {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

export async function ensureDir(targetPath) {
  await mkdir(targetPath, { recursive: true });
}

export async function readJsonFile(targetPath) {
  const raw = await readFile(targetPath, "utf8");
  return JSON.parse(raw);
}

export async function writeJsonFile(targetPath, data) {
  const serialized = `${JSON.stringify(data, null, 2)}\n`;
  await writeFile(targetPath, serialized, "utf8");
}

export async function touchFile(targetPath) {
  await writeFile(targetPath, "", { flag: "a" });
}

export function resolveFrom(baseDir, ...segments) {
  return path.resolve(baseDir, ...segments);
}
