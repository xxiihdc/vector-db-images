# Architecture Draft

## First Principle

Treat Apple Photos on macOS as the system of record for source images and videos, even when originals live in iCloud, while the local database stores only the minimum data needed for semantic search.

## Proposed Layers

1. `scanner`
   - enumerates assets from Apple Photos
   - handles Photos permission and library traversal
   - resolves stable `PHAsset.localIdentifier`
   - distinguishes image and video assets without relying on exported files

2. `extractor`
   - requests `224x224` thumbnails or lightweight video representations from Photos APIs
   - keeps all extracted representations in-memory only
   - extracts minimal technical metadata when needed for indexing
   - current MVP debug path uses image thumbnails plus multi-frame video storyboards from the most recent 10 assets by default

3. `enrichment`
   - prepares optional text hints or metadata-derived context later
   - remains non-blocking for the base image and video indexing flow

4. `indexer`
   - converts Photos assets into normalized embedding records
   - writes vector rows keyed by `localIdentifier`

5. `retriever`
   - semantic search
   - returns CLI-readable result payloads
   - pushes matching assets into the Photos results album

## Runtime Folder Layout

The first runtime layout should keep CLI orchestration separate from media-processing layers while making each core concern obvious at a glance.

```text
src/
  app/
    telegram/
  cli/
  config/
  scanner/
  extractor/
  enrichment/
  indexer/
  retriever/
  server/
  storage/
  shared/
```

## Layer-Internal Layout

The first design pass should go one level deeper than top-level folders so the next scaffold step can create empty modules without inventing new boundaries.

```text
src/
  app/
    search/
    telegram/
  cli/
    commands/
    formatters/
  config/
    defaults/
    schema/
  scanner/
    contracts/
    photos/
    services/
  extractor/
    contracts/
    image/
    video/
  enrichment/
    contracts/
    metadata/
    normalizers/
  indexer/
    contracts/
    pipeline/
    records/
  retriever/
    contracts/
    query/
    album/
  server/
    static/
  storage/
    catalog/
    vector/
    migrations/
  shared/
    errors/
    types/
    utils/
```

### Folder Responsibilities

- `src/cli/`
  - owns command entrypoints, argument parsing, and output formatting
  - may expose thin wrapper commands that coordinate multiple retrieval surfaces without moving orchestration into UI-specific layers
  - calls into lower layers but should not absorb media-processing rules

- `src/app/`
  - owns application-level orchestration shared by multiple surfaces
  - keeps search workflow reusable between CLI, the local webserver, and the Telegram bot

- `src/config/`
  - owns project config loading, defaults, validation, and path resolution
  - honors `MVI_PROJECT_ROOT` as an optional repo-root override for CLI/script entrypoints
  - merges ignored local Telegram overrides from `telegram.config.json` on top of the base project config when present
  - keeps runtime settings outside the five core layers

- `src/scanner/`
  - owns Photos library discovery and permission-aware asset enumeration
  - emits normalized asset candidates before thumbnail extraction begins

- `src/extractor/`
  - owns thumbnail and lightweight video representation retrieval in-memory
  - turns Photos assets into structured representation and minimal metadata payloads

- `src/enrichment/`
  - owns optional context enrichment that may improve retrieval later
  - must not become a dependency for initial indexing correctness

- `src/indexer/`
  - owns normalization from asset candidates into embedding-ready records
  - coordinates persistence-oriented indexing flow without becoming the Photos source of truth

- `src/retriever/`
  - owns search queries, ranking handoff, and result payload shaping
  - owns album update orchestration for `AI Search Results`

- `src/storage/`
  - owns lightweight local database adapters
  - stores vectors and `localIdentifier` mappings only, or the smallest debug metadata strictly required

- `src/server/`
  - owns the thin local HTTP surface for search convenience
  - must stay local-only and defer real work to shared app/runtime services

- `src/shared/`
  - owns small cross-cutting utilities, shared types, and common helpers
  - should remain minimal so layer boundaries stay clear

### Internal Responsibilities

- `src/cli/commands/`
  - contains CLI command handlers such as index, search, and diagnostics later
  - stays thin and delegates business flow to core layers
  - includes preflight native capability probes before deeper Photos extraction debugging

- `src/app/search/`
  - contains the shared search workflow that loads config, initializes repositories, runs semantic retrieval, and writes album output
  - keeps CLI, webserver, and Telegram listener from duplicating orchestration logic

- `src/app/telegram/`
  - contains the Telegram long-poll client, offset store, message parsing, and listener loop
  - treats Telegram as another thin retrieval surface layered on top of the shared search workflow

- `src/cli/formatters/`
  - contains terminal output shaping for tables, debug payloads, and summaries
  - keeps presentation logic out of retriever results and indexer records

- `src/server/static/`
  - contains the plain HTML, CSS, and browser-side JS for the search-only UI
  - must stay intentionally thin and only expose parameters already supported by runtime

- `src/config/defaults/`
  - defines default runtime values and album naming defaults
  - remains pure and side-effect free

- `src/config/schema/`
  - defines config parsing and validation contracts
  - becomes the single boundary for future user config files

- `src/scanner/contracts/`
  - defines asset candidate types emitted by Photos scanning
  - keeps scanner outputs stable before representation extraction starts

- `src/scanner/photos/`
  - contains Photos-framework-specific adapters and permission-aware library access
  - isolates macOS integration from the rest of the runtime
  - streams long-running native extraction progress on `stderr` so CLI flows can see which asset the bridge is currently processing

- `src/scanner/services/`
  - contains traversal and filtering flows built on top of Photos adapters
  - decides which assets become extraction candidates

- `src/extractor/contracts/`
  - defines in-memory representation payloads for image and video extraction
  - keeps extraction outputs independent from the embedding provider

- `src/extractor/image/`
  - contains image thumbnail request logic and related normalization
  - current Phase 3 target is `224x224` thumbnails encoded in-memory for embedding input
  - never writes preview images to disk

- `src/extractor/video/`
  - contains lightweight video representation request logic
  - current Phase 3 target is a lightweight in-memory video-derived representation, now defaulting to a multi-frame storyboard derived from a Photos-managed AVAsset path
  - stays focused on RAM-only access paths for retrieval inputs

- `src/enrichment/contracts/`
  - defines optional enrichment payloads and feature flags
  - prevents enrichment from leaking into mandatory indexing state

- `src/enrichment/metadata/`
  - contains opt-in metadata-derived context later, such as dates or album hints
  - is non-blocking for baseline indexing correctness

- `src/enrichment/normalizers/`
  - contains string or metadata normalization helpers used before indexing or retrieval
  - keeps these transforms separate from scanner and storage

- `src/indexer/contracts/`
  - defines embedding-ready records and indexing job inputs
  - becomes the boundary between extraction outputs and persistence writes

- `src/indexer/pipeline/`
  - contains orchestration from scanned asset to extracted representation to persisted vector
  - owns flow coordination, not Photos access details
  - chunks bridge extraction requests so full-library indexing does not require one giant JSON payload in memory between Python and Node
  - checkpoints each chunk through prepare, embed, and persist before moving to the next chunk so reruns can keep already-indexed progress after a later failure

- `src/indexer/records/`
  - contains record builders for asset rows and embedding rows
  - keeps deterministic identity mapping close to indexing logic

- `src/retriever/contracts/`
  - defines retrieval result payloads and ranking inputs
  - stabilizes the search output contract for CLI and agents

- `src/retriever/query/`
  - contains query normalization, embedding lookup orchestration, and ranking handoff
  - remains independent from album mutation side effects
  - now also supports an image-query adapter for exact-match validation by embedding a local/exported image through the same multimodal provider path

- `src/retriever/album/`
  - contains `AI Search Results` album lookup and update orchestration
  - keeps Photos output flow distinct from semantic matching logic

- `src/storage/catalog/`
  - contains lightweight asset record persistence keyed by `localIdentifier`
  - must stay minimal and avoid becoming a Photos mirror
  - may store synthetic deterministic local identifiers for validation-only external image fixtures, but must not store export file paths

- `src/storage/vector/`
  - contains vector repository interfaces and local backend adapters
  - hides backend choice from indexer and retriever
  - current Phase 4 backend keeps a lightweight legacy JSON adapter for tests/migration, while MVP semantic retrieval uses `Qdrant` behind the same repository boundary
  - `Qdrant` writes should be batched per indexing chunk so local semantic persistence is not dominated by one-point-at-a-time HTTP overhead
  - transient local-sidecar write failures should be retried at the sub-batch level so a short socket hiccup does not abort the whole indexing run immediately

- `src/storage/migrations/`
  - contains local schema evolution helpers if the project needs them
  - stays storage-specific and separate from runtime domain code

- `src/shared/errors/`
  - contains typed runtime errors and mapping helpers
  - avoids ad hoc error classes scattered across layers

- `src/shared/types/`
  - contains truly cross-layer value objects only
  - should not become a dump for layer-specific contracts

- `src/shared/utils/`
  - contains narrow helpers with no better home
  - should stay small so core boundaries remain visible

## Layout Rules

1. Each of the five core concerns gets exactly one primary top-level folder.
2. Cross-cutting code goes to `config`, `storage`, or `shared`, not into an arbitrary core layer.
3. CLI concerns stay in `src/cli/` so the project remains CLI-first without coupling commands to indexing internals.
4. Optional future surfaces such as a thin local webserver or later Electron shell should be added as peer folders, not by reshaping the five core processing folders.
5. No layer may persist thumbnail image files or preview caches to local disk in the MVP path.
6. `scanner` stops at asset discovery and candidate shaping; thumbnail or representation bytes begin in `extractor`.
7. `retriever/query` handles semantic matching, while `retriever/album` handles write-back into Photos so read and write concerns stay separable.
8. `contracts/` folders define layer inputs and outputs locally; only truly shared primitives belong in `src/shared/`.

## Config File Design

The first config design should stay small, explicit, and local-first.

For MVP setup, the runtime should load a single user-editable file named `media-vector-index.config.json` from the working directory. Environment variables may be added later for overrides, but they should not be the primary configuration surface during project setup.

### Config Goals

1. Keep one obvious place for user-tunable runtime decisions.
2. Separate stable product defaults from machine-specific local paths.
3. Configure workflow behavior without encoding implementation details of Apple Photos itself.
4. Keep the file safe to commit only if the user chooses; no secrets are required for MVP setup.

### Top-Level Shape

```json
{
  "schema_version": 1,
  "app": {
    "results_album_name": "AI Search Results",
    "log_level": "info"
  },
  "storage": {
    "root_dir": ".data",
    "catalog_db_path": ".data/catalog-store.json",
    "vector_backend": "qdrant",
    "vector_service_url": "http://127.0.0.1:6333",
    "vector_collection_name": "media-index",
    "vector_distance": "cosine",
    "vector_timeout_ms": 10000
  },
  "scanner": {
    "include_images": true,
    "include_videos": true,
    "batch_size": 200
  },
  "extractor": {
    "image_thumbnail_size": 224,
    "video_strategy": "storyboard",
    "allow_network_access": true
  },
  "indexer": {
    "write_batch_size": 64,
    "reindex_mode": "incremental"
  },
  "retriever": {
    "default_limit": 50,
    "album_write_mode": "replace",
    "write_to_photos_results_album": true
  },
  "embedding": {
    "provider": "open-clip",
    "model": "ViT-B-32",
    "pretrained": "laion2b_s34b_b79k",
    "device": "auto",
    "normalize": true,
    "batch_size": 8
  },
  "debug": {
    "save_diagnostics": false
  }
}
```

### Section Responsibilities

- `schema_version`
  - version gate for config parsing and future migrations
  - must be required so config evolution stays deterministic

- `app`
  - owns user-visible runtime defaults such as album naming and log verbosity
  - must not contain storage or Photos framework internals

- `storage`
  - owns the local catalog path plus vector backend connection settings
  - paths remain local and lightweight; no preview cache paths belong here

- `scanner`
  - owns high-level asset selection and scan traversal tuning
  - does not configure Photos permission policy itself

- `extractor`
  - owns representation-level extraction choices such as thumbnail size and video representation mode
  - keeps the zero-storage path explicit through `allow_network_access` for iCloud-backed fetches

- `indexer`
  - owns indexing throughput and re-index behavior defaults
  - must stay independent from embedding provider internals

- `retriever`
  - owns search output defaults and album write behavior
  - keeps user-facing retrieval controls out of CLI command code

- `embedding`
  - owns provider selection and model identity only
  - provider-specific advanced settings can be added later under this section without changing other layers
  - provider preflight should report missing runtime libraries separately and note when first-run checkpoint download may still require internet or a warmed local cache

- `debug`
  - owns optional diagnostics toggles
  - must never permit thumbnail or video proxy caching to disk in the MVP path

### Field Rules

1. Path fields should be relative to the config file by default.
2. The config must not require any absolute Photos library filesystem path.
3. The config must not include credentials or remote API keys for MVP setup.
4. `results_album_name` defaults to `AI Search Results` and should remain user-overridable.
5. `image_thumbnail_size` defaults to `224` to match the current extraction baseline.
6. `allow_network_access` represents whether Photos-backed iCloud fetches are allowed during extraction.
7. `reindex_mode` starts with `incremental` as the default assumption, while exact change detection logic is defined separately.
8. `album_write_mode` starts with `replace` so each search run can deterministically refresh the review album.
9. `write_to_photos_results_album` defaults to `true`; set it to `false` when validating retrieval output without mutating the Photos review album or triggering extra iCloud sync.

### Config Boundary Decisions

1. Photos permission state is runtime state, not persisted user config.
2. Raw Photos framework object identifiers beyond `PHAsset.localIdentifier` do not belong in config.
3. Embedding provider selection belongs in config, but provider implementation details belong in provider modules.
4. Local storage paths belong in config, but actual schema definitions belong in storage design docs.

## Storage Shape

### Asset record

The asset catalog should keep one row per Photos asset and stay intentionally small.

#### Asset Record Schema v1

```json
{
  "asset_id": "asset:sha256(localIdentifier)",
  "local_identifier": "A1B2C3/L0/001",
  "asset_type": "image",
  "media_subtypes": [],
  "favorite": false,
  "hidden": false,
  "pixel_width": 4032,
  "pixel_height": 3024,
  "duration_seconds": null,
  "creation_date": "2026-06-01T12:34:56.000Z",
  "modification_date": "2026-06-10T08:00:00.000Z",
  "is_in_icloud": true,
  "indexed_at": "2026-06-17T09:00:00.000Z",
  "last_seen_at": "2026-06-17T09:00:00.000Z",
  "source_fingerprint": "2026-06-10T08:00:00.000Z|4032|3024|image"
}
```

#### Asset Record Fields

- `asset_id`
  - deterministic internal id derived from `local_identifier`
  - never sourced from filesystem paths

- `local_identifier`
  - canonical `PHAsset.localIdentifier`
  - required source-of-truth link back into Photos

- `asset_type`
  - enum: `image` | `video`
  - baseline media discriminator for indexing and retrieval

- `media_subtypes`
  - optional normalized subtype labels such as `panorama`, `screenshot`, or `slow-motion`
  - kept as lightweight strings rather than raw framework constants

- `favorite`
  - optional user-library signal useful later for ranking or debug

- `hidden`
  - optional visibility signal useful for filtering and debug

- `pixel_width`, `pixel_height`
  - minimal technical metadata for extraction planning and debug

- `duration_seconds`
  - nullable for images
  - populated for videos when cheaply available from Photos metadata

- `creation_date`, `modification_date`
  - optional ISO-8601 timestamps from Photos metadata
  - used later for enrichment or re-index detection

- `is_in_icloud`
  - nullable boolean if the runtime can detect cloud-backed state
  - useful for diagnostics and iCloud-aware fetch behavior

- `indexed_at`
  - last successful time this asset produced an indexable record

- `last_seen_at`
  - last successful scan sighting time
  - supports safe orphan detection during re-index

- `source_fingerprint`
  - compact deterministic comparison string or hash derived from low-cost source metadata
  - supports change detection without mirroring Photos metadata wholesale

#### Asset Record Rules

1. The asset record must not store thumbnail bytes, video proxy bytes, or exported file paths.
2. `local_identifier` is required and unique.
3. `asset_id` is deterministic and derived from `local_identifier`.
4. `duration_seconds` must be `null` for non-video assets.
5. Additional metadata is allowed only if it directly helps re-index safety, retrieval filtering, or debug.

### Embedding record

The embedding catalog should keep one row per indexed representation and stay portable across vector backends.

#### Embedding Record Schema v1

```json
{
  "embedding_id": "embedding:sha256(asset_id|representation_kind|model_key)",
  "asset_id": "asset:sha256(localIdentifier)",
  "local_identifier": "A1B2C3/L0/001",
  "representation_kind": "image-thumbnail",
  "embedding_provider": "local",
  "embedding_model": "TBD",
  "embedding_dimensions": 1024,
  "vector_ref": "vector:embedding:sha256(...)",
  "content_fingerprint": "2026-06-10T08:00:00.000Z|4032|3024|image|224",
  "source_fingerprint": "2026-06-10T08:00:00.000Z|4032|3024|image",
  "indexed_at": "2026-06-17T09:00:00.000Z",
  "status": "ready"
}
```

#### Embedding Record Fields

- `embedding_id`
  - deterministic id for one asset representation under one model identity
  - allows re-indexing without opaque random ids

- `asset_id`
  - internal join key back to the asset catalog

- `local_identifier`
  - denormalized join field for convenience and recovery
  - must match the parent asset record

- `representation_kind`
  - enum baseline: `image-thumbnail` | `video-storyboard` | `video-poster-frame` | `video-clip-summary`
  - starts simple so video strategy can evolve without schema churn

- `embedding_provider`
  - logical provider key such as `local`

- `embedding_model`
  - model identifier string selected by config

- `embedding_dimensions`
  - vector length used for validation and backend portability

- `vector_ref`
  - reference to the stored vector payload in the chosen vector backend
  - lets the catalog remain lightweight even if vector storage implementation changes

- `content_fingerprint`
  - representation-level fingerprint including extraction choices such as thumbnail size
  - used to decide whether a stored embedding is still valid

- `source_fingerprint`
  - copied or derived from the asset record at indexing time
  - helps explain why a re-index was triggered

- `indexed_at`
  - timestamp of successful vector generation

- `status`
  - enum baseline: `ready` | `stale` | `failed`
  - allows safe bookkeeping without inventing a large job system yet

#### Embedding Record Rules

1. The embedding record must not inline the vector itself if the storage backend prefers an external vector table or repository.
2. `embedding_id` must be deterministic from asset identity, representation kind, and model identity.
3. There may be multiple embedding rows per asset over time, but only one active `ready` row per `(asset_id, representation_kind, embedding_model)`.
4. `content_fingerprint` must change when extraction settings that affect embeddings change.
5. Failed indexing attempts may be tracked by `status`, but should not require storing media payloads.

## MVP Indexing Baseline

The MVP should not assume a filesystem-based photo library or any exported media copies.

Baseline indexing path:

1. enumerate assets from Apple Photos after permission is granted
2. request a small thumbnail or lightweight representation for each asset
3. feed the representation directly to the embedding provider in-memory
4. persist only vectors and `localIdentifier` links in the local database

This keeps storage tiny and avoids duplicating the source Photos library, including iCloud-backed originals.

For the current end of Phase 3, the runtime now includes:

1. an `index` command that defaults to a local cache read from the catalog/vector repositories when cache data exists
2. a `reindex` command that forces `scan -> extract -> normalize -> persist` using the existing Photos bridge plus the JSON catalog plus `Qdrant` vector backend

Passing `--no-cache` on `index` uses the same forced refresh path as `reindex`. The Phase 4 baseline now routes in-memory representations through the embedding provider abstraction before persisting vectors into `Qdrant`, including batched image-thumbnail and video-storyboard indexing without temporary files, while search and cache reads still accept legacy `video-poster-frame` rows so storage shape and re-index identity behavior stay stable during rollout.

The current Phase 4 read path now also includes semantic search through the configured vector backend: Node normalizes the query text, asks the embedding provider for a text vector under the same model identity used during indexing, then queries `Qdrant` for active image/video embeddings before handing results to later album-write steps.

The current CLI milestone wraps that retrieval path in a dedicated `search` command: the command loads config plus local stores, runs semantic ranking, then immediately hands the ranked results to the album write-back flow so search review remains native to Photos.

For the first provider implementation, the execution mode is local-first on Apple Silicon hardware. The provider interface should remain portable so a remote embedding service can be added later without changing indexing or retrieval contracts.

## Deterministic Identity Baseline

For MVP setup, asset identity should be anchored on `PHAsset.localIdentifier`.

If an internal record id is needed, it should be derived deterministically from `localIdentifier`, not from exported file paths or generated preview assets.

### Deterministic Asset Identity v1

The canonical source identity is the exact `PHAsset.localIdentifier` returned by the Photos framework.

Derived ids should use the following baseline:

```text
canonical_local_identifier = raw PHAsset.localIdentifier
asset_id = "asset:" + sha256(canonical_local_identifier)
```

### Identity Rules

1. `PHAsset.localIdentifier` is the only source-of-truth asset identity for MVP.
2. The runtime must preserve the exact original `localIdentifier` string for storage and write-back.
3. `asset_id` exists only as a deterministic internal key derived from `localIdentifier`.
4. No identity may be derived from filenames, filesystem URLs, iCloud download paths, thumbnail caches, or export artifacts.
5. Re-indexing must treat the same `localIdentifier` as the same asset, even if thumbnails, dimensions, or cloud state change later.
6. If Photos reports a different `localIdentifier`, that must be treated as a different asset unless a later migration rule is explicitly introduced.

### Identity Boundary

- `local_identifier`
  - external/native identity used at the Photos boundary

- `asset_id`
  - internal deterministic join key for storage and retrieval contracts

- `embedding_id`
  - deterministic representation identity under one model

- `result_id`
  - deterministic query-result identity, not a source asset identity

## Photos Bridge Boundary

For MVP setup, the runtime architecture is:

```text
Node.js CLI
  -> Python photos-bridge
    -> PyObjC
      -> Photos framework on macOS
```

The Node.js CLI remains the primary orchestration surface. All direct interaction with the macOS Photos framework is delegated to a local Python bridge built on PyObjC.

### Why This Boundary Exists

1. Photos framework access is native-macOS-specific and should stay isolated from the Node CLI.
2. TCC permission prompting and Photos object handling are easier to reason about behind one bridge boundary.
3. The rest of the runtime should speak in plain JSON-like contracts, not Objective-C or PyObjC objects.

### Boundary Responsibilities

- Node.js CLI
  - owns command parsing, config loading, orchestration, storage, and retrieval flow
  - never imports Photos framework directly

- Python photos-bridge
  - owns all direct Photos framework calls
  - owns permission checks, asset enumeration, in-memory extraction, iCloud-aware fetch requests, and album mutations

- Shared contract between Node and Python
  - plain JSON over stdout/stdin or structured process output
  - only serializable values cross the boundary

### Photos Permission Boundary

1. TCC permission state is queried and requested only inside the Python bridge.
2. Node receives normalized statuses such as `authorized`, `limited`, `denied`, `not_determined`, or `restricted`.
3. Node decides user-facing CLI behavior, but it does not implement native permission calls itself.

### Library Access Boundary

1. Only the Python bridge may create, inspect, or retain Photos framework objects such as `PHAsset`.
2. Node must never rely on object handles, pointer identities, or filesystem locations from Photos.
3. The bridge must convert native assets immediately into normalized serializable records.

## Direct Photos Connection Workflow

The project connects directly to Apple Photos on macOS through the Photos framework access path, not through a mirrored library folder.

### Workflow

1. User runs a CLI command in Node.js.
2. Node loads config and invokes the Python photos-bridge command for the requested operation.
3. The Python bridge checks Photos authorization status.
4. If authorization is missing, the bridge triggers the native Photos permission flow.
5. The CLI exposes a dedicated `photos request-access` command so permission prompting is explicit, testable, and separate from later scan/extract work.
6. After authorization, the bridge queries the Photos framework for assets, representations, or albums.
7. The bridge returns normalized data back to Node for indexing or retrieval orchestration.

### No Filesystem Mirror Rule

1. The runtime must not scan the Photos library package on disk as its source of truth.
2. The runtime must not require the user to export Originals or maintain a mirrored media folder.
3. iCloud-backed assets must be accessed through Photos-managed requests rather than by assuming local file presence.

## In-Memory Representation Strategy

The extraction path must remain RAM-only for both image thumbnails and video representations.

### Image Thumbnail Strategy

1. The Python bridge requests a small thumbnail from Photos for each image asset.
2. The target default size is `224x224`, configurable through the config file.
3. The bridge converts the result into an in-memory byte payload or array buffer equivalent.
4. The bridge returns the payload and minimal metadata to Node without persisting preview files.

### Video Representation Strategy

1. The Python bridge requests a lightweight video-derived representation through Photos-managed APIs.
2. The first baseline representation kind is `video-storyboard`, built from multiple in-memory frames from the same Photos-managed AVAsset path.
3. `video-poster-frame` remains a supported legacy representation kind for already-indexed data and debug fallback.
4. If the representation is generated from AV/Photos APIs, it must still remain in-memory and temporary.
5. Node receives only the representation payload required for embedding plus minimal metadata.

### RAM-Only Rules

1. No thumbnail image file may be written to SSD as part of the normal extraction path.
2. No temporary video proxy or exported clip may be persisted to SSD as part of the MVP path.
3. If a native API internally streams or downloads data, the project still treats the extraction as valid as long as the app does not create its own persisted media artifact.
4. Diagnostics may log metadata about extraction, but not raw media payloads by default.

## iCloud-Backed Asset Strategy

The project assumes originals may live in iCloud and still treats Apple Photos as the only supported access path.

### Strategy

1. The Python bridge requests asset data through Photos APIs with network-backed retrieval allowed when config permits it.
2. Asset enumeration should not fail just because the original is not fully local.
3. Extraction requests should prefer lightweight representations that Photos can resolve without requiring a full manual export workflow.
4. The bridge should surface whether an asset appears cloud-backed via `is_in_icloud` when that state is cheaply available.
5. The MVP bridge may first prove this path through a dedicated original-access probe that requests a bounded in-memory data stream from `PHAssetResourceManager` and cancels after enough bytes arrive.

### Fallback Behavior

1. If an iCloud-backed representation is temporarily unavailable, the bridge should return a structured failure or retryable status, not silently drop identity.
2. The asset record should still remain keyed by the same `localIdentifier`.
3. Re-index logic may mark the embedding as `failed` or `stale`, but should not create a duplicate asset row.

## Photos Album Write-Back Workflow

Search review happens by writing matching assets into the album `AI Search Results` inside Apple Photos.

### Workflow

1. Node retrieval flow produces result rows containing `local_identifier` and `album_name`.
2. Node invokes the Python bridge album command with the target album name and ordered `local_identifier` list.
3. The Python bridge looks up an existing user album with that name.
4. If the album does not exist, the bridge creates it through the Photos framework.
5. Based on `album_write_mode`, the bridge refreshes the album contents deterministically.
6. The bridge resolves each `local_identifier` back to a `PHAsset` and adds the matching assets to the album.
7. The bridge returns a normalized summary including album name, requested asset count, applied asset count, and any unresolved identifiers.

If `retriever.write_to_photos_results_album` is `false`, the search workflow must still produce ranked retrieval results and debug output, but it should skip the native Photos album mutation step entirely.

The current Phase 4 baseline now covers this full workflow shape: a dedicated bridge command can ensure the target album exists, resolve ordered `local_identifier` values back to `PHAsset`, and return a normalized mutation summary after album write-back.

The Node-side album output flow now prepares and executes the second-half mutation contract: it consumes retrieval results directly, preserves rank order while deduplicating `local_identifier` values, carries the configured `album_write_mode`, submits the payload to the Python bridge over stdin, and surfaces unresolved rows that still need CLI/debug handling.

### Album Write-Back Rules

1. Album mutation happens only inside the Python bridge.
2. The write-back contract uses `local_identifier` values, not file paths or exported copies.
3. The default MVP behavior is `replace` so the album reflects the current search result set deterministically.
4. Failure to resolve some assets must be reported explicitly to Node for CLI output and debug.
5. The album is a review surface only; it is not an alternative storage backend.

## Safe Re-Index Strategy

Re-indexing should be deterministic, conservative with identity, and resilient to temporary extraction failures from iCloud-backed assets.

### Goal

1. Reuse the same asset identity whenever `PHAsset.localIdentifier` is unchanged.
2. Refresh embeddings only when low-cost source signals or representation settings imply that the old embedding may be stale.
3. Avoid dropping searchable assets from the active index merely because a temporary fetch or extraction step failed.

### Re-Index Inputs

The decision to re-index an asset should use low-cost metadata gathered during scanning:

- `local_identifier`
- `asset_type`
- `pixel_width`
- `pixel_height`
- `duration_seconds` when relevant
- `modification_date` when available
- extraction settings that affect the representation, such as thumbnail size or representation kind
- embedding model identity

These values feed two fingerprints:

```text
source_fingerprint = hash_or_compact_string(
  local_identifier,
  asset_type,
  pixel_width,
  pixel_height,
  duration_seconds,
  modification_date
)

content_fingerprint = hash_or_compact_string(
  source_fingerprint,
  representation_kind,
  extraction_settings,
  embedding_model
)
```

### Asset State Comparison

For each scanned asset:

1. If `local_identifier` is new, create a new asset row and schedule indexing.
2. If `local_identifier` already exists and `source_fingerprint` is unchanged, keep the existing asset row.
3. If `source_fingerprint` changed, keep the same asset row but mark related embeddings as candidates for refresh.
4. If the configured extraction settings or embedding model changed, embeddings must also be considered refresh candidates even when `source_fingerprint` is unchanged.
5. The active read path must scope cache hits and vector queries by full `model_identity`, not only by `embedding_model`, so rollback to a baseline preset never reuses upgraded vectors by mistake.

### Embedding Refresh Policy

1. If there is no existing `ready` embedding for the active `(asset_id, representation_kind, embedding_model)`, schedule extraction and embedding generation.
2. If the stored `content_fingerprint` differs from the newly computed target fingerprint, schedule re-embedding.
3. If a refresh succeeds, write the new embedding row or update the existing active row and mark it `ready`.
4. If a refresh fails temporarily, keep the prior `ready` embedding searchable and mark the new refresh attempt state as `stale` or retryable rather than removing the asset from the active index.
5. Embedding rows should also retain rollout metadata such as `candidate_preset`, `target_resolution`, and `extraction_signature` so debug and rollback evidence remain operator-readable.

### Temporary Failure Rule

When an asset keeps the same `PHAsset.localIdentifier` but a new extraction attempt fails temporarily:

1. retain the previous successful embedding as the active searchable record
2. mark the asset or attempted embedding refresh as `stale`
3. record enough metadata to retry later
4. do not create a duplicate asset row
5. do not clear the existing searchable result solely because iCloud delivery or extraction was temporarily unavailable

This is the default MVP policy for iCloud-backed instability.

### Missing And Orphan Handling

1. If an asset is seen in the current scan, update `last_seen_at`.
2. If an existing asset is not seen in the current full scan, do not delete it immediately.
3. Instead, mark it as missing-or-orphan candidate through scan bookkeeping and require a later confirming scan before removal from the active catalog.
4. Only after confirmation should the runtime mark related embeddings inactive or remove them from the active search set.

### Full-Scan Safety Rule

Orphan detection should only happen after a scan that the runtime considers complete enough to trust.

If a scan was interrupted, permission-limited, or otherwise partial, it must not be used to conclude that unseen assets were deleted from the Photos library.

### Re-Index Outcome States

- `ready`
  - current embedding is valid for the active model and representation settings

- `stale`
  - previously valid embedding is being kept active because source metadata changed or refresh failed temporarily

- `failed`
  - no valid embedding is currently available for the requested representation/model pair

### Re-Index Rules

1. `local_identifier` continuity always wins over transient extraction failures.
2. Re-index decisions must use metadata and config-driven fingerprints, not filesystem timestamps or export artifacts.
3. A temporary iCloud or extraction failure must not silently erase previously searchable content.
4. Deletion or orphan cleanup must require stronger evidence than one failed or partial scan.
5. The system should prefer deterministic refresh behavior over aggressive cleanup.

## Retrieval Output Contract

Retrieval output v1 should be agent-oriented, stable, and easy to print in CLI output.

### Retrieval Result Schema v1

```json
{
  "result_id": "result:sha256(query_hash|embedding_id|rank)",
  "local_identifier": "A1B2C3/L0/001",
  "asset_id": "asset:sha256(localIdentifier)",
  "asset_type": "image",
  "embedding_id": "embedding:sha256(asset_id|representation_kind|model_key)",
  "representation_kind": "image-thumbnail",
  "score": 0.8421,
  "rank": 1,
  "album_name": "AI Search Results",
  "match_evidence": {
    "query_text": "bãi biển lúc hoàng hôn",
    "strategy": "semantic-vector",
    "model": "ViT-B-32",
    "notes": [
      "top similarity match",
      "image-thumbnail representation"
    ]
  },
  "debug": {
    "source_fingerprint": "2026-06-10T08:00:00.000Z|4032|3024|image",
    "embedding_dimensions": 1024,
    "indexed_at": "2026-06-17T09:00:00.000Z"
  }
}
```

### Retrieval Result Fields

- `result_id`
  - stable result instance id for one query/result pair
  - useful for CLI logs and future agent references

- `local_identifier`
  - required payload for Photos album write-back

- `asset_id`
  - deterministic internal asset key

- `asset_type`
  - enum: `image` | `video`

- `embedding_id`
  - points to the embedding row that produced the match

- `representation_kind`
  - explains which media representation matched the query

- `score`
  - normalized numeric relevance score

- `rank`
  - 1-based position in the returned result set

- `album_name`
  - target Photos album for the review workflow

- `match_evidence`
  - compact explanation object for AI-agent and CLI debug use
  - starts with query text, retrieval strategy, model identity, and short notes

- `debug`
  - optional non-essential diagnostics
  - must remain safe to omit from user-facing output

### Retrieval Result Rules

1. Every result must include `local_identifier`, `asset_type`, `score`, and `album_name`.
2. `score` should be comparable within one result set, even if absolute semantics differ by backend later.
3. `match_evidence` should explain the match without requiring raw vector data.
4. The result payload must not include thumbnail bytes, video payloads, or filesystem export paths.
5. The album write path should be able to operate from retrieval results alone, without refetching unrelated metadata first.

## Design Constraint

The storage interface should not assume one vector backend forever. Start simple, keep the indexing contract portable, and never turn the database into a mirrored copy of the Photos library or an on-disk cache of iCloud originals.
