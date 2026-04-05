# Everything GitHub Copilot — Workspace Instructions

This repository is a GitHub Copilot customization pack for VS Code. `.github/` is the source of truth.

## Layout

- `.github/copilot-instructions.md` — always-on repository-wide instructions
- `.github/instructions/` — file-based instructions with `applyTo` patterns
- `.github/prompts/` — reusable prompt workflows
- `.github/agents/` — custom agents (4 user-visible core agents plus internal specialists)
- `.github/hooks/` — deterministic hook automations
- `.github/skills/` — agent skills

## Working Rules

- Keep always-on guidance short. Put path-specific rules in `.instructions.md` files.
- Use prompt files for repeatable single workflows.
- Use custom agents only for persistent personas.
- Keep YAML frontmatter valid with explicit `description` fields.
- Favor deterministic hooks that format, validate, or block unsafe operations.
- Validate changes with `npm run validate` and `npm run lint`.

## Future Phase: Agent Orchestration

Currently, internal specialist agents (those with `user-invocable: false`) must be explicitly invoked from prompt files or by the core agents (planner/coder/researcher/supporter). The core `planner -> coder -> researcher` implementation path and `supporter -> planner/researcher` support path are already active today. Future work will establish broader automatic orchestration where:

- planner/coder/researcher/supporter can automatically invoke appropriate internal specialist agents based on task context
- Internal specialists return results to the calling core agent for continued workflow
- No manual agent selection required for common workflows (security review, code review, TDD, etc.)
