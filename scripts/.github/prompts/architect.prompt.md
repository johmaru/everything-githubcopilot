---
name: "architect"
description: "Review a design, migration, or refactor from an architecture perspective and return a clear recommendation with trade-offs."
agent: "architect"
argument-hint: "Describe the design problem or architectural decision to evaluate"
---

Use [the repository-wide instructions](../copilot-instructions.md) and the relevant instruction files in [../instructions](../instructions).

1. Restate the architectural problem and constraints.
2. Analyze the current structure and where the change should live.
3. Compare the simplest viable options and their migration impact.
4. Recommend one approach with concrete affected paths.
5. Summarize major risks, validation needs, and what should happen before implementation.