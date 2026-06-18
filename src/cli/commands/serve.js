import { AppError } from "../../shared/errors/app-error.js";
import {
  DEFAULT_SERVER_HOST,
  DEFAULT_SERVER_PORT,
  startSearchWebServer,
} from "../../server/search-web-server.js";

function parseServeArgs(args = []) {
  let port = DEFAULT_SERVER_PORT;

  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];

    if (value === "--port") {
      const raw = args[index + 1] ?? "";
      const parsed = Number.parseInt(raw, 10);

      if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
        throw new AppError("Serve port must be an integer between 1 and 65535.", {
          code: "SERVER_PORT_INVALID",
          details: {
            port: raw,
          },
        });
      }

      port = parsed;
      index += 1;
    }
  }

  return { port };
}

export async function runServeCommand({
  cwd,
  args = [],
  startSearchWebServerFn = startSearchWebServer,
} = {}) {
  const { port } = parseServeArgs(args);
  const { address } = await startSearchWebServerFn({
    cwd,
    host: DEFAULT_SERVER_HOST,
    port,
  });

  return {
    implemented: true,
    phase: "search",
    command: "serve",
    status: "listening",
    summary: "Local search webserver is running.",
    host: address.host,
    port: address.port,
    url: address.url,
    lines: [
      `Host: ${address.host}`,
      `Port: ${address.port}`,
      `URL: ${address.url}`,
      "Open the page in a browser, run search there, and review results in Apple Photos.",
    ],
  };
}
