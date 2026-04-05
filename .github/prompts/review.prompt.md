---
name: "review"
description: "Investigate an implementation or code area in read-only mode and return a findings-first review report."
agent: "researcher"
argument-hint: "Describe the feature, diff, or code area to review"
---

Use [the repository-wide instructions](../copilot-instructions.md) and any relevant files in [../instructions](../instructions).

1. Identify the requested review scope or infer it from the current change set.
2. Investigate the relevant files, dependencies, and existing behavior in read-only mode.
3. Prioritize findings about correctness, regressions, risky assumptions, and validation gaps.
4. Return a findings-first review report with concrete file references, then note open questions or residual risk.
5. Do not edit files or propose implementation handoffs unless the user explicitly asks for fixes.
