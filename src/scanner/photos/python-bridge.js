import { spawnSync } from "node:child_process";
import path from "node:path";
import { AppError } from "../../shared/errors/app-error.js";

export function runPythonPhotosBridge(command, options = {}) {
  const pythonExecutable = process.env.MVI_PYTHON_BIN || "python3";
  const scriptPath = path.resolve(process.cwd(), "python/photos_bridge/bridge.py");
  const result = spawnSync(pythonExecutable, [scriptPath, command, "--json"], {
    cwd: process.cwd(),
    encoding: "utf8",
  });

  if (result.error) {
    throw new AppError("Failed to launch python photos bridge.", {
      code: "PYTHON_BRIDGE_EXEC_FAILED",
      details: { command, python_executable: pythonExecutable, cause: result.error.message },
      cause: result.error,
    });
  }

  if (result.status !== 0) {
    throw new AppError("Python photos bridge returned a non-zero exit code.", {
      code: "PYTHON_BRIDGE_NON_ZERO",
      details: {
        command,
        python_executable: pythonExecutable,
        status: result.status,
        stderr: result.stderr.trim() || null,
      },
    });
  }

  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    throw new AppError("Python photos bridge returned invalid JSON.", {
      code: "PYTHON_BRIDGE_INVALID_JSON",
      details: {
        command,
        python_executable: pythonExecutable,
        stdout: result.stdout.trim(),
      },
      cause: error,
    });
  }
}
