# The Shortform Guide to Everything GitHub Copilot

![Header: GitHub Copilot setup guide](./assets/images/shortform/00-header.png)

---

This repository is now a GitHub Copilot customization pack for VS Code. The short version is simple: treat `.github/` as the active surface and optimize for deterministic behavior over clever but opaque automation.

If you only read one guide before contributing or extending this repository, read this one first.

---

## The Core Layout

The active Copilot surface lives here:

- `.github/copilot-instructions.md` for repository-wide guidance
- `.github/instructions/` for path-specific rules with explicit `applyTo`
- `.github/prompts/` for reusable slash workflows
- `.github/agents/` for specialist personas
- `.github/hooks/` for deterministic automations

Supporting files:

- `.vscode/settings.json` keeps legacy `.claude` discovery from overriding `.github`
- `scripts/ci/validate-copilot-customizations.js` validates instructions, prompts, and agents
- `scripts/ci/validate-github-hooks.js` validates Copilot hook files

New Copilot behavior should start in `.github/`.

---

## How To Think About The Pieces

### Instructions

Use instructions for stable conventions. Keep them focused, narrow, and path-driven.

Good uses:

- language-specific standards
- docs-only guidance
- validator or CI editing rules
- review-specific constraints

Avoid turning instructions into giant reference manuals. If guidance only matters for a workflow, put it in a prompt instead.

### Prompts

Prompts replace many old ECC commands. They are the right place for repeatable workflows such as:

- planning
- TDD
- code review
- docs updates
- build fixing
- cleanup

Prompts should state what they do, what input they expect, and what validation the user should receive back.

### Agents

Agents are worth adding when a specialist persona is useful across many sessions. Keep them narrow.

Good examples in this repository:

- planner
- architect
- tdd-guide
- code-reviewer
- security-reviewer
- build-error-resolver

If a workflow can be expressed as one reusable prompt, prefer a prompt over a new agent.

### Hooks

Hooks should be deterministic, local, and cheap.

Good hook behavior:

- formatting after edits
- type checks after targeted edits
- warnings before risky actions
- config protection for sensitive files

Bad hook behavior:

- hidden orchestration
- long-running loops
- session persistence magic
- expensive background automation on every step

Use `.github/hooks/deterministic-hooks.json` as the current reference pattern.

---

## The Fast Authoring Loop

When adding or changing Copilot behavior in this repository:

1. Decide whether the change belongs in instructions, prompts, agents, or hooks.
2. Implement it under `.github/` first.
3. Keep legacy files as compatibility notes only if they still need to exist.
4. Run `npm test` and `npm run lint`.
5. Update documentation if the user-facing workflow changed.

That loop is more important than any particular editor setup or personalization trick.

---

## Context Discipline

The biggest quality gains come from reducing ambiguity, not from adding more moving parts.

Practical rules:

- keep repository-wide instructions short
- push specific guidance into path-based instructions
- prefer a few strong prompts over a large command catalog
- keep agents scoped to clear specialist jobs
- enable only the MCP or hook behavior you actively need

Token efficiency matters, but predictability matters more. A smaller, explicit customization stack is easier to validate and easier to trust.

---

## MCP And Live Documentation

MCP is optional enhancement, not the foundation of the repository design.

Use MCP when it clearly improves accuracy, especially for documentation lookup. In this repository, Context7-style documentation access is the main example of a useful, bounded MCP workflow.

Guidelines:

- document the intended MCP-assisted workflow explicitly
- avoid assuming legacy MCP config is authoritative
- prefer validation and docs that make MCP usage visible
- do not make core repository behavior depend on opaque remote state

---

## Editors And Workflow

This repository is optimized for VS Code with GitHub Copilot customizations, but the main engineering rules are editor-agnostic:

- keep diffs small and reviewable
- validate locally before shipping
- use worktrees when multiple tasks overlap
- separate research from implementation when context gets noisy

VS Code matters here because it is the active target for instructions, prompts, agents, and hook discovery.

---

## Historical Reference

The repository carries some historical material across legacy top-level directories and compatibility docs.

Treat them as:

- documentation reference
- compatibility surface

Do not treat them as the primary source of truth for new Copilot behavior.

---

## What To Read Next

- Read [README.md](./README.md) for the active repository overview.
- Read [CONTRIBUTING.md](./CONTRIBUTING.md) before adding new customizations.
- Read [docs/migration-status.md](./docs/migration-status.md) for the current gap list.
- Read [the-longform-guide.md](./the-longform-guide.md) for deeper design and maintenance patterns.
- Read [the-security-guide.md](./the-security-guide.md) before expanding hooks, MCPs, or automation boundaries.

---

## Short Checklist

- `.github/` first
- `applyTo` over semantic ambiguity
- prompts over legacy commands
- narrow agents
- deterministic hooks
- local validation
- legacy assets treated as reference material

If you keep those seven points straight, the rest of the migration work becomes much easier.
