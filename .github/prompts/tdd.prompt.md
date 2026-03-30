---
name: "tdd"
description: "Run a test-driven workflow for scripts, validators, prompts, or customization logic in this repository."
agent: "tdd-guide"
argument-hint: "Describe the behavior to implement or the bug to reproduce"
---

Use [the repository-wide instructions](../copilot-instructions.md) and the relevant instruction files in [../instructions](../instructions).

1. Define the files and behavior under test.
2. Add or update the smallest failing test first.
3. Run the targeted test and confirm it fails for the expected reason.
4. Implement the minimum change to make the test pass.
5. Re-run targeted validation, then broader repo validation if needed.
6. Report what was tested, what changed, and any remaining coverage gaps.