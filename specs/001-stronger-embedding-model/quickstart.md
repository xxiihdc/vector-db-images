# Quickstart: Stronger Embedding Model Upgrade

## Goal

Pick the strongest embedding model that is still practical on Duc's Apple Silicon workflow.

## Baseline

1. Confirm current config uses:
   - provider: `open-clip`
   - model: `ViT-B-32`
   - pretrained: `laion2b_s34b_b79k`
2. Run the existing embedding capability probe.
3. Record one bounded baseline indexing run and one fixed search query pack.

## Candidate Order

1. `PE-Core-bigG-14-448`
2. `ViT-gopt-16-SigLIP2-384`
3. `ViT-H-14-378-quickgelu`
4. `ViT-H-14`

## Proposed Execution Flow

1. Add stricter capability probing for model load, dependencies, device, and recommended extractor size.
2. For each candidate in order:
   - run the capability probe
   - if probe fails, record the reason and continue
   - if probe passes, run a bounded indexing smoke test
   - if smoke test passes, run the fixed search query pack
3. Select the strongest candidate that passes quality and stability gates.
4. Update config defaults, sample config flow, and rollout docs only after a winner is selected.

## Candidate Probe Command

Probe the currently configured candidate before any long indexing run:

```bash
node ./src/cli/main.js embedding capabilities --json
```

Probe all configured ladder rungs in order:

```bash
npm run verify:embedding
```

Each probe should report:

1. exact `model_identity`
2. resolved runtime device
3. whether the model actually loaded
4. missing `timm` or `transformers` dependencies when relevant
5. recommended extractor size for fair benchmarking
6. candidate-specific warnings that would invalidate a fair comparison

## Rejection Criteria

Reject a candidate before indexing if any of the following is true:

1. capability probe reports `ready = no`
2. model load fails during the probe
3. required dependency such as `timm` or `transformers` is missing
4. first-run model download is blocked and the local cache is not already warm
5. the candidate requires a higher extractor resolution than the current workflow is prepared to honor

## Benchmark Command

Run the ladder with a bounded subset and fixed query pack:

```bash
node ./src/cli/main.js embedding benchmark --asset-limit 50 --query-limit 5 --json
```

Choose a smaller candidate subset when a stretch rung is obviously too heavy:

```bash
node ./src/cli/main.js embedding benchmark --candidates baseline,high-end,fallback-strong --asset-limit 25
```

The command reads queries from:

```text
specs/001-stronger-embedding-model/benchmark-query-pack.json
```

Each run writes a machine-readable artifact to:

```text
specs/001-stronger-embedding-model/benchmark-results/
```

Each candidate result now records:

1. capability probe readiness and runtime device
2. recommended extractor size
3. bounded indexing status and throughput
4. average fixed-query search latency
5. top-hit quality notes per query

## Validation Focus

- no disk-based media exports
- no mixed-model confusion in vector lookup
- stable rollback path
- better retrieval quality than baseline
- practical latency on the local machine

## Latest Validation Snapshot

Current repository validation status as of `2026-06-18`:

1. `npm run verify:embedding`:
   - baseline `ViT-B-32 / laion2b_s34b_b79k` probes successfully
   - `PE-Core-bigG-14-448` is blocked by pretrained tag/download issues in the current environment
   - `ViT-gopt-16-SigLIP2-384` is blocked by missing `transformers`
   - `ViT-H-14-378-quickgelu` is blocked by pretrained weight download/cache access
   - `ViT-H-14` is blocked by pretrained weight download/cache access
2. `npm run verify:embedding-benchmark` is currently blocked in sandbox because local `Qdrant` is unreachable at `http://127.0.0.1:6333`.

## Current Winner And Fallback

Until Đức reruns the bounded benchmark on the real machine with `Qdrant` up and candidate dependencies installed:

1. current winning candidate: `baseline`
   - `open-clip:ViT-B-32:laion2b_s34b_b79k`
   - reason: this is the only candidate that both probes and loads successfully in the current validation environment
2. current fallback candidate for the next real-machine benchmark pass: `fallback-safe`
   - `open-clip:ViT-H-14:laion2b_s32b_b79k`
   - reason: it keeps the lowest migration complexity among stronger candidates once pretrained weights are locally available

## Real-Machine Next Step

On Đức's machine, use this order:

1. start local `Qdrant`
2. rerun `npm run verify:embedding`
3. install any missing dependency surfaced by the probe, especially `transformers` for `high-end`
4. rerun `npm run verify:embedding-benchmark`
5. if a stronger candidate clears both probe and bounded benchmark, promote it and keep `fallback-safe` as rollback target
