# Architecture Draft

## First Principle

Treat video as a collection of searchable segments, not only as a single file.

## Proposed Layers

1. `scanner`
   - walks folders
   - filters supported file types
   - computes stable source identity

2. `extractor`
   - image metadata extraction
   - video metadata extraction
   - duration, stream, and frame reference extraction

3. `enrichment`
   - transcript import when available
   - caption import or generation later
   - optional tagging

4. `indexer`
   - converts assets and segments into normalized records
   - writes catalog rows and vector rows

5. `retriever`
   - semantic search
   - filters by media type or path
   - returns agent-usable result payloads

## Storage Shape

### Asset record

- one row per media file
- stores path, hash or fingerprint, media type, and technical metadata
- stores or links to one or more embedding representations for semantic retrieval

### Segment record

- one row per searchable video segment
- stores source asset id, start time, end time, preview reference, and transcript snippet when available

### Embedding record

- one row per indexed textual or multimodal representation
- linked to asset or segment

## MVP Indexing Baseline

The MVP should not assume that source media comes with transcript or caption sidecars.

Baseline indexing path:

1. image assets: embed directly from source image content
2. video assets: embed from file-level representation plus derived segment representations
3. segment representations: start from deterministic time windows or keyframe-derived units, then enrich with transcript later if available

This keeps vector retrieval viable for AI agents from day one, while leaving transcript and caption support as additive quality improvements.

For the first provider implementation, the execution mode is local-first on Apple Silicon hardware. The provider interface should remain portable so a remote embedding service can be added later without changing indexing or retrieval contracts.

## Video Segmentation Baseline

The first segmentation strategy should be shot-aware.

Recommended baseline:

1. detect scene boundaries from visual changes
2. use those cuts as primary segment boundaries
3. enforce a maximum segment duration to split overly long scenes deterministically

This gives more precise retrieval units than pure fixed windows, while remaining predictable enough for re-indexing.

## Deterministic Identity Baseline

For MVP setup, asset identity should come from a deterministic hash over a normalized source descriptor:

1. normalized relative path from indexed root
2. filename
3. file size in bytes
4. media type
5. image dimensions or video duration

The resulting descriptor is hashed into `asset_id`.

This is a practical baseline for local-first ingestion. A stronger content-fingerprint strategy can replace or augment it later if needed.

Segment identity should be derived from:

1. `asset_id`
2. `segment_start_ms`
3. `segment_end_ms`

The concatenated descriptor is hashed into `segment_id`.

## Retrieval Output Contract

Retrieval output v1 should be agent-oriented and stable. Each result should include:

1. stable ids
2. absolute media path
3. media type
4. score
5. segment timing when applicable
6. preview reference
7. optional text context
8. concise match evidence

## Design Constraint

The storage interface should not assume one vector backend forever. Start simple, but keep the indexing contract portable.
