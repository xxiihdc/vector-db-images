# Feature Specification: Stronger Embedding Model Upgrade

**Feature Branch**: `[001-stronger-embedding-model]`

**Created**: 2026-06-18

**Status**: Draft

**Input**: User description: "lên plan để nâng cấp model mới xịn hơn, hãy thử với model mạnh nhất có thể"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Select The Strongest Stable Model (Priority: P1)

As Duc, I want the repo to benchmark stronger multimodal embedding models against the current baseline so we can upgrade retrieval quality without guessing.

**Why this priority**: Search quality is one of the top repo priorities, and model choice directly affects recall, ranking quality, and long-term usefulness of the CLI.

**Independent Test**: Can be fully tested by running a controlled benchmark flow on a representative subset of the real Photos library and comparing quality, throughput, and stability against the current baseline.

**Acceptance Scenarios**:

1. **Given** the current baseline model is configured, **When** a stronger candidate benchmark is executed, **Then** the system records whether the candidate improves retrieval quality while staying runnable on Apple Silicon.
2. **Given** multiple candidate models are available, **When** benchmarking completes, **Then** the system identifies the strongest candidate that satisfies local runtime and latency constraints.

---

### User Story 2 - Roll Forward Safely (Priority: P2)

As Duc, I want model upgrades to be explicit and reversible so we can try larger models without corrupting current search behavior or losing a stable rollback path.

**Why this priority**: Re-index cost is high, and an unsafe rollout could leave the local vector store in a mixed or degraded state.

**Independent Test**: Can be tested by switching to a candidate model, re-indexing a bounded subset, verifying model identity separation, and rolling back to the baseline config without manual storage surgery.

**Acceptance Scenarios**:

1. **Given** a stronger candidate uses a different model identity, **When** a bounded re-index runs, **Then** new vectors remain distinguishable from baseline vectors.
2. **Given** a candidate fails during capability probe or indexing, **When** rollback is triggered, **Then** the previous stable model can be restored via config and re-index workflow.

---

### User Story 3 - Detect Incompatibility Early (Priority: P3)

As Duc, I want capability checks to reveal model-specific runtime requirements before a long indexing job starts so we do not waste time on avoidable failures.

**Why this priority**: Large OpenCLIP-family models may need more memory, different image sizes, or extra Python libraries such as `timm` or `transformers`.

**Independent Test**: Can be tested by probing each candidate model before indexing and confirming the CLI reports missing dependencies, unsupported device paths, or download/cache blockers.

**Acceptance Scenarios**:

1. **Given** a candidate model requires unavailable runtime dependencies, **When** the capability probe runs, **Then** the CLI reports the missing dependency before indexing starts.
2. **Given** a candidate model exceeds practical memory or latency limits on the machine, **When** a smoke benchmark runs, **Then** the workflow marks the candidate as rejected and continues to the next fallback tier.

### Edge Cases

- First-run checkpoint download fails because the machine has no internet or no warmed cache.
- A high-resolution model requires larger input images than the current `224x224` extraction path provides.
- A candidate works for text queries but fails or times out on image/video embedding batches.
- MPS memory pressure causes intermittent failures partway through indexing.
- Baseline vectors already stored in Qdrant must remain searchable until the replacement model is proven stable.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST define a candidate ladder for embedding model upgrades, ordered from strongest target to safer fallback.
- **FR-002**: System MUST support probing each candidate model before large indexing runs begin.
- **FR-003**: System MUST preserve model identity boundaries so embeddings from different model configurations are not mistaken for one another.
- **FR-004**: System MUST support bounded benchmark runs on real Photos data before a full-library rollout.
- **FR-005**: System MUST capture benchmark evidence for each candidate, including capability status, indexing throughput, query latency, and retrieval-quality observations.
- **FR-006**: System MUST allow rollback to the last stable embedding configuration without manual vector-store repair steps.
- **FR-007**: System MUST document any required config, extractor-size, dependency, and verification changes for the selected upgrade path.
- **FR-008**: System MUST prefer the strongest candidate that remains stable on Duc's local Apple Silicon workflow, even if a theoretically larger model exists but is not practically usable.

### Key Entities *(include if feature involves data)*

- **Model Candidate**: A specific `(provider, model, pretrained, input resolution)` tuple proposed for benchmarking and possible rollout.
- **Capability Probe Result**: A record of whether a candidate can load, which runtime device it selects, and which dependencies or downloads block execution.
- **Benchmark Run**: A bounded indexing and search evaluation run for one candidate, including timing, failure mode, and quality notes.
- **Rollout Decision**: The final choice of candidate, fallback, and required code/config/doc changes to adopt it safely.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: At least one candidate stronger than the current `open-clip:ViT-B-32:laion2b_s34b_b79k` baseline is benchmarked on the real machine with recorded results.
- **SC-002**: The chosen upgrade path improves perceived search relevance on a representative query set without introducing blocker-level instability during bounded indexing runs.
- **SC-003**: The selected model can complete a smoke re-index workload on Apple Silicon without requiring disk-based media exports or a non-local embedding service.
- **SC-004**: Rollout and rollback steps are documented clearly enough that the upgrade can be repeated by another agent without rediscovering the workflow.

## Assumptions

- Duc wants to stay within the repo's local-first, CLI-first scope and does not want to introduce remote embedding services for this upgrade.
- Benchmarking quality on the real Photos library is more valuable than synthetic-only evaluation.
- The current OpenCLIP-based provider remains the shortest path for a first upgrade because the runtime already supports configurable `model` and `pretrained` values.
- If the strongest official OpenCLIP-family model is not practical on the MacBook Air, the repo should adopt the strongest stable fallback rather than force an unusable configuration.
