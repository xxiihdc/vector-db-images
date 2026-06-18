---
name: model-switch
description: Use this skill when the user wants to switch the embedding model or candidate preset, benchmark it against the current model, reindex with the new model identity, or roll back safely without manual vector cleanup.
---

# Model Switch

## Purpose

Use this skill for requests like:

- "đổi sang model embedding khác"
- "test model mới so với baseline"
- "reindex theo model mới"
- "rollback về model cũ"
- "benchmark candidate preset"

This skill is for the embedding-model rollout workflow of this repo, not for generic ML model training.

## Required Context

Before acting, read:

1. `README.md`
2. `docs/product.md`
3. `docs/architecture.md`
4. `specs/001-stronger-embedding-model/plan.md` when the task is about model-upgrade work

If the task is unrelated to that plan, state that no relevant plan file is available.

## What This Skill Knows

Current repo workflow:

- Active config file: `media-vector-index.config.json`
- Baseline candidate preset: `baseline`
- Baseline model identity: `open-clip:ViT-B-32:laion2b_s34b_b79k`
- Model separation is keyed by `model_identity`, and Qdrant collections are scoped per model identity under the configured base collection name
- Fair comparison must treat preset, `(provider, model, pretrained)`, and `target_resolution` as one rollout unit

Known candidate ladder from strongest to safer fallback:

- `stretch`: `PE-Core-bigG-14-448` + `metaclip_fullcc` + `448`
- `high-end`: `ViT-gopt-16-SigLIP2-384` + `webli` + `384`
- `fallback-strong`: `ViT-H-14-378-quickgelu` + `dfn5b` + `378`
- `fallback-safe`: `ViT-H-14` + `laion2b_s32b_b79k` + `224`
- `baseline`: `ViT-B-32` + `laion2b_s34b_b79k` + `224`

Default operating assumption for this skill:

- Assume the real machine environment is already prepared and dependencies are available.
- The agent should primarily update config and provide the exact commands the user should run locally.
- Do not block the task on sandbox-native verification unless the user explicitly asks for verification.
- Do not ask the user to hand-edit `storage.vector_collection_name` for normal model switches; the repo should derive physical Qdrant collections automatically.

## Workflow

1. Inspect the current config and identify the active candidate preset and `model_identity`.
2. If the user did not name a target candidate, recommend one from the built-in ladder and explain the tradeoff briefly.
3. Change only the active config for the requested rollout in `media-vector-index.config.json`.
4. If the target model requires a different resolution, update both:
   - `embedding.target_resolution`
   - `extractor.image_thumbnail_size`
5. Keep batch-related config aligned with the chosen candidate when the repo already defines a rollout preset for it.
6. After changing `embedding.candidate_preset`, `embedding.model`, `embedding.pretrained`, or `embedding.target_resolution`, provide the refresh commands the user should run locally:
   - `node ./src/cli/main.js reindex --limit <N> --progress-every <K> --profile`
   - or `node ./src/cli/main.js index --no-cache --limit <N> --progress-every <K> --profile`
7. For comparison work, provide the built-in benchmark command the user should run locally:
   - `node ./src/cli/main.js embedding benchmark`
   - or restrict candidates with `--candidates baseline,fallback-safe,high-end`
8. Report:
   - active config before and after
   - commands to run next on the real machine
   - rollback config target if needed
   - any known caveat such as whether old vectors still need reindex under the new collection-scoping behavior

## Safety Rules

- Never claim native verification succeeded if Photos/TCC/iCloud access was blocked.
- Do not treat missing sandbox verification as a blocker by default; the normal flow is to hand back real-machine commands.
- Do not manually delete vectors just to switch models; rely on `model_identity` separation.
- Do not ask for a manual Qdrant collection rename as part of the normal rollout path.
- Keep the workflow CLI-first and local-first.

## Editing Rules

- Prefer changing `media-vector-index.config.json` only for the active rollout requested by the user.
- Do not proactively modify runtime code, storage layout, or docs when the request is only to switch models.
- If the task changes `DEFAULT_CONFIG` or sample-config behavior, run:
  - `npm run config:sync-sample`
  - `npm run config:check-sample`
  - `npm run test:storage`
  - `npm run verify:storage` if needed by the storage/config change

## Useful Commands

```bash
node ./src/cli/main.js embedding benchmark --candidates baseline,fallback-safe,high-end --asset-limit 50 --query-limit 5
node ./src/cli/main.js reindex --limit 1000 --progress-every 10 --profile
node ./src/cli/main.js search "sunset beach" --skip-album
node ./src/cli/main.js search "dog running" --skip-album
node ./src/cli/main.js search "group photo indoors" --skip-album
```

## Output Expectations

Prefer concise rollout notes with:

- chosen candidate
- config fields changed
- commands to run next
- benchmark command when comparison is relevant
- reindex or rollback guidance

When relevant, note that:

- the configured `storage.vector_collection_name` is now only the base collection prefix
- physical Qdrant collections are derived automatically per `model_identity`

If the user only asked for instructions, do not edit config preemptively.
