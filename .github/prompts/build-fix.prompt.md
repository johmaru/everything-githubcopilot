---
name: "build-fix"
description: "Incrementally fix build, typecheck, import, or validator errors with minimal safe changes."
agent: "build-error-resolver"
argument-hint: "Describe the failing command, error output, or broken build"
---

Use [the repository-wide instructions](../copilot-instructions.md) and the relevant instruction files in [../instructions](../instructions).

1. Identify the failing command or error class.
2. Fix one build-blocking issue at a time with the smallest safe diff.
3. Re-run the narrowest relevant validation after each fix.
4. Stop and report blockers if the fix needs dependencies, environment changes, or broader refactoring.
5. Summarize fixed errors, remaining errors, and what was revalidated.