---
name: "go-review"
description: "Review Go changes for idiomatic patterns, concurrency safety, error handling, and security."
agent: "go-reviewer"
argument-hint: "Describe the Go changes to review"
---

Use [the repository-wide instructions](../copilot-instructions.md) and the relevant instruction files in [../instructions](../instructions).

1. Establish the Go review scope.
2. Run the narrowest relevant static analysis when available.
3. Prioritize concurrency safety, error handling, security, and idiomatic Go findings.
4. Report findings first, ordered by severity.
5. State any missing validation or scope limitations explicitly.