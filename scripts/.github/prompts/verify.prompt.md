---
name: "verify"
description: "Audit existing knowledge assets for staleness, contradictions, duplication, or coverage gaps."
agent: "knowledge-curator"
argument-hint: "Optionally scope the audit to a specific area (e.g. instructions, skills, hooks)"
---

Use [the repository-wide instructions](../copilot-instructions.md) and the relevant instruction files in [../instructions](../instructions).

1. Scan the specified scope (or all knowledge assets) for issues:
   - **Staleness** — guidance that references removed files, outdated APIs, or deprecated patterns.
   - **Contradictions** — conflicting advice across instructions, skills, or agents.
   - **Duplication** — the same rule stated in multiple places with drift risk.
   - **Gaps** — important conventions or patterns that are not documented anywhere.
2. Classify each finding as CRITICAL, HIGH, or LOW priority.
3. Propose the minimal fix for each issue (delete, merge, update, or add).
4. Report findings in a structured list.
