---
name: "refactor-clean"
description: "Find and remove low-risk dead code, unused dependencies, or duplicate code with validation after each cleanup step."
agent: "refactor-cleaner"
argument-hint: "Describe the area to analyze for cleanup"
---

Use [the repository-wide instructions](../copilot-instructions.md) and the relevant instruction files in [../instructions](../instructions).

1. Identify the safest cleanup candidates first.
2. Verify references before removing code or dependencies.
3. Make small, reversible cleanup batches.
4. Re-run relevant validation after each batch.
5. Report what was removed, what was skipped, and what remains uncertain.