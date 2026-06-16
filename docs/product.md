# Product Notes

## Problem

An AI agent can only pick the right image or the right video clip if the media library is indexed into meaningful units with enough context.

Raw filenames and folders are not enough.

## Primary Users

1. a human operator preparing media for AI-driven workflows
2. an AI agent selecting source images or video segments for downstream generation, editing, or analysis

## Core Jobs To Be Done

1. ingest media folders without manual database work
2. make image assets searchable by meaning, not just filename
3. make videos searchable by segment and timestamp, with transcript as optional enrichment
4. let downstream agents retrieve the exact file and exact segment they should use

## Must-Have Retrieval Output

Each result should eventually be able to return:

1. asset id
2. absolute path
3. media type
4. score
5. preview reference
6. transcript or caption excerpt when available
7. segment start and end when media is video
8. stable metadata useful for follow-up agent actions

## MVP Decisions

1. Transcript/caption is optional enrichment, not a prerequisite for indexing.
2. The MVP must still index images and videos into a vector-oriented store even when no sidecar text exists.
3. The first usable retrieval surface is `CLI only`.
4. The first embedding provider is local-first on Apple Silicon; remote providers stay out of MVP.
5. Video segmentation starts with shot-aware cuts plus a max-duration fallback to preserve detail.
6. Retrieval output v1 is optimized for AI agents, not for human-only browsing.

## Retrieval Surface Decision

For the first MVP, retrieval will be exposed through CLI commands only.

We are explicitly not adding a local HTTP API during project setup. A local HTTP API can be reconsidered later if a concrete integration need appears for downstream agents or external tooling.

## Semantic Indexing Decision

For the first MVP, semantic retrieval cannot depend on transcript or caption files being present.

The baseline path is:

1. generate embeddings directly from image files
2. generate embeddings for video at asset level and segment level from derived visual representations
3. attach transcript or caption text later when it exists, as an enrichment layer that improves recall and agent context

The first implementation target is a local multimodal provider that can run on Apple Silicon. Remote embedding services may be added later behind the same interface, but are not part of MVP setup.

## Video Segmentation Decision

The first segmentation baseline should prioritize retrieval precision and detail over minimal implementation effort.

The baseline path is:

1. detect shot or scene boundaries first
2. keep those boundaries as primary candidate segments
3. split any segment that remains too long using a deterministic max-duration rule

This avoids the weakest parts of pure fixed-window segmentation while still guaranteeing bounded segment size for indexing and retrieval.

## Retrieval Contract v1

Each retrieval result returned to an AI agent should include:

1. `result_id`
2. `asset_id`
3. `absolute_path`
4. `media_type`
5. `score`
6. `segment_start_ms` and `segment_end_ms` when applicable
7. `preview_ref`
8. `text_context` when available
9. `match_evidence` summarizing why this result matched
