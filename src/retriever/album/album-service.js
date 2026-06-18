import {
  ensurePhotosResultsAlbum,
  writePhotosResultsAlbum,
} from "../../scanner/photos/bridge-client.js";
import { AppError } from "../../shared/errors/app-error.js";

function normalizeWriteMode(config) {
  return config?.retriever?.album_write_mode ?? "replace";
}

function normalizeAlbumName({ config, results }) {
  const configuredAlbumName = config?.app?.results_album_name ?? "AI Search Results";
  const resultAlbumNames = Array.from(
    new Set(
      (results ?? [])
        .map((result) => String(result?.album_name ?? "").trim())
        .filter(Boolean)
    )
  );

  if (resultAlbumNames.length === 0) {
    return configuredAlbumName;
  }

  if (resultAlbumNames.length === 1) {
    return resultAlbumNames[0];
  }

  throw new AppError("Album output flow received mixed album targets.", {
    code: "ALBUM_OUTPUT_MIXED_ALBUM_NAMES",
    details: {
      album_names: resultAlbumNames,
    },
  });
}

export function createAlbumService({
  ensureResultsAlbumFn = ensurePhotosResultsAlbum,
  writeResultsAlbumFn = writePhotosResultsAlbum,
} = {}) {
  async function ensureResultsAlbum({ config } = {}) {
    const albumName = config?.app?.results_album_name ?? "AI Search Results";
    return Promise.resolve(
      ensureResultsAlbumFn({
        albumName,
      })
    );
  }

  async function buildAlbumOutput({ results = [], config } = {}) {
    const albumName = normalizeAlbumName({ config, results });
    const writeMode = normalizeWriteMode(config);
    const ensuredAlbum = await Promise.resolve(
      ensureResultsAlbumFn({
        albumName,
      })
    );
    const requestedLocalIdentifiers = [];
    const unresolvedResults = [];
    const seenLocalIdentifiers = new Set();

    for (const result of results) {
      const localIdentifier = String(result?.local_identifier ?? "").trim();

      if (!localIdentifier) {
        unresolvedResults.push({
          result_id: result?.result_id ?? null,
          local_identifier: null,
          reason: "missing-local-identifier",
        });
        continue;
      }

      if (seenLocalIdentifiers.has(localIdentifier)) {
        continue;
      }

      seenLocalIdentifiers.add(localIdentifier);
      requestedLocalIdentifiers.push(localIdentifier);
    }

    return {
      implemented: true,
      phase: "search",
      album_name: ensuredAlbum.album_name ?? albumName,
      requested_album_name: ensuredAlbum.requested_album_name ?? albumName,
      album_local_identifier: ensuredAlbum.album_local_identifier ?? null,
      created: ensuredAlbum.created ?? false,
      found_existing: ensuredAlbum.found_existing ?? false,
      album_write_mode: writeMode,
      requested_asset_count: requestedLocalIdentifiers.length,
      requested_local_identifiers: requestedLocalIdentifiers,
      unresolved_results: unresolvedResults,
      results_received_count: Array.isArray(results) ? results.length : 0,
      notes: [
        "Album output flow normalized retrieval results into an ordered localIdentifier write-set.",
        "Asset membership mutation in Photos remains a separate step.",
      ],
    };
  }

  async function writeAlbumOutput({ results = [], config } = {}) {
    const albumOutput = await buildAlbumOutput({ results, config });
    const mutation = await Promise.resolve(
      writeResultsAlbumFn({
        albumName: albumOutput.album_name,
        albumWriteMode: albumOutput.album_write_mode,
        localIdentifiers: albumOutput.requested_local_identifiers,
      })
    );

    return {
      ...albumOutput,
      ...mutation,
      phase: "search",
      requested_asset_count: albumOutput.requested_asset_count,
      requested_local_identifiers: albumOutput.requested_local_identifiers,
      results_received_count: albumOutput.results_received_count,
      unresolved_results: [
        ...albumOutput.unresolved_results,
        ...(Array.isArray(mutation?.unresolved_results) ? mutation.unresolved_results : []),
      ],
      notes: [
        "Album output flow normalized retrieval results into an ordered localIdentifier write-set.",
        ...(Array.isArray(mutation?.notes) ? mutation.notes : []),
      ],
    };
  }

  return {
    ensureResultsAlbum,
    buildAlbumOutput,
    writeAlbumOutput,
  };
}
