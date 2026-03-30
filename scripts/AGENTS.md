# Everything GitHub Copilot — Workspace Instructions

This repository is a GitHub Copilot customization pack for VS Code. `.github/` is the source of truth.

## Layout

- `.github/copilot-instructions.md` — always-on repository-wide instructions
- `.github/instructions/` — file-based instructions with `applyTo` patterns
- `.github/prompts/` — reusable prompt workflows
- `.github/agents/` — custom agents (planning, TDD, review, security)
- `.github/hooks/` — deterministic hook automations
- `.github/skills/` — agent skills

## Working Rules

- Keep always-on guidance short. Put path-specific rules in `.instructions.md` files.
- Use prompt files for repeatable single workflows.
- Use custom agents only for persistent personas.
- Keep YAML frontmatter valid with explicit `description` fields.
- Favor deterministic hooks that format, validate, or block unsafe operations.
- Validate changes with `npm run validate` and `npm run lint`.
