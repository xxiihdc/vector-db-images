export function buildHelpText() {
  return [
    "Media Vector Index CLI",
    "",
    "Usage:",
    "  mvi init [--force]",
    "  mvi photos check [--json]",
    "  mvi photos request-access [--json]",
    "  mvi photos scan [--json]",
    "  mvi photos debug [--json]",
    "  mvi photos probe-originals [--json]",
  ].join("\n");
}
