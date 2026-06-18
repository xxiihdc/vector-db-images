# Research: Stronger Embedding Model Upgrade

## Decision 1: Keep the first upgrade within the existing OpenCLIP provider abstraction

- Decision: Stay on the existing `open-clip` provider for the next upgrade iteration instead of introducing a brand new embedding backend first.
- Rationale: The repo already supports configurable `provider`, `model`, and `pretrained` fields, and the Python bridge already loads models dynamically through `open_clip.create_model_and_transforms(...)`. This gives the fastest path to a real upgrade with the least architectural churn.
- Alternatives considered:
  - Add a new provider such as an MLX-native embedding backend first.
    - Rejected for now because it adds more unknowns than needed for the immediate search-quality upgrade.
  - Adopt a remote embedding service.
    - Rejected because it conflicts with the repo's local-first scope.

## Decision 2: Benchmark from the strongest official OpenCLIP-family candidate downward

- Decision: Use a top-down ladder instead of picking a single target blindly.
- Rationale: Official OpenCLIP documentation lists stronger models than the current baseline, but the strongest listed model is not automatically the strongest practical choice on a MacBook Air. The plan therefore starts with the strongest published candidate and falls back only when runtime evidence demands it.
- Alternatives considered:
  - Jump straight from `ViT-B-32` to `ViT-H-14`.
    - Rejected because it may leave quality gains on the table without first testing higher-end options.
  - Upgrade only by parameter count.
    - Rejected because published quality, input resolution, and runtime practicality matter more than size alone.

## Decision 3: Use this candidate ladder

1. `PE-Core-bigG-14-448`
   - Why first: OpenCLIP's README currently lists it among the strongest published image-language checkpoints with the highest zero-shot ImageNet result shown in the table.
   - Risk: highest memory, highest input resolution, most likely to be impractical on MacBook Air.
2. `ViT-gopt-16-SigLIP2-384`
   - Why next: also listed near the top of the same table and likely offers a better quality/performance balance than the stretch model.
   - Risk: newer model family may require extra runtime dependencies and higher-resolution extraction.
3. `ViT-H-14-378-quickgelu`
   - Why next: strong published quality with a simpler conceptual jump from the current CLIP-style baseline.
   - Risk: still much heavier than the current model.
4. `ViT-H-14`
   - Why fallback: lowest migration risk among clearly stronger options because it stays closer to the existing `224` pipeline.
   - Risk: may not deliver enough quality gain to justify re-index cost if higher tiers are actually workable.

## Decision 4: Couple model choice with extractor-size and batch-size policy

- Decision: Treat input resolution and batch size as part of the model upgrade plan, not as unrelated tuning knobs.
- Rationale: Several stronger candidates are optimized for `378`, `384`, or `448` resolution. Keeping `224` extraction while swapping only the model identifier could produce misleading benchmark results and hide the real upgrade cost.
- Alternatives considered:
  - Keep extractor size fixed at `224` for all candidates.
    - Rejected because it biases the evaluation against higher-resolution models.
  - Increase extractor size globally before benchmarking.
    - Rejected because it would blur baseline-versus-candidate comparisons.

## Decision 5: Make capability probing stricter before indexing

- Decision: Expand the capability probe before any long-running benchmark.
- Rationale: OpenCLIP's own documentation notes that some models need recent `timm`, and some text towers need `transformers`. Early detection saves time and makes model failures actionable.
- Alternatives considered:
  - Let the first indexing run discover dependency gaps.
    - Rejected because it wastes time and mixes install issues with model-quality evaluation.

## Decision 6: Keep the baseline as the provisional winner until real-machine benchmark evidence exists

- Decision: Do not promote a stronger candidate by default yet; keep `baseline` as the current winner and treat `fallback-safe` as the next real-machine fallback target.
- Rationale: Current repository validation shows the baseline model loads successfully, while stronger candidates are still blocked by dependency or pretrained-weight access issues in the sandbox environment. Promoting a stronger model without bounded benchmark evidence on Đức's actual machine would be speculation, not a safe rollout.
- Alternatives considered:
  - Promote `fallback-safe` immediately because it is conceptually the lowest-risk stronger model.
    - Rejected because its current probe still fails without pretrained weight availability.
  - Mark the feature incomplete until a stronger model is proven.
    - Rejected because the repo now contains the benchmark ladder, rollback-safe storage behavior, and preflight diagnostics needed for Đức to run the decisive machine-local test.

## Validation Snapshot On 2026-06-18

1. `npm run verify:embedding`
   - `baseline` loaded successfully
   - `stretch` failed probe due pretrained tag/download issues
   - `high-end` failed probe due missing `transformers`
   - `fallback-strong` failed probe due pretrained weight download/cache access
   - `fallback-safe` failed probe due pretrained weight download/cache access
2. `npm run verify:embedding-benchmark`
   - blocked before benchmark execution because local `Qdrant` was unreachable at `http://127.0.0.1:6333`

## Provisional Rollout Outcome

1. provisional winning candidate
   - `baseline`
   - `open-clip:ViT-B-32:laion2b_s34b_b79k`
2. provisional stronger fallback to retry first on the real machine
   - `fallback-safe`
   - `open-clip:ViT-H-14:laion2b_s32b_b79k`
3. promotion gate still required before any default-model change
   - local `Qdrant` reachable
   - candidate probe passes
   - bounded benchmark completes
   - relevance and latency look acceptable on Đức's Photos library

## Evidence

- Current repo baseline config: [media-vector-index.config.json](/Users/hoaiduc/Documents/VectorDB%20Image/media-vector-index.config.json:36)
- Current default config source: [src/config/defaults/config.js](/Users/hoaiduc/Documents/VectorDB%20Image/src/config/defaults/config.js:25)
- Current provider factory only supports `open-clip`: [src/embedding/create-provider.js](/Users/hoaiduc/Documents/VectorDB%20Image/src/embedding/create-provider.js:1)
- Current Python bridge dynamically loads `(model, pretrained)` and auto-selects `mps/cuda/cpu`: [python/embedding_bridge/bridge.py](/Users/hoaiduc/Documents/VectorDB%20Image/python/embedding_bridge/bridge.py:63)
- Official OpenCLIP README with model table and dependency notes:
  - https://github.com/mlfoundations/open_clip
  - https://raw.githubusercontent.com/mlfoundations/open_clip/main/README.md
