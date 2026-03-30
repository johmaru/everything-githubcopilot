---
name: "e2e"
description: "Generate, update, or run end-to-end tests for a critical user journey and report execution results."
agent: "e2e-runner"
argument-hint: "Describe the user journey or browser flow to test"
---

Use [the repository-wide instructions](../copilot-instructions.md) and the relevant instruction files in [../instructions](../instructions).

1. Define the highest-value user journey to cover.
2. Generate or update the smallest maintainable E2E test for that flow.
3. Prefer stable selectors, explicit assertions, and deterministic waits.
4. Run targeted E2E validation when the environment supports it.
5. Report the test scope, artifacts, and any setup gaps or flaky behavior.