import path from "node:path";
import { AppError } from "../../shared/errors/app-error.js";
import {
  ensureDir,
  pathExists,
  readJsonFile,
  writeJsonFile,
} from "../../shared/utils/fs.js";
import { buildAssetRecord } from "../../indexer/records/asset-record.js";

const CATALOG_SCHEMA_VERSION = 1;

function createEmptyCatalogStore() {
  return {
    schema_version: CATALOG_SCHEMA_VERSION,
    backend: "json-file",
    assets: [],
  };
}

function normalizeCatalogStore(store) {
  if (!store || typeof store !== "object") {
    return createEmptyCatalogStore();
  }

  return {
    schema_version: store.schema_version ?? CATALOG_SCHEMA_VERSION,
    backend: store.backend ?? "json-file",
    assets: Array.isArray(store.assets)
      ? store.assets.map((asset) => buildAssetRecord(asset))
      : [],
  };
}

async function loadStore(filePath) {
  const exists = await pathExists(filePath);

  if (!exists) {
    return createEmptyCatalogStore();
  }

  return normalizeCatalogStore(await readJsonFile(filePath));
}

async function saveStore(filePath, store) {
  await writeJsonFile(filePath, normalizeCatalogStore(store));
}

function requireLocalIdentifier(record) {
  if (!record.local_identifier) {
    throw new AppError("Asset record requires `local_identifier`.", {
      code: "CATALOG_LOCAL_IDENTIFIER_REQUIRED",
    });
  }
}

export function createCatalogRepository({ filePath }) {
  if (!filePath) {
    throw new AppError("Catalog repository requires `filePath`.", {
      code: "CATALOG_FILE_PATH_REQUIRED",
    });
  }

  async function initialize() {
    await ensureDir(path.dirname(filePath));
    const store = await loadStore(filePath);
    await saveStore(filePath, store);

    return {
      file_path: filePath,
      backend: store.backend,
      schema_version: store.schema_version,
      asset_count: store.assets.length,
    };
  }

  async function listAssets() {
    const store = await loadStore(filePath);
    return store.assets;
  }

  async function countAssets() {
    const store = await loadStore(filePath);
    return store.assets.length;
  }

  async function getAssetByLocalIdentifier(localIdentifier) {
    const store = await loadStore(filePath);
    return (
      store.assets.find((asset) => asset.local_identifier === localIdentifier) ?? null
    );
  }

  async function getAssetByAssetId(assetId) {
    const store = await loadStore(filePath);
    return store.assets.find((asset) => asset.asset_id === assetId) ?? null;
  }

  async function upsertAsset(payload) {
    const store = await loadStore(filePath);
    const nextRecord = buildAssetRecord(payload);
    requireLocalIdentifier(nextRecord);

    const currentIndex = store.assets.findIndex(
      (asset) => asset.local_identifier === nextRecord.local_identifier
    );

    if (currentIndex === -1) {
      store.assets.push(nextRecord);
    } else {
      store.assets[currentIndex] = buildAssetRecord({
        ...store.assets[currentIndex],
        ...payload,
      });
    }

    await saveStore(filePath, store);
    return getAssetByLocalIdentifier(nextRecord.local_identifier);
  }

  async function markAssetSeen(localIdentifier, lastSeenAt = new Date().toISOString()) {
    const existing = await getAssetByLocalIdentifier(localIdentifier);

    if (!existing) {
      return null;
    }

    return upsertAsset({
      ...existing,
      last_seen_at: lastSeenAt,
    });
  }

  async function markAssetIndexed(localIdentifier, indexedAt = new Date().toISOString()) {
    const existing = await getAssetByLocalIdentifier(localIdentifier);

    if (!existing) {
      return null;
    }

    return upsertAsset({
      ...existing,
      indexed_at: indexedAt,
    });
  }

  return {
    initialize,
    countAssets,
    listAssets,
    getAssetByLocalIdentifier,
    getAssetByAssetId,
    upsertAsset,
    markAssetSeen,
    markAssetIndexed,
  };
}
