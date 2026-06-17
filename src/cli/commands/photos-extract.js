import { loadConfig } from "../../config/load-config.js";
import { extractPhotosRepresentations } from "../../scanner/photos/bridge-client.js";
import { collectImageRepresentations } from "../../extractor/image/image-extractor.js";
import { collectVideoRepresentations } from "../../extractor/video/video-extractor.js";

function readIntegerFlag(args, name, fallback) {
  const index = args.indexOf(name);
  if (index === -1) {
    return fallback;
  }

  const rawValue = args[index + 1];
  const parsedValue = Number.parseInt(rawValue ?? "", 10);
  return Number.isFinite(parsedValue) && parsedValue > 0 ? parsedValue : fallback;
}

export async function runPhotosExtractCommand({ cwd, args = [] }) {
  const configState = await loadConfig(cwd);
  const allowNetworkAccess =
    configState.config.extractor?.allow_network_access ?? true;
  const thumbnailSize =
    configState.config.extractor?.image_thumbnail_size ?? 224;
  const limit = readIntegerFlag(args, "--limit", 10);
  const timeoutSeconds = readIntegerFlag(args, "--timeout-seconds", 30);

  const extractionState = extractPhotosRepresentations({
    allowNetworkAccess,
    limit,
    thumbnailSize,
    timeoutSeconds,
  });
  const imageRepresentations = collectImageRepresentations(
    extractionState.representations ?? []
  );
  const videoRepresentations = collectVideoRepresentations(
    extractionState.representations ?? []
  );
  const sampleRepresentations = (extractionState.representations ?? []).slice(0, 3);

  return {
    ...extractionState,
    image_representations: imageRepresentations,
    video_representations: videoRepresentations,
    config_path: configState.configPath,
    config_exists: configState.exists,
    summary: "Photos in-memory extraction completed.",
    lines: [
      `Config present: ${configState.exists ? "yes" : "no"}`,
      `Framework connection: ${extractionState.framework_connection}`,
      `Permission status: ${extractionState.permission_status}`,
      `Library access: ${extractionState.library_access}`,
      `Thumbnail size: ${thumbnailSize}x${thumbnailSize}`,
      `Extraction limit: ${limit}`,
      `Network-backed access allowed: ${allowNetworkAccess ? "yes" : "no"}`,
      `Representations extracted: ${extractionState.representation_count ?? 0}`,
      `Image thumbnails: ${imageRepresentations.length}`,
      `Video representations: ${videoRepresentations.length}`,
      ...sampleRepresentations.map((representation, index) => {
        const status = representation.metadata?.status ?? "unknown";
        return `Sample extraction ${index + 1}: ${representation.local_identifier} (${representation.asset_type}) -> ${status}, ${representation.byte_length ?? 0} bytes`;
      }),
    ],
  };
}
