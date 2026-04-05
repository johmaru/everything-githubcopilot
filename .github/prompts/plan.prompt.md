---
name: "plan"
description: "Restate a request, map it to repository instructions, prompts, agents, hooks, and docs, then produce an implementation plan before editing."
agent: "planner"
argument-hint: "Describe the feature, migration, or refactor to plan"
---

Use [the repository-wide instructions](../copilot-instructions.md) and any relevant files in [../instructions](../instructions).

1. Restate the request and constraints.
2. Identify whether the work belongs in repository-wide instructions, file-based instructions, prompt files, custom agents, hooks, validators, or docs.
3. List the files or directories that should change.
4. Produce phased implementation steps, risks, and validation commands.
5. Stop after presenting the plan and wait for user confirmation before editing files.

> **Tip**: If you want the plan to incorporate researched best practices with source attribution, use `/research-plan` instead.
