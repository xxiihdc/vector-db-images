# Implementation Plan: Stronger Embedding Model Upgrade

**Branch**: `[main]` | **Date**: 2026-06-18 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-stronger-embedding-model/spec.md`

## Summary

Upgrade the current embedding stack from the baseline `open-clip:ViT-B-32:laion2b_s34b_b79k` toward the strongest OpenCLIP-compatible model that is still stable on Duc's Apple Silicon workflow. The plan is to add a benchmark ladder, improve capability probing, validate higher-resolution candidates, and only roll forward after bounded real-library evidence shows better search quality with acceptable local latency and memory behavior.

## Technical Context

**Language/Version**: Node.js `>=22`, Python 3, PyObjC bridge, OpenCLIP Python runtime

**Primary Dependencies**: `open_clip_torch`, `Pillow`, `Qdrant`, Photos framework via PyObjC; likely `timm` and possibly `transformers` for newer OpenCLIP model families

**Storage**: Local JSON catalog plus local Qdrant vector store

**Testing**: `node --test`, repo verify scripts, bounded CLI smoke runs, and real-library benchmark queries on macOS

**Target Platform**: macOS on Apple Silicon, especially MacBook Air

**Project Type**: CLI-first local application with a Python native bridge

**Performance Goals**: Improve retrieval quality while keeping indexing and query latency practical for local use; smoke candidate models on bounded workloads before any full-library rollout

**Constraints**: Local-first only, no temporary media exports to SSD, no remote embedding service, must preserve deterministic model identity and safe rollback

**Scale/Scope**: Model-selection workflow, config/runtime updates, extractor-size tuning, benchmark instrumentation, and rollout documentation for one embedding-provider family

## Constitution Check

The Spec Kit constitution file is still an unfilled template, so it cannot serve as a meaningful gate yet. For this plan, apply the active repository rules from `AGENTS.md` as the effective constitution:

- Pass: stays CLI-first and local-first
- Pass: keeps Photos as source of truth and review surface
- Pass: keeps extraction in-memory and avoids SSD media caches
- Pass: improves search quality and can improve indexing reliability through better probes and controlled rollout
- Watch item: larger models may hurt throughput on MacBook Air, so rollout must be benchmark-gated instead of config-only

## Project Structure

### Documentation (this feature)

```text
specs/001-stronger-embedding-model/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
└── contracts/
    └── model-upgrade-contract.md
```

### Source Code (repository root)

```text
src/
├── cli/
│   └── commands/
├── config/
│   └── defaults/
├── embedding/
│   ├── providers/
│   │   └── open-clip/
│   └── create-provider.js
├── extractor/
├── indexer/
│   └── pipeline/
├── retriever/
│   └── query/
└── storage/
    └── vector/

python/
├── embedding_bridge/
└── requirements.txt

scripts/
tests/
```

**Structure Decision**: Keep the existing provider abstraction and bridge architecture. Add model-selection and benchmark support inside the current `embedding`, `cli`, `config`, and `indexer` surfaces instead of introducing a new runtime layer.

## Phase Plan

### Phase 0 - Candidate Research And Benchmark Design

1. Confirm the current baseline behavior and record its config, throughput, and search quality observations.
2. Define a candidate ladder from strongest to safest fallback:
   - Stretch: `PE-Core-bigG-14-448`
   - High-end fallback: `ViT-gopt-16-SigLIP2-384`
   - Safer high-quality fallback: `ViT-H-14-378-quickgelu`
   - Minimal-churn fallback: `ViT-H-14`
3. Map each candidate to expected runtime risks:
   - extra dependencies
   - first-run download size
   - higher input resolution
   - MPS memory pressure
4. Choose a bounded benchmark protocol:
   - same asset subset per run
   - same query pack per run
   - same reporting format for latency, failures, and quality notes

### Phase 1 - Runtime And Contract Changes

1. Expand the embedding capability probe to report:
   - selected device
   - model load success/failure
   - dependency gaps such as `timm` and `transformers`
   - recommended extractor size for the configured candidate
2. Add a first-class benchmark or dry-run command path so candidate evaluation is reproducible.
3. Ensure config supports candidate presets or explicit tuples without hand-edit ambiguity.
4. Preserve model identity separation in vector queries and rollout logic.
5. If a candidate requires `384` or `448` inputs, update extractor sizing and batching rules together instead of changing only the model string.

### Phase 2 - Validation And Rollout

1. Run capability probes for every candidate from strongest downward.
2. Run bounded indexing smoke tests only for candidates that pass probing.
3. Run a fixed search query pack and compare quality against baseline.
4. Pick the strongest candidate that passes:
   - stability gate
   - practical latency gate
   - memory gate
   - relevance gate
5. Document final rollout, rollback, and full re-index guidance.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| Higher-resolution extraction for some candidates | Stronger models often expect `378` to `448` inputs for best quality | Changing only the model string would underfeed the model and hide the real quality/latency tradeoff |
