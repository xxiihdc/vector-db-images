import { spawn } from "node:child_process";
import path from "node:path";
import { AppError } from "../../shared/errors/app-error.js";
import { loadProjectEnv } from "../../shared/utils/project-env.js";
import { resolveProjectRoot } from "../../shared/utils/project-paths.js";

const PYTHON_BRIDGE_MAX_BUFFER_BYTES = 128 * 1024 * 1024;

function streamBridgeStderr(command, chunk) {
  const text = String(chunk ?? "");
  if (!text) {
    return;
  }

  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    if (!line.trim()) {
      continue;
    }

    process.stderr.write(`[photos-bridge:${command}] ${line}\n`);
  }
}

export async function runPythonPhotosBridge(command, options = {}) {
  loadProjectEnv();
  const pythonExecutable = process.env.MVI_PYTHON_BIN || "python3";
  const projectRoot = resolveProjectRoot();
  const scriptPath = path.resolve(projectRoot, "python/photos_bridge/bridge.py");
  const args = [scriptPath, command, "--json", ...(options.args ?? [])];

  return new Promise((resolve, reject) => {
    const child = spawn(pythonExecutable, args, {
      cwd: projectRoot,
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let stdoutBytes = 0;
    let stderrBytes = 0;

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");

    child.stdout.on("data", (chunk) => {
      stdoutBytes += Buffer.byteLength(chunk, "utf8");
      if (stdoutBytes > PYTHON_BRIDGE_MAX_BUFFER_BYTES) {
        child.kill("SIGTERM");
        return;
      }

      stdout += chunk;
    });

    child.stderr.on("data", (chunk) => {
      stderrBytes += Buffer.byteLength(chunk, "utf8");
      if (stderrBytes > PYTHON_BRIDGE_MAX_BUFFER_BYTES) {
        child.kill("SIGTERM");
        return;
      }

      stderr += chunk;
      streamBridgeStderr(command, chunk);
    });

    child.on("error", (error) => {
      reject(
        new AppError("Failed to launch python photos bridge.", {
          code: "PYTHON_BRIDGE_EXEC_FAILED",
          details: {
            command,
            python_executable: pythonExecutable,
            cause: error.message,
          },
          cause: error,
        })
      );
    });

    child.on("close", (status, signal) => {
      if (stdoutBytes > PYTHON_BRIDGE_MAX_BUFFER_BYTES || stderrBytes > PYTHON_BRIDGE_MAX_BUFFER_BYTES) {
        reject(
          new AppError("Python photos bridge exceeded output buffer limits.", {
            code: "PYTHON_BRIDGE_OUTPUT_TOO_LARGE",
            details: {
              command,
              python_executable: pythonExecutable,
              status,
              signal,
              stdout_bytes: stdoutBytes,
              stderr_bytes: stderrBytes,
            },
          })
        );
        return;
      }

      if (status !== 0) {
        reject(
          new AppError("Python photos bridge returned a non-zero exit code.", {
            code: "PYTHON_BRIDGE_NON_ZERO",
            details: {
              command,
              python_executable: pythonExecutable,
              status,
              signal,
              stdout: stdout.trim() || null,
              stderr: stderr.trim() || null,
            },
          })
        );
        return;
      }

      try {
        resolve(JSON.parse(stdout));
      } catch (error) {
        reject(
          new AppError("Python photos bridge returned invalid JSON.", {
            code: "PYTHON_BRIDGE_INVALID_JSON",
            details: {
              command,
              python_executable: pythonExecutable,
              stdout: stdout.trim(),
              stderr: stderr.trim() || null,
            },
            cause: error,
          })
        );
      }
    });

    if (options.input) {
      child.stdin.write(options.input);
    }
    child.stdin.end();
  });
}
