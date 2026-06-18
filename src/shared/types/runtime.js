export const RUNTIME_PHASES = Object.freeze({
  SCAFFOLD: "scaffold",
  INGESTION: "ingestion",
  SEARCH: "search",
});

export const ASSET_TYPES = Object.freeze({
  IMAGE: "image",
  VIDEO: "video",
});

export const PHOTOS_COMMANDS = Object.freeze({
  CHECK_ACCESS: "check-access",
  REQUEST_ACCESS: "request-access",
  SCAN_ASSETS: "scan-assets",
  DEBUG_ACCESS: "debug-access",
  CAPABILITIES: "capabilities",
  PROBE_ORIGINAL_ACCESS: "probe-original-access",
  EXTRACT_REPRESENTATIONS: "extract-representations",
  ENSURE_RESULTS_ALBUM: "ensure-results-album",
});
