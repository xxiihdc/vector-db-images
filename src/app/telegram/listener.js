import path from "node:path";
import { loadConfig } from "../../config/load-config.js";
import { executeSearchWorkflow } from "../search/execute-search-workflow.js";
import { AppError } from "../../shared/errors/app-error.js";
import { resolveFrom } from "../../shared/utils/fs.js";
import { createTelegramBotClient } from "./client.js";
import { buildTelegramHelpReply, formatTelegramSearchReply } from "./formatters.js";
import { createTelegramOffsetStore } from "./offset-store.js";

export function normalizeTelegramChatId(value) {
  return String(value ?? "").trim();
}

export function parseTelegramInboundMessage(text) {
  const normalizedText = String(text ?? "").trim();

  if (!normalizedText) {
    return {
      type: "ignore",
      reason: "empty-text",
    };
  }

  const [rawCommand, ...rest] = normalizedText.split(/\s+/);
  const command = rawCommand.toLowerCase().replace(/@.+$/, "");
  const query = rest.join(" ").trim();

  if (command === "/start" || command === "/help") {
    return {
      type: "help",
    };
  }

  if (command === "/search") {
    if (!query) {
      return {
        type: "help",
        reason: "missing-query",
      };
    }

    return {
      type: "search",
      query,
    };
  }

  return {
    type: "search",
    query: normalizedText,
  };
}

function defaultLog(message) {
  console.log(message);
}

export function resolveTelegramRuntimeConfig({ cwd, config } = {}) {
  if (config?.telegram?.enabled !== true) {
    throw new AppError("Telegram integration is disabled in config.", {
      code: "TELEGRAM_DISABLED",
      details: {
        field: "telegram.enabled",
      },
    });
  }

  const botToken = String(config.telegram?.bot_token ?? "").trim();
  if (!botToken) {
    throw new AppError("Telegram bot token is required when Telegram is enabled.", {
      code: "TELEGRAM_BOT_TOKEN_REQUIRED",
      details: {
        field: "telegram.bot_token",
      },
    });
  }

  const allowedChatIds = Array.isArray(config.telegram?.allowed_chat_ids)
    ? config.telegram.allowed_chat_ids.map((value) => normalizeTelegramChatId(value)).filter(Boolean)
    : [];

  if (allowedChatIds.length === 0) {
    throw new AppError("Telegram allowed chat ids are required when Telegram is enabled.", {
      code: "TELEGRAM_ALLOWED_CHAT_IDS_REQUIRED",
      details: {
        field: "telegram.allowed_chat_ids",
      },
    });
  }

  const offsetStorePath = path.isAbsolute(String(config.telegram?.offset_store_path ?? ""))
    ? String(config.telegram.offset_store_path)
    : resolveFrom(cwd, String(config.telegram?.offset_store_path ?? ".data/telegram-offset.json"));

  return {
    botToken,
    allowedChatIds,
    pollTimeoutSeconds: config.telegram.poll_timeout_seconds,
    pollRetryDelayMs: config.telegram.poll_retry_delay_ms,
    replyResultLimit: config.telegram.reply_result_limit,
    offsetStorePath,
  };
}

export async function handleTelegramUpdate({
  update,
  cwd,
  allowedChatIds,
  replyResultLimit,
  executeSearchWorkflowFn = executeSearchWorkflow,
  telegramClient,
  onLog = defaultLog,
} = {}) {
  const message = update?.message ?? null;
  const chatId = normalizeTelegramChatId(message?.chat?.id);

  if (!message?.text) {
    onLog(`Skipping Telegram update ${update?.update_id ?? "unknown"}: non-text message.`);
    return { status: "skipped" };
  }

  if (!allowedChatIds.includes(chatId)) {
    onLog(`Rejected Telegram chat ${chatId}: not in allowlist.`);
    return { status: "rejected", chatId };
  }

  const parsed = parseTelegramInboundMessage(message.text);
  if (parsed.type === "ignore") {
    onLog(`Skipping Telegram update ${update?.update_id ?? "unknown"}: empty message.`);
    return { status: "skipped" };
  }

  if (parsed.type === "help") {
    await telegramClient.sendMessage({
      chatId,
      text: buildTelegramHelpReply(),
    });
    onLog(`Sent Telegram help reply to chat ${chatId}.`);
    return { status: "replied-help", chatId };
  }

  onLog(`Running Telegram search for chat ${chatId}: ${parsed.query}`);
  const result = await executeSearchWorkflowFn({
    cwd,
    query: parsed.query,
    skipAlbum: false,
  });
  await telegramClient.sendMessage({
    chatId,
    text: formatTelegramSearchReply({
      query: parsed.query,
      result,
      replyResultLimit,
    }),
  });
  onLog(`Sent Telegram search reply to chat ${chatId}: ${result.result_count} result(s).`);
  return {
    status: "replied-search",
    chatId,
    resultCount: result.result_count,
  };
}

export async function sleepWithSignal(milliseconds, signal) {
  if (signal?.aborted) {
    return;
  }

  await new Promise((resolve) => {
    const timeoutId = setTimeout(resolve, milliseconds);

    if (signal) {
      signal.addEventListener(
        "abort",
        () => {
          clearTimeout(timeoutId);
          resolve();
        },
        { once: true }
      );
    }
  });
}

export async function runTelegramLongPollListener({
  cwd,
  loadConfigFn = loadConfig,
  executeSearchWorkflowFn = executeSearchWorkflow,
  createTelegramClientFn = createTelegramBotClient,
  createOffsetStoreFn = createTelegramOffsetStore,
  sleepFn = sleepWithSignal,
  signal,
  onLog = defaultLog,
} = {}) {
  const configState = await loadConfigFn(cwd);
  const runtimeConfig = resolveTelegramRuntimeConfig({
    cwd,
    config: configState.config,
  });
  const telegramClient = createTelegramClientFn({
    botToken: runtimeConfig.botToken,
  });
  const offsetStore = createOffsetStoreFn({
    offsetStorePath: runtimeConfig.offsetStorePath,
  });

  let nextUpdateOffset = await offsetStore.readOffset();
  let processedUpdateCount = 0;
  onLog(
    `Telegram listener started. Allowed chats=${runtimeConfig.allowedChatIds.join(", ")} offset_store=${runtimeConfig.offsetStorePath}`
  );

  while (!signal?.aborted) {
    onLog(
      `Polling Telegram updates with offset=${nextUpdateOffset ?? "none"} timeout=${runtimeConfig.pollTimeoutSeconds}s`
    );

    let updates = [];
    try {
      updates = await telegramClient.getUpdates({
        offset: nextUpdateOffset,
        timeoutSeconds: runtimeConfig.pollTimeoutSeconds,
      });
    } catch (error) {
      onLog(
        `Telegram polling error: ${error?.message ?? "Unknown error"}. Retrying in ${runtimeConfig.pollRetryDelayMs}ms.`
      );
      await sleepFn(runtimeConfig.pollRetryDelayMs, signal);
      continue;
    }

    for (const update of updates) {
      if (signal?.aborted) {
        break;
      }

      try {
        await handleTelegramUpdate({
          update,
          cwd,
          allowedChatIds: runtimeConfig.allowedChatIds,
          replyResultLimit: runtimeConfig.replyResultLimit,
          executeSearchWorkflowFn,
          telegramClient,
          onLog,
        });
        nextUpdateOffset = Number(update.update_id) + 1;
        await offsetStore.writeOffset(nextUpdateOffset);
        processedUpdateCount += 1;
      } catch (error) {
        onLog(
          `Telegram update ${update?.update_id ?? "unknown"} failed: ${error?.message ?? "Unknown error"}`
        );
      }
    }
  }

  onLog("Telegram listener stopped.");
  return {
    implemented: true,
    phase: "telegram",
    command: "telegram listen",
    status: "stopped",
    summary: "Telegram long-poll listener stopped.",
    config_path: configState.configPath,
    config_exists: configState.exists,
    offset_store_path: runtimeConfig.offsetStorePath,
    allowed_chat_ids: runtimeConfig.allowedChatIds,
    processed_update_count: processedUpdateCount,
    next_update_offset: nextUpdateOffset,
    lines: [
      `Config present: ${configState.exists ? "yes" : "no"}`,
      `Allowed chats: ${runtimeConfig.allowedChatIds.join(", ")}`,
      `Offset store: ${runtimeConfig.offsetStorePath}`,
      `Processed updates: ${processedUpdateCount}`,
      `Next update offset: ${nextUpdateOffset ?? "none"}`,
    ],
  };
}
