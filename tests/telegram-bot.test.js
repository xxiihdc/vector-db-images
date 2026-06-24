import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { DEFAULT_CONFIG } from "../src/config/defaults/config.js";
import { validateConfig } from "../src/config/schema/config-schema.js";
import { dispatchCliCommand } from "../src/cli/dispatch.js";
import { buildTelegramHelpReply, formatTelegramSearchReply } from "../src/app/telegram/formatters.js";
import {
  handleTelegramUpdate,
  parseTelegramInboundMessage,
  resolveTelegramRuntimeConfig,
  runTelegramLongPollListener,
} from "../src/app/telegram/listener.js";
import { createTelegramOffsetStore } from "../src/app/telegram/offset-store.js";

async function withTempDir(callback) {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "mvi-telegram-test-"));

  try {
    await callback(tempDir);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

test("CLI dispatch routes telegram listen to the telegram command", async () => {
  await withTempDir(async (tempDir) => {
    const controller = new AbortController();
    controller.abort();

    const config = structuredClone(DEFAULT_CONFIG);
    config.telegram.enabled = true;
    config.telegram.bot_token = "bot-token";
    config.telegram.allowed_chat_ids = ["123"];

    await writeFile(
      path.join(tempDir, "media-vector-index.config.json"),
      `${JSON.stringify(config, null, 2)}\n`,
      "utf8"
    );

    const result = await dispatchCliCommand(["telegram", "listen"], {
      cwd: tempDir,
      signal: controller.signal,
    });

    assert.equal(result.command, "telegram listen");
    assert.equal(result.status, "stopped");
  });
});

test("CLI dispatch rejects an unknown telegram subcommand", async () => {
  await assert.rejects(
    () => dispatchCliCommand(["telegram", "nope"], { cwd: "/tmp/mvi" }),
    (error) => {
      assert.equal(error.code, "CLI_UNKNOWN_COMMAND");
      return true;
    }
  );
});

test("config validation rejects missing Telegram bot token when enabled", () => {
  const config = structuredClone(DEFAULT_CONFIG);
  config.telegram.enabled = true;
  config.telegram.allowed_chat_ids = ["123"];

  assert.throws(
    () => validateConfig(config),
    (error) => {
      assert.equal(error.code, "CONFIG_FIELD_INVALID");
      assert.equal(error.details?.field, "telegram.bot_token");
      return true;
    }
  );
});

test("config validation rejects invalid Telegram allowlist entries", () => {
  const config = structuredClone(DEFAULT_CONFIG);
  config.telegram.allowed_chat_ids = [""];

  assert.throws(
    () => validateConfig(config),
    (error) => {
      assert.equal(error.code, "CONFIG_FIELD_INVALID");
      assert.equal(error.details?.field, "telegram.allowed_chat_ids");
      return true;
    }
  );
});

test("config validation rejects invalid Telegram numeric settings", () => {
  const config = structuredClone(DEFAULT_CONFIG);
  config.telegram.reply_result_limit = 0;

  assert.throws(
    () => validateConfig(config),
    (error) => {
      assert.equal(error.code, "CONFIG_FIELD_INVALID");
      assert.equal(error.details?.field, "telegram.reply_result_limit");
      return true;
    }
  );
});

test("Telegram message parser supports commands and plain text", () => {
  assert.deepEqual(parseTelegramInboundMessage("/start"), { type: "help" });
  assert.deepEqual(parseTelegramInboundMessage("/help"), { type: "help" });
  assert.deepEqual(parseTelegramInboundMessage("/search sunset beach"), {
    type: "search",
    query: "sunset beach",
  });
  assert.deepEqual(parseTelegramInboundMessage("sunset beach"), {
    type: "search",
    query: "sunset beach",
  });
});

test("Telegram update handler rejects chats outside the allowlist", async () => {
  const logs = [];
  let replied = false;

  const result = await handleTelegramUpdate({
    update: {
      update_id: 1,
      message: {
        text: "sunset beach",
        chat: { id: 999 },
      },
    },
    cwd: "/tmp/mvi",
    allowedChatIds: ["123"],
    replyResultLimit: 5,
    telegramClient: {
      async sendMessage() {
        replied = true;
      },
    },
    onLog(message) {
      logs.push(message);
    },
  });

  assert.equal(result.status, "rejected");
  assert.equal(replied, false);
  assert.ok(logs.some((line) => line.includes("Rejected Telegram chat 999")));
});

test("Telegram update handler runs shared search for /search queries", async () => {
  const sentMessages = [];
  const searchCalls = [];

  const result = await handleTelegramUpdate({
    update: {
      update_id: 2,
      message: {
        text: "/search sunset beach",
        chat: { id: 123 },
      },
    },
    cwd: "/tmp/mvi",
    allowedChatIds: ["123"],
    replyResultLimit: 2,
    executeSearchWorkflowFn: async (payload) => {
      searchCalls.push(payload);
      return {
        result_count: 2,
        album_name: "AI Search Results",
        album_write_mode: "replace",
        applied_asset_count: 2,
        results: [
          { rank: 1, score: 0.91, asset_type: "image", local_identifier: "IMG/001" },
          { rank: 2, score: 0.88, asset_type: "video", local_identifier: "VID/002" },
        ],
      };
    },
    telegramClient: {
      async sendMessage(payload) {
        sentMessages.push(payload);
      },
    },
  });

  assert.equal(result.status, "replied-search");
  assert.deepEqual(searchCalls, [
    {
      cwd: "/tmp/mvi",
      query: "sunset beach",
      skipAlbum: false,
    },
  ]);
  assert.equal(sentMessages.length, 1);
  assert.match(sentMessages[0].text, /Query: sunset beach/);
  assert.match(sentMessages[0].text, /1\. 0\.9100 image IMG\/001/);
});

test("Telegram update handler treats plain text as a search query", async () => {
  const searchCalls = [];

  await handleTelegramUpdate({
    update: {
      update_id: 3,
      message: {
        text: "sunset beach",
        chat: { id: "123" },
      },
    },
    cwd: "/tmp/mvi",
    allowedChatIds: ["123"],
    replyResultLimit: 1,
    executeSearchWorkflowFn: async (payload) => {
      searchCalls.push(payload);
      return {
        result_count: 0,
        album_name: "AI Search Results",
        album_write_mode: "replace",
        applied_asset_count: 0,
        results: [],
      };
    },
    telegramClient: {
      async sendMessage() {},
    },
  });

  assert.equal(searchCalls[0].query, "sunset beach");
});

test("Telegram update handler skips non-text messages", async () => {
  let searchTouched = false;

  const result = await handleTelegramUpdate({
    update: {
      update_id: 4,
      message: {
        photo: [{ file_id: "abc" }],
        chat: { id: "123" },
      },
    },
    cwd: "/tmp/mvi",
    allowedChatIds: ["123"],
    replyResultLimit: 1,
    executeSearchWorkflowFn: async () => {
      searchTouched = true;
    },
    telegramClient: {
      async sendMessage() {},
    },
  });

  assert.equal(result.status, "skipped");
  assert.equal(searchTouched, false);
});

test("Telegram reply formatter renders top hits and album state", () => {
  const text = formatTelegramSearchReply({
    query: "sunset beach",
    replyResultLimit: 2,
    result: {
      result_count: 3,
      album_name: "AI Search Results",
      album_write_mode: "replace",
      applied_asset_count: 2,
      results: [
        { rank: 1, score: 0.91234, asset_type: "image", local_identifier: "IMG/001" },
        { rank: 2, score: 0.81234, asset_type: "video", local_identifier: "VID/002" },
        { rank: 3, score: 0.71234, asset_type: "image", local_identifier: "IMG/003" },
      ],
    },
  });

  assert.match(text, /Query: sunset beach/);
  assert.match(text, /Album: AI Search Results \(replace, applied=2\)/);
  assert.match(text, /1\. 0\.9123 image IMG\/001/);
  assert.equal(text.includes("IMG/003"), false);
});

test("Telegram reply formatter renders no-match replies", () => {
  const text = formatTelegramSearchReply({
    query: "sunset beach",
    result: {
      result_count: 0,
      album_name: "AI Search Results",
      album_write_mode: "replace",
      applied_asset_count: 0,
      results: [],
    },
  });

  assert.match(text, /Khong tim thay match\./);
});

test("Telegram help reply lists supported commands", () => {
  const text = buildTelegramHelpReply();
  assert.match(text, /\/search <query>/);
  assert.match(text, /Plain text messages are also treated as search queries/);
});

test("Telegram long polling persists offsets and avoids reprocessing on restart", async () => {
  await withTempDir(async (tempDir) => {
    const config = structuredClone(DEFAULT_CONFIG);
    config.telegram.enabled = true;
    config.telegram.bot_token = "bot-token";
    config.telegram.allowed_chat_ids = ["123"];
    config.telegram.offset_store_path = ".data/telegram-offset.json";

    const logs = [];
    const sentMessages = [];
    const searchCalls = [];
    const firstController = new AbortController();
    let pollCount = 0;

    const createMockClient = () => ({
      async getUpdates({ offset }) {
        pollCount += 1;
        if (pollCount === 1) {
          return [
            {
              update_id: 7,
              message: {
                text: "sunset beach",
                chat: { id: "123" },
              },
            },
          ];
        }

        firstController.abort();
        assert.equal(offset, 8);
        return [];
      },
      async sendMessage(payload) {
        sentMessages.push(payload);
      },
    });

    const firstRun = await runTelegramLongPollListener({
      cwd: tempDir,
      signal: firstController.signal,
      loadConfigFn: async () => ({
        config,
        configPath: path.join(tempDir, "media-vector-index.config.json"),
        exists: true,
      }),
      executeSearchWorkflowFn: async (payload) => {
        searchCalls.push(payload);
        return {
          result_count: 1,
          album_name: "AI Search Results",
          album_write_mode: "replace",
          applied_asset_count: 1,
          results: [
            { rank: 1, score: 0.95, asset_type: "image", local_identifier: "IMG/001" },
          ],
        };
      },
      createTelegramClientFn: createMockClient,
      onLog(message) {
        logs.push(message);
      },
    });

    assert.equal(firstRun.processed_update_count, 1);
    assert.equal(firstRun.next_update_offset, 8);
    assert.equal(searchCalls.length, 1);
    assert.equal(sentMessages.length, 1);

    const offsetPayload = JSON.parse(
      await readFile(path.join(tempDir, ".data/telegram-offset.json"), "utf8")
    );
    assert.equal(offsetPayload.next_update_offset, 8);

    const secondController = new AbortController();
    let secondPollSeen = false;
    const secondRun = await runTelegramLongPollListener({
      cwd: tempDir,
      signal: secondController.signal,
      loadConfigFn: async () => ({
        config,
        configPath: path.join(tempDir, "media-vector-index.config.json"),
        exists: true,
      }),
      executeSearchWorkflowFn: async () => {
        throw new Error("should not search on restart without new updates");
      },
      createTelegramClientFn: () => ({
        async getUpdates({ offset }) {
          secondPollSeen = true;
          assert.equal(offset, 8);
          secondController.abort();
          return [];
        },
        async sendMessage() {
          throw new Error("should not send on restart without new updates");
        },
      }),
      onLog() {},
    });

    assert.equal(secondPollSeen, true);
    assert.equal(secondRun.processed_update_count, 0);
    assert.ok(logs.some((line) => line.includes("Telegram listener started.")));
  });
});

test("Telegram long polling retries polling errors without crashing the loop", async () => {
  const config = structuredClone(DEFAULT_CONFIG);
  config.telegram.enabled = true;
  config.telegram.bot_token = "bot-token";
  config.telegram.allowed_chat_ids = ["123"];

  const sleepCalls = [];
  const controller = new AbortController();
  let pollAttempt = 0;

  const result = await runTelegramLongPollListener({
    cwd: "/tmp/mvi",
    signal: controller.signal,
    loadConfigFn: async () => ({
      config,
      configPath: "/tmp/mvi/media-vector-index.config.json",
      exists: true,
    }),
    createTelegramClientFn: () => ({
      async getUpdates() {
        pollAttempt += 1;
        if (pollAttempt === 1) {
          throw new Error("network down");
        }

        controller.abort();
        return [];
      },
      async sendMessage() {},
    }),
    sleepFn: async (milliseconds) => {
      sleepCalls.push(milliseconds);
    },
    onLog() {},
  });

  assert.equal(pollAttempt, 2);
  assert.deepEqual(sleepCalls, [config.telegram.poll_retry_delay_ms]);
  assert.equal(result.processed_update_count, 0);
});

test("Telegram runtime config resolves relative offset paths inside the repo cwd", () => {
  const config = structuredClone(DEFAULT_CONFIG);
  config.telegram.enabled = true;
  config.telegram.bot_token = "bot-token";
  config.telegram.allowed_chat_ids = [123];

  const runtime = resolveTelegramRuntimeConfig({
    cwd: "/tmp/mvi",
    config,
  });

  assert.equal(runtime.offsetStorePath, "/tmp/mvi/.data/telegram-offset.json");
  assert.deepEqual(runtime.allowedChatIds, ["123"]);
});

test("Telegram offset store reads and writes next update offsets", async () => {
  await withTempDir(async (tempDir) => {
    const store = createTelegramOffsetStore({
      offsetStorePath: path.join(tempDir, "offset.json"),
    });

    assert.equal(await store.readOffset(), null);
    await store.writeOffset(42);
    assert.equal(await store.readOffset(), 42);
  });
});
