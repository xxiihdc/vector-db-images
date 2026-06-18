export function buildHelpText() {
  return [
    "Media Vector Index CLI",
    "",
    "Usage:",
    "  mvi init [--force]",
    "  mvi index [--limit 200] [--timeout-seconds 30] [--progress-every 10] [--profile] [--no-cache] [--json]",
    "  mvi index file <image-path> [--json]",
    "  mvi reindex [--limit 200] [--timeout-seconds 30] [--progress-every 10] [--profile] [--json]",
    "  mvi search <query> [--limit 50] [--skip-album] [--json]",
    "  mvi search image <image-path> [--limit 50] [--skip-album] [--json]",
    "  mvi serve [--port 4173] [--json]",
    "  mvi storage vector-check [--json]",
    "  mvi photos check [--json]",
    "  mvi photos request-access [--json]",
    "  mvi photos scan [--json]",
    "  mvi photos debug [--json]",
    "  mvi photos capabilities [--json]",
    "  mvi photos probe-originals [--json]",
    "  mvi photos extract [--limit 10] [--timeout-seconds 30] [--json]",
    "  mvi embedding capabilities [--json]",
    "  mvi embedding benchmark [--candidates baseline,stretch,high-end] [--asset-limit 50] [--query-limit 5] [--query-pack <path>] [--json]",
  ].join("\n");
}
