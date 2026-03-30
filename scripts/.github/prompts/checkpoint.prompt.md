---
name: "checkpoint"
description: "Snapshot the current task state, decisions made, and remaining work so a future session can resume without loss."
agent: "knowledge-curator"
argument-hint: "Optionally describe the area or task to checkpoint"
---

Use [the repository-wide instructions](../copilot-instructions.md) and the relevant instruction files in [../instructions](../instructions).

1. Summarize the current task objective and progress.
2. List decisions made during this session and their rationale.
3. Capture modified files, pending changes, and remaining work items.
4. Write the checkpoint to `.github/sessions/checkpoint.md`.
5. Confirm the checkpoint is complete and readable for a fresh session.
