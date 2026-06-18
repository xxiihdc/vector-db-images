# Contract: Model Upgrade Workflow

## Scope

This contract defines the expected operator-facing workflow for evaluating and rolling out a stronger embedding model.

## Configuration Contract

The embedding configuration must continue to expose at least:

- `embedding.provider`
- `embedding.model`
- `embedding.pretrained`
- `embedding.device`
- `embedding.normalize`
- `embedding.batch_size`

If higher-resolution candidates are supported fairly, the workflow must also define how extractor sizing is paired with the selected candidate.

## Capability Contract

Before bounded or full indexing begins, the CLI must be able to report:

- the exact model identity being tested
- the resolved runtime device
- whether the model loaded successfully
- missing dependencies or download/cache blockers
- any candidate-specific warning that affects fair benchmarking
- the recommended extractor size for the configured candidate

Capability probing must fail the candidate early when:

- the candidate cannot load on the current runtime
- a required dependency such as `timm` or `transformers` is missing
- first-run weight download or cache access is blocked
- the configured extraction resolution would underfeed the candidate and make the benchmark unfair

## Benchmark Contract

For every evaluated candidate, the workflow must capture:

- candidate identity
- asset subset used
- query pack used
- indexing success or failure
- throughput notes
- latency notes
- retrieval-quality notes

## Rollout Contract

The final rollout must not require manual storage repair. The documented workflow must make clear:

- how to switch to the selected model
- when re-indexing is required
- how to verify the new model before full adoption
- how to roll back to the last stable model if needed
