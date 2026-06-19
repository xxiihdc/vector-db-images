---
name: qdrant-benchmark-investigation
description: Use this skill when embedding benchmark or compare-only flows fail against Qdrant while reindex/search may still work, especially for model-switch, count/query instability, collection-scoping, or benchmark-specific vector backend regressions.
---

# Qdrant Benchmark Investigation

## Purpose

Use this skill for requests like:

- "điều tra lỗi benchmark embedding"
- "reindex chạy nhưng compare lỗi"
- "Qdrant chỉ vỡ ở benchmark"
- "phân tích log compare path"
- "fix bug benchmark path mà không phá kiến trúc"

This skill is for benchmark and compare-path diagnosis around the local Qdrant backend. It is not for generic Photos extraction debugging.

## Required Context

Before acting, read:

1. `AGENTS.md`
2. `README.md`
3. `docs/product.md`
4. `docs/architecture.md`
5. the latest diagnostic log in `logs/` referenced by the failing command

If the task is tied to model rollout, also read:

6. `specs/001-stronger-embedding-model/plan.md`

## What This Skill Focuses On

Common symptom pattern:

- `reindex` succeeds for a new model
- `embedding benchmark` fails
- error is in Qdrant read/count/query path, not in Photos extraction or model load

Common root-cause buckets:

1. collection scoping mismatch between legacy and per-model collections
2. benchmark-only request patterns such as extra `count` or `scroll`
3. Qdrant-side instability under compare-path request bursts
4. benchmark contract asking for metrics that are more expensive than necessary

## Workflow

1. Confirm whether the failure happens in:
   - extraction
   - embedding
   - persist
   - count
   - query
2. Separate `reindex` behavior from `embedding benchmark` behavior. If `reindex` passes and benchmark fails, treat the issue as compare-path-specific until proven otherwise.
3. Inspect the latest diagnostic log and identify:
   - failing command
   - Qdrant endpoint
   - whether the failing path is `count`, `scroll`, or `query`
4. Inspect recent Qdrant logs if available and compare:
   - requests that returned `200`
   - the exact endpoint that failed
   - whether the failure looks like app logic or backend/socket instability
5. Prefer low-debt fixes in this order:
   - reduce unnecessary compare-path requests
   - scope reads to the correct collection
   - push filtering down to Qdrant instead of post-filtering in Node
   - degrade gracefully only if the metric is non-critical
6. Before implementing a fix, assess:
   - is this a narrow bug or a benchmark-contract issue
   - will the fix increase coupling between benchmark logic and storage internals
   - does it risk hiding a real backend failure
7. If the clean fix is non-trivial, stop and give Đức a short decision memo before deep changes.

## Safety Rules

- Do not claim the model is bad if `reindex` works and only benchmark fails.
- Do not patch over backend errors by silently swallowing them unless the benchmark contract is explicitly changed.
- Prefer fixes that keep benchmark, search, and storage loosely coupled.
- Avoid introducing special-case logic that only one model candidate can use.

## Output Expectations

Prefer concise investigation notes with:

- latest confirmed symptom
- stage that fails
- whether runtime index path is healthy
- whether benchmark path is over-coupled or over-requesting
- recommended next action:
  - narrow fix
  - planned redesign
  - or defer pending Đức's decision
