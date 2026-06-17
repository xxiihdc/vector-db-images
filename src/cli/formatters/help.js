export function buildHelpText() {
  return [
    "Media Vector Index CLI",
    "",
    "Usage:",
    "  mvi init [--force]",
    "  mvi index [--limit 200] [--timeout-seconds 30] [--no-cache] [--json]",
    "  mvi photos check [--json]",
    "  mvi photos request-access [--json]",
    "  mvi photos scan [--json]",
    "  mvi photos debug [--json]",
    "  mvi photos capabilities [--json]",
    "  mvi photos probe-originals [--json]",
    "  mvi photos extract [--limit 10] [--timeout-seconds 30] [--json]",
  ].join("\n");
}
