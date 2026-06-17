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
  cli/
  config/
  scanner/
  extractor/
  enrichment/
  indexer/
  retriever/
  storage/
  shared/
```

### Folder Responsibilities

- `src/cli/`
  - owns command entrypoints, argument parsing, and output formatting
  - calls into lower layers but should not absorb media-processing rules

- `src/config/`
  - owns project config loading, defaults, validation, and path resolution
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

- `src/shared/`
  - owns small cross-cutting utilities, shared types, and common helpers
  - should remain minimal so layer boundaries stay clear

## Layout Rules

1. Each of the five core concerns gets exactly one primary top-level folder.
2. Cross-cutting code goes to `config`, `storage`, or `shared`, not into an arbitrary core layer.
3. CLI concerns stay in `src/cli/` so the project remains CLI-first without coupling commands to indexing internals.
4. Optional future surfaces such as HTTP or Electron should be added later as peer folders, not by reshaping the five core processing folders.
5. No layer may persist thumbnail image files or preview caches to local disk in the MVP path.

## Storage Shape

### Asset record

- one row per Photos asset
- stores `PHAsset.localIdentifier`
- stores asset type such as image or video
- may store only the smallest additional metadata needed for debug, iCloud-aware fetch behavior, or re-index safety

### Embedding record

- one row per indexed image or video representation
- linked to an asset through `localIdentifier`

## MVP Indexing Baseline

The MVP should not assume a filesystem-based photo library or any exported media copies.

Baseline indexing path:

1. enumerate assets from Apple Photos after permission is granted
2. request a small thumbnail or lightweight representation for each asset
3. feed the representation directly to the embedding provider in-memory
4. persist only vectors and `localIdentifier` links in the local database

This keeps storage tiny and avoids duplicating the source Photos library, including iCloud-backed originals.

For the first provider implementation, the execution mode is local-first on Apple Silicon hardware. The provider interface should remain portable so a remote embedding service can be added later without changing indexing or retrieval contracts.

## Deterministic Identity Baseline

For MVP setup, asset identity should be anchored on `PHAsset.localIdentifier`.

If an internal record id is needed, it should be derived deterministically from `localIdentifier`, not from exported file paths or generated preview assets.

## Retrieval Output Contract

Retrieval output v1 should be agent-oriented and stable. Each result should include:

1. stable ids
2. `localIdentifier`
3. asset type
4. score
5. target album information
6. optional debug context
7. concise match evidence

## Design Constraint

The storage interface should not assume one vector backend forever. Start simple, keep the indexing contract portable, and never turn the database into a mirrored copy of the Photos library or an on-disk cache of iCloud originals.
