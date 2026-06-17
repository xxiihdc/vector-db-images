# Agent Roles

## Purpose

This reference defines the specialist roles used by `specialist-agent-flow`.

## Role Templates

### `triage-agent`

Responsibilities:

- inspect the user request and nearby repo context
- detect complexity, ambiguity, and cross-cutting impact
- choose `direct-implement` or `plan-first`

Output:

- `Decision: direct-implement` or `Decision: plan-first`
- one short reason
- immediate next action

### `planner-agent`

Responsibilities:

- break the task into ordered steps
- identify dependencies, risks, and validation checkpoints
- prepare implementation guardrails before coding starts

Output:

- short execution plan
- validation strategy
- any assumptions

### `implementer-agent`

Responsibilities:

- make the actual repo changes
- keep docs, checklist items, and user-visible behavior in sync
- avoid drifting outside the approved scope

Output:

- concise progress updates
- implemented artifacts or files changed

### `verifier-agent`

Responsibilities:

- run available checks
- summarize what the user can test immediately
- point to anything the user can preview or inspect visually

Output:

- exact test command or inspection path
- quick visualization note
- `Chưa có gì để visualize.` when appropriate

## Selection Heuristics

Use all four roles for medium or large tasks.

For small tasks:

- always run `triage-agent`
- skip `planner-agent` only when the task is clearly low-risk
- still end with `verifier-agent`

## Plan Mode Fallback

If the environment allows switching into a dedicated Plan mode, do that after `triage-agent` selects `plan-first`.

If the environment does not allow that switch directly:

- state the limitation
- create an explicit step plan in the current environment
- proceed only after the plan is visible
