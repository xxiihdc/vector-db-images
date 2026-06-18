# Tasks: Stronger Embedding Model Upgrade

**Input**: Design documents from `/specs/001-stronger-embedding-model/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/model-upgrade-contract.md

**Tests**: Include targeted `node --test` coverage plus bounded CLI smoke and benchmark verification because the specification explicitly requires reproducible benchmark and rollback validation.

**Organization**: Tasks are grouped by user story so each story can be implemented and validated independently.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: Which user story this task belongs to (`[US1]`, `[US2]`, `[US3]`)
- Every task below includes the exact file path that should change

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Establish the model-upgrade scaffolding shared by all later work.

- [X] T001 Create the model candidate registry and benchmark constants in `src/embedding/providers/open-clip/model-candidates.js`
- [X] T002 [P] Add a benchmark report formatter for CLI output in `src/cli/formatters/embedding-benchmark-report.js`
- [X] T003 [P] Add a benchmark query pack and result artifact scaffold in `specs/001-stronger-embedding-model/benchmark-query-pack.json` and `specs/001-stronger-embedding-model/benchmark-results/.gitkeep`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core runtime and contract changes that must land before any user story work.

**⚠️ CRITICAL**: No user story work should start before this phase is complete.

- [X] T004 Extend embedding and extractor defaults for candidate preset, target resolution, and benchmark batch policy in `src/config/defaults/config.js`
- [X] T005 [P] Teach provider creation to resolve candidate metadata and stable model identity in `src/embedding/create-provider.js` and `src/embedding/providers/open-clip/provider.js`
- [X] T006 [P] Thread configurable extraction resolution and embedding batch policy through indexing flows in `src/indexer/pipeline/index-pipeline.js` and `src/indexer/pipeline/index-file-pipeline.js`
- [X] T007 [P] Extend the Python embedding bridge contract for candidate metadata, dependency checks, and recommended extractor sizing in `python/embedding_bridge/bridge.py`
- [X] T008 Add shared benchmark orchestration helpers for bounded asset subsets and fixed query packs in `src/app/search/run-embedding-benchmark.js`

**Checkpoint**: Foundation ready. User story implementation can now proceed without reworking shared config or bridge contracts.

---

## Phase 3: User Story 1 - Select The Strongest Stable Model (Priority: P1) 🎯 MVP

**Goal**: Let Duc run a controlled benchmark ladder that compares stronger candidates against the current baseline on the same bounded workload.

**Independent Test**: Run the benchmark command against a representative bounded subset and confirm it records candidate identity, capability status, throughput, latency, and retrieval-quality notes for each rung.

### Tests for User Story 1

- [X] T009 [P] [US1] Add benchmark command coverage for ladder ordering and result capture in `tests/embedding-benchmark-command.test.js`
- [X] T010 [P] [US1] Add a bounded benchmark verification script for real-machine smoke runs in `scripts/verify-embedding-benchmark.js`

### Implementation for User Story 1

- [X] T011 [US1] Implement the benchmark command entrypoint in `src/cli/commands/embedding-benchmark.js`
- [X] T012 [US1] Wire the new benchmark command into CLI dispatch and help text in `src/cli/main.js` and `src/cli/formatters/help.js`
- [X] T013 [US1] Implement candidate ladder execution, subset selection, and fixed query-pack evaluation in `src/app/search/run-embedding-benchmark.js`
- [X] T014 [P] [US1] Persist benchmark evidence and machine-readable summaries in `src/app/search/run-embedding-benchmark.js` and `specs/001-stronger-embedding-model/quickstart.md`
- [X] T015 [US1] Expose benchmark summaries through the CLI formatter in `src/cli/commands/embedding-benchmark.js` and `src/cli/formatters/embedding-benchmark-report.js`

**Checkpoint**: User Story 1 is complete when the repo can benchmark the baseline and stronger candidates in a reproducible order and emit comparable evidence.

---

## Phase 4: User Story 2 - Roll Forward Safely (Priority: P2)

**Goal**: Make model upgrades explicit, reversible, and safe for the local vector store.

**Independent Test**: Switch to a candidate model, run a bounded re-index, confirm new vectors stay separated by model identity, then restore the baseline config and re-index again without manual store cleanup.

### Tests for User Story 2

- [X] T016 [P] [US2] Add storage regression coverage for mixed-model identity separation in `tests/storage-repositories.test.js`
- [X] T017 [P] [US2] Add rollback workflow verification for bounded re-index runs in `scripts/verify-index-cache.js`

### Implementation for User Story 2

- [X] T018 [US2] Persist candidate-aware embedding metadata and extractor signatures in `src/indexer/records/embedding-record.js` and `src/indexer/records/record-identity.js`
- [X] T019 [US2] Enforce model-identity-safe reads and writes in `src/storage/vector/qdrant-vector-repository.js` and `src/storage/vector/json-vector-repository.js`
- [X] T020 [US2] Surface active model identity and re-index guidance in `src/cli/commands/index.js`, `src/cli/commands/reindex.js`, and `src/cli/commands/index-command-base.js`
- [X] T021 [US2] Update rollout, rollback, and selected-candidate config guidance in `README.md`, `docs/architecture.md`, and `docs/product.md`
- [X] T022 [US2] Sync the sample config to the selected rollout shape in `media-vector-index.config.json`

**Checkpoint**: User Story 2 is complete when model changes are explicit in config and CLI flows, and vector queries never confuse baseline and candidate embeddings.

---

## Phase 5: User Story 3 - Detect Incompatibility Early (Priority: P3)

**Goal**: Reveal dependency, device, cache, and fair-benchmark blockers before a long indexing run starts.

**Independent Test**: Probe each candidate from the ladder and confirm the CLI reports missing libraries, device selection, recommended extractor size, and candidate-specific warnings before indexing begins.

### Tests for User Story 3

- [X] T023 [P] [US3] Add capability probe coverage for dependency and resolution warnings in `tests/embedding-capabilities.test.js`
- [X] T024 [P] [US3] Add a candidate-probe smoke script for ordered fallback evaluation in `scripts/verify-embedding.js`

### Implementation for User Story 3

- [X] T025 [US3] Expand capability probing to report dependency gaps, device choice, and recommended extractor size in `src/embedding/providers/open-clip/capabilities.js` and `src/embedding/providers/open-clip/remediation.js`
- [X] T026 [US3] Update the embedding capabilities command output for candidate-specific warnings and remediation steps in `src/cli/commands/embedding-capabilities.js`
- [X] T027 [US3] Implement stricter bridge-side requirement detection for `timm`, `transformers`, and model download blockers in `python/embedding_bridge/bridge.py`
- [X] T028 [US3] Document the candidate probe workflow and rejection criteria in `specs/001-stronger-embedding-model/quickstart.md` and `specs/001-stronger-embedding-model/contracts/model-upgrade-contract.md`

**Checkpoint**: User Story 3 is complete when capability checks fail fast with actionable guidance instead of letting avoidable errors surface deep into indexing.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Finish validation, docs sync, and cross-story cleanup.

- [X] T029 [P] Refresh the default config sample from source defaults with `npm run config:sync-sample` via `media-vector-index.config.json`
- [X] T030 [P] Validate the synced sample config with `npm run config:check-sample` against `media-vector-index.config.json`
- [X] T031 Run storage regression coverage with `npm run test:storage` for `tests/storage-repositories.test.js`
- [X] T032 Run the feature quickstart and bounded benchmark validation, then record the winning candidate and fallback in `specs/001-stronger-embedding-model/quickstart.md` and `specs/001-stronger-embedding-model/research.md`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1: Setup**: No dependencies.
- **Phase 2: Foundational**: Depends on Phase 1 and blocks all user stories.
- **Phase 3: US1**: Depends on Phase 2. This is the MVP slice.
- **Phase 4: US2**: Depends on Phase 2 and should follow US1 so rollout logic targets the benchmarked workflow.
- **Phase 5: US3**: Depends on Phase 2 and can proceed alongside late US1/US2 work once shared probe contracts land.
- **Phase 6: Polish**: Depends on the stories chosen for release.

### User Story Dependencies

- **US1 (P1)**: No dependency on other stories after foundation is complete.
- **US2 (P2)**: Depends on US1 benchmark output to know which candidate and rollout path need guarding.
- **US3 (P3)**: Depends on shared candidate registry and bridge contract from Phase 2, but not on US2 rollout completion.

### Within Each User Story

- Tests and smoke scripts should be added before or alongside implementation and must fail meaningfully before final validation.
- Candidate registry and provider metadata must exist before benchmark or probe logic consumes them.
- Storage/model identity changes must land before rollout docs claim rollback is safe.

### Parallel Opportunities

- `T002` and `T003` can run in parallel after `T001`.
- `T005`, `T006`, and `T007` can run in parallel once `T004` is done.
- In US1, `T009` and `T010` can run in parallel, and `T014` can proceed once `T013` defines result structure.
- In US2, `T016` and `T017` can run in parallel before the implementation tasks settle.
- In US3, `T023` and `T024` can run in parallel, and `T028` can start once probe output fields are stable.

---

## Parallel Example: User Story 1

```bash
Task: "Add benchmark command coverage for ladder ordering and result capture in tests/embedding-benchmark-command.test.js"
Task: "Add a bounded benchmark verification script for real-machine smoke runs in scripts/verify-embedding-benchmark.js"

Task: "Persist benchmark evidence and machine-readable summaries in src/app/search/run-embedding-benchmark.js and specs/001-stronger-embedding-model/quickstart.md"
Task: "Expose benchmark summaries through the CLI formatter in src/cli/commands/embedding-benchmark.js and src/cli/formatters/embedding-benchmark-report.js"
```

## Parallel Example: User Story 2

```bash
Task: "Add storage regression coverage for mixed-model identity separation in tests/storage-repositories.test.js"
Task: "Add rollback workflow verification for bounded re-index runs in scripts/verify-index-cache.js"
```

## Parallel Example: User Story 3

```bash
Task: "Add capability probe coverage for dependency and resolution warnings in tests/embedding-capabilities.test.js"
Task: "Add a candidate-probe smoke script for ordered fallback evaluation in scripts/verify-embedding.js"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1 and Phase 2.
2. Deliver Phase 3 so the repo can benchmark the candidate ladder reproducibly.
3. Validate the benchmark flow on a bounded real-library subset before changing rollout defaults.

### Incremental Delivery

1. Build the shared candidate/config/probe foundation.
2. Add benchmark execution and evidence capture (US1).
3. Add rollback-safe model identity and rollout guidance (US2).
4. Tighten preflight incompatibility detection (US3).
5. Finish with config sync and real-machine validation.

### Suggested MVP Scope

- Complete through **Phase 3 / US1** first. That yields the minimum valuable outcome: reproducible evidence for which stronger model is worth adopting.

---

## Notes

- All tasks follow the required checklist format with IDs, optional `[P]`, story labels where required, and exact file paths.
- Real-library benchmark validation is intentionally separated from pure code tasks because TCC, Photos access, and model downloads may require machine-local confirmation outside sandboxed execution.
