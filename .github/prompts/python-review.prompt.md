---
name: "python-review"
description: "Review Python changes for security, type hints, Pythonic patterns, and error handling."
agent: "python-reviewer"
argument-hint: "Describe the Python changes to review"
---

Use [the repository-wide instructions](../copilot-instructions.md) and the relevant instruction files in [../instructions](../instructions).

1. Establish the Python review scope.
2. Run the narrowest relevant static checks when available.
3. Prioritize security, type safety, error handling, and Pythonic correctness findings.
4. Report findings first, ordered by severity.
5. State any missing validation or scope limitations explicitly.