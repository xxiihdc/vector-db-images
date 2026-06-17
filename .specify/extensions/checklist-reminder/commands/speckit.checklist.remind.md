---
description: "Remind the agent to update docs/mvp-checklist.md and do a short workflow retrospective before finishing"
---

# Checklist Reminder

This command is invoked automatically as an `after_*` hook.

## Purpose

Before finishing the current task output:

1. Review whether the completed work changes the status of any item in `docs/mvp-checklist.md`.
2. If a checklist item is now complete, update the checklist in the same work session.
3. If the work split or refined an existing task, update the relevant checklist wording or add a sub-task.
4. If the current work does not map to any checklist item, explicitly say so in the final output.
5. Review whether the workflow that just completed had any slow, awkward, repetitive, or automatable step.
6. If such a step exists, include one short optimization suggestion and ask the user whether to improve that workflow now.

## Output Requirement

In the final output, include one explicit checklist status line:

- `Checklist: updated`
- `Checklist: no changes needed`

Also include one explicit workflow status line:

- `Workflow follow-up: no issue found`
- `Workflow follow-up: <short optimization suggestion> Ask Đức whether to optimize it now.`

## Constraint

Do not mark checklist items complete unless the outcome is genuinely finished at MVP quality.
