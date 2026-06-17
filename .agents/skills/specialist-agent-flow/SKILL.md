---
name: specialist-agent-flow
description: Use this skill when the user wants work routed through specialist agents or role-based subflows, especially when the task may need a planning gate before implementation and should end with testable output or a quick visualization summary.
---

# Specialist Agent Flow

## Overview

This skill routes a task through a small set of specialist agents with clear handoff rules:

1. assess whether the task needs a plan
2. switch into a planning path when needed
3. implement with a dedicated builder role
4. finish with testable output and a visualization summary
5. do a short workflow retrospective before closing the task

Read [references/agent-roles.md](references/agent-roles.md) before using this skill.

## When To Use

Use this skill when the user asks for any of the following:

- create or use specialist agents for a task
- decide whether a task is simple enough to implement directly or needs planning first
- enforce a repeatable `assess -> plan -> implement -> verify` workflow
- require every implementation to end with a test command, a testable output, or a concise note that nothing is available to visualize yet

Do not use this skill for tiny one-shot tasks where a single direct implementation is clearly enough.

## Agent Flow

Always structure the work with these roles:

1. `triage-agent`
   - reads the request, repo context, and relevant docs
   - decides whether the task is simple or complex
   - marks the task as `direct-implement` or `plan-first`

2. `planner-agent`
   - runs only when the triage result is `plan-first`
   - prepares a concrete execution plan with checkpoints, risks, and validation strategy
   - if the environment supports Plan mode, switch into it
   - if Plan mode is unavailable, state that clearly and create an explicit plan using the planning tool or a written plan before coding
   - when a plan is created, persist it to `tmp/` as a markdown reference file before implementation starts

3. `implementer-agent`
   - executes the approved plan or direct implementation path
   - keeps changes aligned with repo rules, docs, and checklist expectations
   - does not skip implementation once the path is chosen unless a real blocker appears

4. `verifier-agent`
   - runs the most relevant validation available
   - produces at least one of:
     - a concrete test command the user can run now
     - a generated artifact or CLI output that can be inspected
     - a quick visualization summary of what changed and where to look
   - reviews the just-finished workflow and identifies any step that felt fragile, slow, repetitive, or unnecessarily manual
   - if an optimization opportunity exists, asks the user whether to improve that workflow now
   - if nothing meaningful can be visualized, say exactly: `Chưa có gì để visualize.`

## Planning Gate

Default to `plan-first` when any of these are true:

- the task touches architecture, workflow design, multiple modules, or multiple phases
- the task changes public contracts, storage shape, command surfaces, or project conventions
- the task requires non-obvious sequencing or rollback awareness
- the task could spawn several implementation paths with different tradeoffs

Default to `direct-implement` when all of these are true:

- the request is narrow and local
- the implementation path is obvious after a quick codebase read
- validation is straightforward
- there is low risk of hidden cross-file impact

When in doubt, choose `plan-first`.

## Execution Rules

Before coding:

- announce which role is active
- explain whether the task is `direct-implement` or `plan-first`
- if the task is `plan-first`, do not code until the plan exists
- if the task is `plan-first`, store the plan in `tmp/` with a stable filename such as `tmp/YYYY-MM-DD-short-task-name-plan.md`
- mention the `tmp/` plan path in the user update once the plan is ready so later work can reference the same file

Plan file guidance:

- prefer markdown files under `tmp/`
- keep the filename short, descriptive, and stable for the current task
- include scope, ordered steps, validation strategy, open risks, and any assumptions
- update the same file when the plan changes materially instead of creating many near-duplicate plan files

During implementation:

- keep progress updates short and concrete
- preserve repo-specific workflow rules
- update any mandatory docs or checklists that the repo requires as part of the same task

After implementation:

- run the best available validation
- report what can be tested now
- report what can be visualized now
- do a short retrospective on the workflow that was just used
- if there is a concrete workflow improvement worth making, ask the user whether to optimize it now
- if there is no visual artifact, UI change, rendered document, or output worth previewing, say `Chưa có gì để visualize.`

## Final Output Contract

End with this shape:

1. `Flow used`
   - which agent roles were activated
   - whether the task went through `direct-implement` or `plan-first`

2. `Testable output`
   - exact command, file, or artifact to inspect
   - if validation could not be run, say why

3. `Visualization`
   - one or two lines on what can be previewed
   - or `Chưa có gì để visualize.`

4. `Workflow follow-up`
   - `No workflow issue found.`
   - or one short optimization suggestion plus a direct question asking whether to improve it now

Keep the summary concise. The goal is handoff clarity, not a long changelog.
