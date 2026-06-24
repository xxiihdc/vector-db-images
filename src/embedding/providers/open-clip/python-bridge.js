import { spawnSync } from "node:child_process";
import path from "node:path";
import { AppError } from "../../../shared/errors/app-error.js";
import { loadProjectEnv } from "../../../shared/utils/project-env.js";
import { resolveProjectRoot } from "../../../shared/utils/project-paths.js";

const PYTHON_BRIDGE_MAX_BUFFER_BYTES = 128 * 1024 * 1024;

function getScriptPath() {
  return path.resolve(resolveProjectRoot(), "python/embedding_bridge/bridge.py");
}

function getPythonExecutable() {
  return process.env.MVI_PYTHON_BIN || "python3";
}

export function runOpenClipEmbeddingBridge(command, input = {}) {
  loadProjectEnv();
  const pythonExecutable = getPythonExecutable();
  const scriptPath = getScriptPath();
  const projectRoot = resolveProjectRoot();
  const result = spawnSync(pythonExecutable, [scriptPath, command, "--json"], {
    cwd: projectRoot,
    encoding: "utf8",
    input: JSON.stringify(input),
    maxBuffer: PYTHON_BRIDGE_MAX_BUFFER_BYTES,
  });

  if (result.error) {
    throw new AppError("Failed to launch embedding bridge.", {
      code: "EMBEDDING_BRIDGE_EXEC_FAILED",
      details: {
        command,
        python_executable: pythonExecutable,
        cause: result.error.message,
      },
      cause: result.error,
    });
  }

  if (result.status !== 0) {
    throw new AppError("Embedding bridge returned a non-zero exit code.", {
      code: "EMBEDDING_BRIDGE_NON_ZERO",
      details: {
        command,
        python_executable: pythonExecutable,
        status: result.status,
        stdout: result.stdout.trim() || null,
        stderr: result.stderr.trim() || null,
      },
    });
  }

  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    throw new AppError("Embedding bridge returned invalid JSON.", {
      code: "EMBEDDING_BRIDGE_INVALID_JSON",
      details: {
        command,
        python_executable: pythonExecutable,
        stdout: result.stdout.trim() || null,
        stderr: result.stderr.trim() || null,
      },
      cause: error,
    });
  }
}
