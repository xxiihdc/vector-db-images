---
description: "Remind the agent to update docs/mvp-checklist.md before finishing"
---

# Checklist Reminder

This command is invoked automatically as an `after_*` hook.

## Purpose

Before finishing the current task output:

1. Review whether the completed work changes the status of any item in `docs/mvp-checklist.md`.
2. If a checklist item is now complete, update the checklist in the same work session.
3. If the work split or refined an existing task, update the relevant checklist wording or add a sub-task.
4. If the current work does not map to any checklist item, explicitly say so in the final output.

## Output Requirement

In the final output, include one explicit checklist status line:

- `Checklist: updated`
- `Checklist: no changes needed`

## Constraint

Do not mark checklist items complete unless the outcome is genuinely finished at MVP quality.
