# Product Notes

## Problem

Keyword search in Apple Photos is not enough when the user wants to find images or videos by semantic meaning in natural language.

The project needs a local CLI workflow that can search a Photos library semantically, even when original assets live in iCloud, without duplicating the library onto disk.

## Primary Users

1. a human user searching their Apple Photos library from Terminal
2. a local automation or agent workflow that needs a stable way to resolve semantic image or video queries into Photos assets

## Core Jobs To Be Done

1. access Apple Photos locally after the user grants macOS Photos permission
2. read directly from the macOS Photos app access layer, including assets whose originals are stored in iCloud
3. turn Photos thumbnails or lightweight video representations into searchable vectors without writing media copies to disk
4. let the user run an indexing command on demand from Terminal
5. let the user search in natural language from Terminal
6. push matching assets into a Photos album so review happens in the native app

## Must-Have Retrieval Output

Each result should eventually be able to return:

1. `PHAsset.localIdentifier`
2. score
3. enough metadata to add the asset into `AI Search Results`
4. asset type such as image or video
5. optional debug context useful for CLI inspection

## MVP Decisions

1. The first MVP targets both images and videos stored in Apple Photos.
2. The app must run entirely locally on a MacBook Air with Apple Silicon.
3. The first usable retrieval surface is `CLI only`.
4. The first embedding provider is local-first on Apple Silicon; remote providers stay out of MVP.
5. Extraction must stay in-memory and must not create preview files or media proxies on SSD.
6. The database should store only vectors and `PHAsset.localIdentifier`, with as little extra state as possible.
7. Search results should be surfaced by updating a Photos album named `AI Search Results`.
8. Apple Photos on macOS is the only supported source of truth; originals may reside in iCloud.
9. Runtime code organization starts with explicit folders for `scanner`, `extractor`, `enrichment`, `indexer`, and `retriever`, with CLI/config/storage concerns kept separate.
10. Runtime setup starts with one local config file, `media-vector-index.config.json`, instead of multiple env-driven surfaces.
11. The primary runtime shape is `Node.js CLI + Python photos-bridge`, where the Python bridge owns all direct Photos framework access through PyObjC.

## Retrieval Surface Decision

For the first MVP, retrieval will be exposed through CLI commands only.

We are explicitly not adding a local HTTP API during project setup. A local HTTP API can be reconsidered later if a concrete integration need appears for downstream agents or external tooling.

## Semantic Indexing Decision

For the first MVP, semantic retrieval covers both images and videos and must not depend on exported media files on disk.

The baseline path is:

1. request a thumbnail or lightweight representation from Apple Photos for each asset
2. feed that representation directly into a local multimodal embedding model
3. persist only the vector and its linked `PHAsset.localIdentifier`

The first implementation target is a local multimodal provider that can run on Apple Silicon. Remote embedding services may be added later behind the same interface, but are not part of MVP setup.

For re-index safety, the MVP should keep the previous successful embedding searchable when the same asset still has the same `PHAsset.localIdentifier` but a fresh extraction attempt fails temporarily.

## Photos Integration Decision

The MVP should use Apple Photos as both the source library and the review surface.

The baseline path is:

1. request Photos permission through the native macOS privacy flow
2. read asset identifiers and in-memory representations through Photos APIs on macOS
3. handle assets whose originals are stored in iCloud through the normal Photos access path rather than a filesystem export flow
4. write search results back by creating or updating a Photos album

This keeps the workflow native and avoids building a redundant image browser.

For the current MVP phase, the CLI now exposes a dedicated permission-request step so the user can intentionally trigger the Photos TCC flow before running full asset traversal.

For the current ingestion milestone, the CLI exposes both an original-access probe and an extraction probe, and now also:

1. an `index` command that defaults to reading from the local catalog/vector cache when present
2. a `reindex` command that forces a refresh path against the current Photos library state without creating duplicate asset or embedding rows

Passing `--no-cache` on `index` forces the same refresh path as `reindex`.

At this stage, the index pipeline is wired through a real embedding provider abstraction. The first configured path is `open-clip`, and its pretrained checkpoint can be downloaded automatically on first use when the machine has internet access.

The working debug flow should start with a lightweight capability probe so dependency or runtime mismatches are separated from extraction logic failures early.

For long-running full-library indexing, the Photos bridge should not behave like a black box: native extraction progress is expected to stream live to the terminal so the user can tell whether the bottleneck is a specific asset, video poster-frame generation, or simple scale.

For the same workflow, the index command should also avoid requesting one monolithic extraction payload from the bridge; extraction must be chunked so large libraries do not fail purely on bridge transport size.

The MVP indexing flow should preserve completed work across partial failures by checkpointing each chunk into local storage before the next chunk starts.

For local sidecar performance, vector persistence to `Qdrant` should prefer bulk chunk writes over one-request-per-embedding persistence.

The same local-first workflow should tolerate short `Qdrant` sidecar transport hiccups by retrying sub-batch writes before treating the chunk as failed.

## Retrieval Contract v1

Each retrieval result returned to an AI agent should include:

1. `result_id`
2. `local_identifier`
3. `asset_type`
4. `album_name`
5. `score`
6. optional debug metadata
7. `match_evidence` summarizing why this result matched

Ở milestone hiện tại của Phase 4, local semantic search core đã chạy được trên `Qdrant` local sidecar cho cả ảnh và video bằng cách:

1. normalize text query ở Node runtime
2. embed query bằng cùng provider/model identity dùng lúc indexing
3. query vector backend theo cùng model identity rồi nhận top matches từ ANN/vector index backend
4. trả về retrieval result đủ `local_identifier` để nối tiếp sang album write-back ở bước sau

Ở cùng giai đoạn này, runtime cũng đã có path riêng để tạo hoặc tìm lại album `AI Search Results` trong Apple Photos.

Album output flow hiện cũng đã có Node-side orchestration đủ để:

1. nhận retrieval results
2. ensure target album đã tồn tại
3. chuẩn hóa ordered unique `local_identifier` list cho write-back
4. gọi native Photos album mutation qua Python bridge để resolve `PHAsset` và update album theo `album_write_mode`
5. giữ lại unresolved result rows để CLI/debug path báo rõ asset nào không resolve được

CLI milestone hiện tại đã nối hai nửa đó lại thành command `search <query>`:

1. nhận natural-language query từ Terminal
2. chạy semantic query trên vector backend hiện có
3. write kết quả match trở lại album `AI Search Results`
4. in debug output gồm query text, counts, top match, và unresolved write-back rows

For MVP setup, the runtime also defines two storage-facing contracts:

1. an `asset record` keyed by deterministic `asset_id` plus `PHAsset.localIdentifier`
2. an `embedding record` keyed by deterministic `embedding_id` and linked back to the asset record

For the current repository milestone, the local catalog stays JSON-backed for asset metadata, while semantic vector persistence and lookup now run through a local `Qdrant` backend behind repository interfaces. This keeps the Photos-facing data model lightweight while moving ANN/vector search out of the app layer.

## Non-Goals

1. transcript or caption ingestion
2. exporting the Photos library to a mirrored local folder
3. storing thumbnail files, preview caches, or video proxy caches on disk
4. building a separate desktop browsing app for MVP
5. requiring a non-Photos source library for MVP
