---
name: "knowledge-audit"
description: "Audit repository knowledge assets for staleness, contradictions, duplication, or coverage gaps."
agent: "knowledge-curator"
argument-hint: "Optionally scope the audit to a specific area such as instructions, skills, hooks, or prompts"
---

Use [the repository-wide instructions](../copilot-instructions.md) and the relevant instruction files in [../instructions](../instructions).

This prompt is for repository knowledge maintenance only. Do not use it as a substitute for the default `researcher` implementation review, high-risk `code-reviewer` review, or `/verify`.

1. Scan the specified scope, or all knowledge assets when no scope is provided.
2. Look for these issue classes:
   - **Staleness** — guidance that references removed files, outdated APIs, or deprecated patterns.
   - **Contradictions** — conflicting advice across instructions, skills, prompts, or agents.
   - **Duplication** — repeated guidance that risks drift.
   - **Gaps** — important conventions or workflows that are not documented anywhere.
3. Classify each finding as CRITICAL, HIGH, or LOW priority.
4. Propose the smallest safe fix for each finding.
5. Report findings in a structured list, with the most urgent items first.
