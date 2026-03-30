---
name: "code-review"
description: "Review the current change set for correctness, security, deterministic Copilot loading, and maintainability."
agent: "code-reviewer"
argument-hint: "Optionally describe the area to review"
---

Use [the repository-wide instructions](../copilot-instructions.md) and any relevant files in [../instructions](../instructions).

Review the current diff or requested scope with these priorities:

1. Security and secrets exposure.
2. Incorrect Copilot customization discovery or conflicting instruction sources.
3. Broken YAML frontmatter, invalid `applyTo` patterns, or misplaced prompt or agent files.
4. Validation gaps in package scripts, CI, or docs.
5. Maintainability risks, duplication, and unnecessary complexity.

Return findings ordered by severity with concrete file references and fixes.