---
name: plan-coverage-check
description: Use this skill when the user wants to check whether a feature plan has already been implemented, partially implemented, or is still missing, without adding review scripts into the product runtime. It compares a plan artifact against the current repository and emits a coverage-oriented findings report.
---

# Plan Coverage Check

## Purpose

Use this skill to answer questions like:

- "plan này đã impl chưa?"
- "phần nào của plan đã có code rồi?"
- "repo hiện cover plan được đến đâu?"
- "hãy rà plan so với code hiện tại"

This skill is for workflow support only. Its script lives under the skill folder and must not be added to the product runtime surface.

## When To Use

Use this skill when:

- a plan/spec already exists
- the user wants implementation coverage rather than a new implementation
- the repo needs a repeatable, lower-manual-overhead plan-vs-code audit

Do not use this skill when:

- the user already asked to implement the missing pieces
- no plan artifact exists and a normal code review is enough

## Workflow

1. Identify the plan file.
   - Prefer the active plan referenced in `AGENTS.md` or `.specify/feature.json`.
   - If the user names a specific plan file, use that.
2. Run `scripts/check_plan_coverage.js` from this skill with the plan path.
3. Read the script output.
4. Open the most relevant matched files to confirm the highest-signal findings before reporting.
5. Report:
   - `implemented`
   - `partially implemented`
   - `missing`
   - any risky false-positive/false-negative areas

## Output Rules

- Treat the script as a triage aid, not the final judge.
- Always confirm critical conclusions by opening the referenced files.
- Findings-first reporting is preferred.
- If the plan mentions model/config/storage contracts, call out whether the current code filters by the correct identity key.

## Script

Run:

```bash
node .agents/skills/plan-coverage-check/scripts/check_plan_coverage.js --plan <plan-path>
```

Optional:

```bash
node .agents/skills/plan-coverage-check/scripts/check_plan_coverage.js --plan <plan-path> --json
```

## Notes

- The script is intentionally heuristic. It scores evidence from:
  - backticked identifiers in the plan
  - repo-relative paths in the plan
  - nearby keyword matches
- Use it to reduce manual scanning, then verify the important gaps yourself.
