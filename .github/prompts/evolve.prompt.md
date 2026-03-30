---
name: "evolve"
description: "Promote validated session learnings into permanent project guidance such as instructions, skills, or agent updates."
agent: "knowledge-curator"
argument-hint: "Describe the learning or pattern to promote"
---

Use [the repository-wide instructions](../copilot-instructions.md) and the relevant instruction files in [../instructions](../instructions).

1. Review session notes, memory files, and recent checkpoints for candidate learnings.
2. Verify each candidate has been validated in at least one real session (not speculative).
3. Choose the target persistence level:
   - **Instruction** — broadly applicable conventions → `.github/instructions/`
   - **Skill** — domain-specific workflow → `.github/skills/<name>/SKILL.md`
   - **Agent update** — behavioral refinement → `.github/agents/`
   - **Hook** — automated enforcement → `.github/hooks/` + `scripts/hooks/`
4. Write or update the target file following existing patterns and frontmatter conventions.
5. Remove or archive the session-scoped source to avoid duplication.
6. Run `npm test` to validate the change does not break CI.
