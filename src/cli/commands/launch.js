import { AppError } from "../../shared/errors/app-error.js";
import {
  DEFAULT_SERVER_HOST,
  DEFAULT_SERVER_PORT,
  startSearchWebServer,
} from "../../server/search-web-server.js";
import { runTelegramLongPollListener } from "../../app/telegram/listener.js";

function parseLaunchArgs(args = []) {
  let port = DEFAULT_SERVER_PORT;
  let webSelected = false;
  let teleSelected = false;

  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];

    if (value === "--web") {
      webSelected = true;
      continue;
    }

    if (value === "--tele") {
      teleSelected = true;
      continue;
    }

    if (value === "--port") {
      const raw = args[index + 1] ?? "";
      const parsed = Number.parseInt(raw, 10);

      if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
        throw new AppError("Launch port must be an integer between 1 and 65535.", {
          code: "WRAPPER_PORT_INVALID",
          details: {
            port: raw,
          },
        });
      }

      port = parsed;
      index += 1;
    }
  }

  const hasExplicitSelection = webSelected || teleSelected;

  return {
    port,
    enableWeb: hasExplicitSelection ? webSelected : true,
    enableTele: hasExplicitSelection ? teleSelected : true,
  };
}

function waitForAbort(signal) {
  if (signal?.aborted) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    signal?.addEventListener("abort", resolve, { once: true });
  });
}

async function closeServer(server) {
  if (!server?.listening) {
    return;
  }

  await new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

export async function runLaunchCommand({
  cwd,
  args = [],
  signal,
  startSearchWebServerFn = startSearchWebServer,
  runTelegramLongPollListenerFn = runTelegramLongPollListener,
} = {}) {
  const options = parseLaunchArgs(args);
  let webState = null;

  try {
    if (options.enableWeb) {
      webState = await startSearchWebServerFn({
        cwd,
        host: DEFAULT_SERVER_HOST,
        port: options.port,
      });
    }

    const telegramPromise = options.enableTele
      ? runTelegramLongPollListenerFn({
          cwd,
          signal,
        })
      : Promise.resolve(null);

    await Promise.all([waitForAbort(signal), telegramPromise]);
    const telegramResult = await telegramPromise;

    return {
      implemented: true,
      phase: "wrapper",
      command: "launch",
      status: "stopped",
      summary: "Wrapper services stopped.",
      enabled_surfaces: {
        web: options.enableWeb,
        tele: options.enableTele,
      },
      host: webState?.address?.host ?? null,
      port: webState?.address?.port ?? null,
      url: webState?.address?.url ?? null,
      telegram: telegramResult,
      lines: [
        `Web enabled: ${options.enableWeb ? "yes" : "no"}`,
        `Tele enabled: ${options.enableTele ? "yes" : "no"}`,
        ...(webState?.address
          ? [
              `Web URL: ${webState.address.url}`,
              `Web host: ${webState.address.host}`,
              `Web port: ${webState.address.port}`,
            ]
          : []),
        ...(telegramResult
          ? [`Telegram processed updates: ${telegramResult.processed_update_count}`]
          : []),
      ],
    };
  } finally {
    await closeServer(webState?.server);
  }
}
