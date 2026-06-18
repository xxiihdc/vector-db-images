# Data Model: Stronger Embedding Model Upgrade

## Model Candidate

- `provider`
  - logical provider key, initially `open-clip`
- `model`
  - model architecture string, for example `ViT-H-14`
- `pretrained`
  - pretrained checkpoint identifier
- `target_resolution`
  - extractor image size intended for fair benchmarking
- `batch_size`
  - intended embedding batch size for smoke runs
- `requires_timm`
  - whether the candidate likely needs `timm`
- `requires_transformers`
  - whether the candidate likely needs `transformers`
- `tier`
  - `stretch`, `high-end`, `fallback`
- `status`
  - `planned`, `probe-passed`, `probe-failed`, `bench-passed`, `bench-failed`, `selected`, `rejected`

## Capability Probe Result

- `candidate_id`
  - deterministic identifier derived from provider/model/pretrained/resolution
- `runtime_device`
  - resolved runtime device such as `mps`, `cpu`, or `cuda`
- `load_ok`
  - whether the model loaded successfully
- `missing_requirements`
  - dependency or cache prerequisites not yet satisfied
- `notes`
  - human-readable remediation details
- `measured_at`
  - timestamp of the probe

## Benchmark Run

- `candidate_id`
  - links the run to a model candidate
- `asset_subset`
  - bounded set definition used for the run
- `query_pack`
  - fixed text and optional image queries used for comparison
- `indexing_status`
  - overall result of the bounded indexing run
- `indexing_items_per_second`
  - observed throughput
- `query_latency_ms`
  - observed retrieval latency for the query pack
- `failure_mode`
  - normalized failure classification if the run fails
- `quality_notes`
  - human observations about top hits, misses, and ranking behavior

## Rollout Decision

- `selected_candidate_id`
  - chosen model configuration
- `fallback_candidate_id`
  - safer alternative if the selected candidate regresses later
- `requires_full_reindex`
  - whether a complete re-index is needed before general use
- `rollback_steps`
  - concise operator steps to restore the previous stable config
- `docs_updated`
  - whether config and runbook docs were updated together with the rollout
