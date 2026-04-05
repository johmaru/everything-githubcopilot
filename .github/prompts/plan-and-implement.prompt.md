---
name: "plan-and-implement"
description: "Produce an implementation plan, then hand off to coder for sequential execution when the task is low-risk and sufficiently clear."
agent: "planner"
argument-hint: "Describe the change to plan and implement end-to-end"
---

Use [the repository-wide instructions](../copilot-instructions.md) and any relevant files in [../instructions](../instructions).

## Workflow

1. Restate the request, constraints, and success criteria.
2. Inspect the relevant repository surfaces and produce a concrete step-by-step plan with validation for each step.
3. When the task description is broad enough that the right skill set is unclear, consult the local skill router first with a short manually sanitized single-token slug that uses only letters, numbers, and hyphens, for example `npm run skill-router:recommend -- --query multi-pr-migration-roadmap`. Do not paste the raw user request into the shell command, and do not include quotes, spaces, or shell metacharacters in the slug. Treat the output as a recommendation surface, not an always-on injection contract.
4. If the task is low-risk, scoped, and does not require unresolved product decisions, use the planner -> coder handoff to start implementation immediately.
5. If the task is high-risk, ambiguous, or blocked on missing information, stop after the plan and clearly report what must be confirmed before implementation.
6. Keep the plan and handoff aligned with the repository's verification loop and minimal-diff expectations.

## Output

- Start with the plan summary and rationale.
- When implementation is safe to begin, emit the planner -> coder handoff block instead of waiting for another user message.
- When implementation is not safe to begin, stop after the plan and list the blocker clearly.
