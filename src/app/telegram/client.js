import { AppError } from "../../shared/errors/app-error.js";

function createTelegramApiUrl(botToken, method) {
  return `https://api.telegram.org/bot${botToken}/${method}`;
}

async function parseTelegramResponse(response, method) {
  let payload = null;

  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok || payload?.ok !== true) {
    throw new AppError(`Telegram API request failed for ${method}.`, {
      code: "TELEGRAM_API_ERROR",
      details: {
        method,
        status: response.status,
        description: payload?.description ?? null,
        error_code: payload?.error_code ?? null,
      },
    });
  }

  return payload.result;
}

export function createTelegramBotClient({
  botToken,
  fetchFn = fetch,
} = {}) {
  if (String(botToken ?? "").trim().length === 0) {
    throw new AppError("Telegram bot token is required.", {
      code: "TELEGRAM_BOT_TOKEN_REQUIRED",
    });
  }

  async function call(method, parameters = {}) {
    const response = await fetchFn(createTelegramApiUrl(botToken, method), {
      method: "POST",
      body: new URLSearchParams(
        Object.entries(parameters)
          .filter(([, value]) => value !== undefined && value !== null)
          .map(([key, value]) => [key, String(value)])
      ),
    });

    return parseTelegramResponse(response, method);
  }

  return {
    async getUpdates({ offset, timeoutSeconds }) {
      return call("getUpdates", {
        offset,
        timeout: timeoutSeconds,
      });
    },
    async sendMessage({ chatId, text }) {
      return call("sendMessage", {
        chat_id: chatId,
        text,
      });
    },
  };
}
