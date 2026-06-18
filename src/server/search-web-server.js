import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { loadConfig } from "../config/load-config.js";
import { executeSearchWorkflow } from "../app/search/execute-search-workflow.js";
import {
  toDiagnosticErrorPayload,
  toErrorPayload,
} from "../shared/errors/app-error.js";
import { writeDiagnosticLog } from "../shared/utils/diagnostics.js";

export const DEFAULT_SERVER_HOST = "127.0.0.1";
export const DEFAULT_SERVER_PORT = 4173;

const MAX_REQUEST_BYTES = 1024 * 1024;

async function loadAsset(relativePath) {
  return readFile(new URL(relativePath, import.meta.url), "utf8");
}

function sendText(response, statusCode, body, contentType) {
  response.writeHead(statusCode, {
    "Content-Type": contentType,
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
  });
  response.end(body);
}

function sendJson(response, statusCode, payload) {
  sendText(
    response,
    statusCode,
    JSON.stringify(payload, null, 2),
    "application/json; charset=utf-8"
  );
}

function resolveLimit(rawLimit) {
  if (rawLimit === undefined || rawLimit === null || rawLimit === "") {
    return undefined;
  }

  if (!Number.isFinite(rawLimit) || rawLimit <= 0) {
    return null;
  }

  return Math.trunc(rawLimit);
}

async function readJsonBody(request) {
  const chunks = [];
  let totalBytes = 0;

  for await (const chunk of request) {
    totalBytes += chunk.length;
    if (totalBytes > MAX_REQUEST_BYTES) {
      const error = new Error("Request body too large.");
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }

  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) {
    return {};
  }

  try {
    return JSON.parse(raw);
  } catch {
    const error = new Error("Request body must be valid JSON.");
    error.statusCode = 400;
    throw error;
  }
}

function getErrorStatusCode(error) {
  if (Number.isInteger(error?.statusCode)) {
    return error.statusCode;
  }

  if (
    error?.code === "SEARCH_QUERY_REQUIRED" ||
    error?.code === "SEARCH_LIMIT_INVALID"
  ) {
    return 400;
  }

  return 500;
}

async function buildIndexHtml({ cwd, loadConfigFn }) {
  const template = await loadAsset("./static/index.html");
  const configState = await loadConfigFn(cwd);
  const bootstrap = JSON.stringify({
    defaultLimit: configState.config?.retriever?.default_limit ?? 50,
    albumName: configState.config?.app?.results_album_name ?? "AI Search Results",
  });

  return template.replace("__MVI_BOOTSTRAP__", bootstrap);
}

async function handleSearchApi({
  request,
  response,
  cwd,
  executeSearchFn,
  writeDiagnosticLogFn,
}) {
  try {
    const body = await readJsonBody(request);
    const query = String(body?.query ?? "").trim();

    if (!query) {
      sendJson(response, 400, {
        name: "AppError",
        code: "SEARCH_QUERY_REQUIRED",
        message: "Search query must not be empty.",
        details: null,
      });
      return;
    }

    const limit = resolveLimit(body?.limit);
    if (body?.limit !== undefined && limit === null) {
      sendJson(response, 400, {
        name: "AppError",
        code: "SEARCH_LIMIT_INVALID",
        message: "Search limit must be a positive integer.",
        details: {
          limit: body?.limit,
        },
      });
      return;
    }

    const payload = await executeSearchFn({
      cwd,
      query,
      limit,
    });
    sendJson(response, 200, payload);
  } catch (error) {
    let diagnosticLogPath = null;

    try {
      diagnosticLogPath = await writeDiagnosticLogFn({
        cwd,
        category: "web-error",
        payload: {
          timestamp: new Date().toISOString(),
          route: "/api/search",
          error: toDiagnosticErrorPayload(error),
        },
      });
    } catch {
      diagnosticLogPath = null;
    }

    const payload = toErrorPayload(error);
    if (diagnosticLogPath) {
      payload.details = {
        ...(payload.details ?? {}),
        diagnostic_log_path: diagnosticLogPath,
      };
    }
    sendJson(response, getErrorStatusCode(error), payload);
  }
}

export function createSearchWebServer({
  cwd,
  executeSearchFn = executeSearchWorkflow,
  loadConfigFn = loadConfig,
  writeDiagnosticLogFn = writeDiagnosticLog,
} = {}) {
  return createServer((request, response) => {
    void (async () => {
      try {
        const url = new URL(request.url ?? "/", "http://127.0.0.1");

        if (request.method === "GET" && url.pathname === "/") {
          const html = await buildIndexHtml({ cwd, loadConfigFn });
          sendText(response, 200, html, "text/html; charset=utf-8");
          return;
        }

        if (request.method === "GET" && url.pathname === "/assets/app.css") {
          const css = await loadAsset("./static/app.css");
          sendText(response, 200, css, "text/css; charset=utf-8");
          return;
        }

        if (request.method === "GET" && url.pathname === "/assets/app.js") {
          const js = await loadAsset("./static/app.js");
          sendText(response, 200, js, "application/javascript; charset=utf-8");
          return;
        }

        if (request.method === "GET" && url.pathname === "/api/health") {
          const configState = await loadConfigFn(cwd);
          sendJson(response, 200, {
            status: "ok",
            default_limit: configState.config?.retriever?.default_limit ?? 50,
            album_name:
              configState.config?.app?.results_album_name ?? "AI Search Results",
          });
          return;
        }

        if (request.method === "POST" && url.pathname === "/api/search") {
          await handleSearchApi({
            request,
            response,
            cwd,
            executeSearchFn,
            writeDiagnosticLogFn,
          });
          return;
        }

        sendJson(response, 404, {
          name: "AppError",
          code: "HTTP_NOT_FOUND",
          message: "Route not found.",
          details: {
            method: request.method,
            path: url.pathname,
          },
        });
      } catch (error) {
        if (!response.headersSent) {
          sendJson(response, 500, {
            ...toErrorPayload(error),
          });
        } else {
          response.destroy(error);
        }
      }
    })();
  });
}

export async function startSearchWebServer({
  cwd,
  host = DEFAULT_SERVER_HOST,
  port = DEFAULT_SERVER_PORT,
  createSearchWebServerFn = createSearchWebServer,
} = {}) {
  const server = createSearchWebServerFn({ cwd });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve();
    });
  });

  const addressInfo = server.address();
  const resolvedHost =
    typeof addressInfo === "object" && addressInfo ? addressInfo.address : host;
  const resolvedPort =
    typeof addressInfo === "object" && addressInfo ? addressInfo.port : port;

  return {
    server,
    address: {
      host: resolvedHost,
      port: resolvedPort,
      url: `http://${resolvedHost}:${resolvedPort}`,
    },
  };
}
