function truncateTelegramText(text, maxLength = 4096) {
  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, maxLength - 3)}...`;
}

export function buildTelegramHelpReply() {
  return [
    "Media Vector Index Telegram bot",
    "Commands:",
    "/start - show this help",
    "/help - show this help",
    "/search <query> - run semantic search and update the Photos results album",
    "Plain text messages are also treated as search queries.",
  ].join("\n");
}

export function formatTelegramSearchReply({
  query,
  result,
  replyResultLimit = 5,
} = {}) {
  const lines = [
    `Query: ${query}`,
    `Results: ${result?.result_count ?? 0}`,
    `Album: ${result?.album_name ?? "AI Search Results"} (${result?.album_write_mode ?? "unknown"}, applied=${result?.applied_asset_count ?? 0})`,
  ];

  if (!Array.isArray(result?.results) || result.results.length === 0) {
    lines.push("Khong tim thay match.");
    return truncateTelegramText(lines.join("\n"));
  }

  const limitedResults = result.results.slice(0, replyResultLimit);
  for (const item of limitedResults) {
    const score = Number.isFinite(item?.score) ? item.score.toFixed(4) : "n/a";
    lines.push(
      `${item?.rank ?? "?"}. ${score} ${item?.asset_type ?? "unknown"} ${item?.local_identifier ?? "missing-local-identifier"}`
    );
  }

  return truncateTelegramText(lines.join("\n"));
}
