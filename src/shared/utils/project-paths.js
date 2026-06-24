import path from "node:path";

export const PROJECT_ROOT_ENV_VAR = "MVI_PROJECT_ROOT";

export function resolveProjectRoot(cwd = process.cwd()) {
  const envValue = String(process.env[PROJECT_ROOT_ENV_VAR] ?? "").trim();
  if (envValue) {
    return path.resolve(envValue);
  }

  return path.resolve(cwd);
}

export function resolveProjectPath(...segments) {
  return path.resolve(resolveProjectRoot(), ...segments);
}

export function resolveProjectPathFrom(cwd, ...segments) {
  return path.resolve(resolveProjectRoot(cwd), ...segments);
}
