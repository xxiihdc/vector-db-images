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
3. make videos searchable by segment, transcript, and timestamp
4. let downstream agents retrieve the exact file and exact segment they should use

## Must-Have Retrieval Output

Each result should eventually be able to return:

1. asset id
2. absolute path
3. media type
4. score
5. preview reference
6. transcript or caption excerpt
7. segment start and end when media is video
8. stable metadata useful for follow-up agent actions

## Open Decisions

1. Will captions be generated locally, remotely, or imported from sidecars?
2. Will embeddings start with a hosted API or a local model?
3. Should the first usable retrieval surface be CLI only or also a small local HTTP API?
