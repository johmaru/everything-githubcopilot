---
name: "typescript-review"
description: "Review TypeScript or JavaScript changes for type safety, async correctness, and repository-specific risks."
agent: "typescript-reviewer"
argument-hint: "Describe the TypeScript or JavaScript changes to review"
---

Use [the repository-wide instructions](../copilot-instructions.md) and the relevant instruction files in [../instructions](../instructions).

1. Establish the TypeScript or JavaScript review scope.
2. Run the narrowest relevant validation when available.
3. Prioritize type safety, async correctness, security, and maintainability findings.
4. Report findings first, ordered by severity.
5. State any missing validation or scope limitations explicitly.