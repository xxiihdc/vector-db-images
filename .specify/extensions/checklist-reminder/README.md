# Checklist Reminder Extension

Local Spec Kit extension that reminds agents to update `docs/mvp-checklist.md` and do a short workflow retrospective after core workflow outputs.

## Command

- `speckit.checklist.remind`

## Hooks

- `after_constitution`
- `after_specify`
- `after_clarify`
- `after_plan`
- `after_tasks`
- `after_implement`
- `after_checklist`
- `after_analyze`
- `after_taskstoissues`

## Scope

This extension only applies to Spec Kit workflow hook events. It does not intercept arbitrary free-form chat output, so `AGENTS.md` remains the source of truth for the broader reporting convention and the final ask-back about workflow optimization.
