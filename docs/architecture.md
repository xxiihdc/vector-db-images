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
   - transcript import
   - caption import or generation
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

### Segment record

- one row per searchable video segment
- stores source asset id, start time, end time, transcript snippet, and preview reference

### Embedding record

- one row per indexed textual or multimodal representation
- linked to asset or segment

## Design Constraint

The storage interface should not assume one vector backend forever. Start simple, but keep the indexing contract portable.
