# The Longform Guide to Everything GitHub Copilot

![Header: The Longform Guide to Everything GitHub Copilot](./assets/images/longform/01-header.png)

---

This guide covers the design patterns behind a GitHub Copilot-first customization pack for VS Code.

Read [the-shortform-guide.md](./the-shortform-guide.md) first if you want the fast overview. This guide is for maintainers and contributors who need the reasoning behind the structure.

---

## The Migration Goal

The repository is moving toward a simpler model:

- repository-wide guidance stays short
- path-specific behavior is explicit through `applyTo`
- reusable workflows live in prompts
- specialist behavior lives in a small set of agents
- automations are deterministic and validated

The point is not to copy ECC one-for-one. The point is to preserve the useful behavior while making it understandable and reliable inside GitHub Copilot and VS Code.

---

## Source Of Truth Hierarchy

When files disagree, follow this order:

1. `.github/copilot-instructions.md`
2. `.github/instructions/*.instructions.md`
3. `.github/prompts/*.prompt.md`
4. `.github/agents/*.agent.md`
5. `.github/hooks/*.json`
6. migration documentation describing remaining gaps

Legacy directories are below that hierarchy. They are useful for reference, but they should not dictate new implementation decisions.

---

## Instruction Design

Good instruction design is mostly about scope control.

Use repository-wide instructions only for rules that should be almost always true, such as:

- safety boundaries
- verification expectations
- basic editing discipline
- where the active Copilot assets live

Use path-specific instructions for:

- language rules
- framework rules
- Markdown and documentation conventions
- validator-specific expectations

Patterns that help:

- prefer several thin instruction files over one huge file
- use narrow `applyTo` patterns
- avoid repeating repository-wide guidance inside every instruction
- create review-only or docs-only instructions when that trims context

---

## Prompt Design

Prompts should replace high-value legacy commands first.

A strong prompt file does four things well:

1. states the workflow clearly
2. requests the right inputs
3. points to the relevant instructions
4. tells the user what validation or output to expect

That is why prompts such as planning, review, build-fix, docs, and cleanup are already high-value migration targets.

Prompts should not be vague wrappers around "do the thing." They should encode the actual workflow shape.

---

## Agent Design

Agents are expensive in two ways: they add conceptual surface area, and they add maintenance cost.

Use a custom agent when:

- a specialist persona is reused often
- the role is narrow and defensible
- the trigger conditions can be described clearly
- the repository benefits from consistent specialist behavior

Do not create a new agent for every workflow variation. Keep the set small, practical, and easy to discover.

In this repository, the right long-term shape is a small cluster of durable agents, backed by prompts and instructions rather than replaced by them.

---

## Deterministic Hooks

Hooks are useful only when contributors can predict them.

Good candidates:

- run a formatter after edits in known file types
- run a cheap validator after touching key configuration files
- warn before risky commands
- protect important repository configuration from accidental damage

Poor candidates:

- hidden session orchestration
- autonomous loop control
- heavyweight analysis on every tool call
- behavior that depends on undocumented external state

This is why `.github/hooks/deterministic-hooks.json` is a better active reference than the older, broader hook inventories.

---

## Validation Strategy

A Copilot-first repository needs validation that matches the actual active surface.

Current essentials:

- validate instructions, prompts, and agents under `.github/`
- validate hook files under `.github/hooks/`
- keep `npm test` and `npm run lint` as the default active checks
- use `npm test` as the broader compatibility sweep while legacy validators still exist
- use migration docs to record what still points at legacy structure

If a validator still treats legacy top-level ECC directories as authoritative, move it behind the compatibility sweep and track it in the migration backlog.

---

## Documentation Maintenance

Docs should do three jobs:

1. explain the active Copilot surface
2. explain what remains legacy during migration
3. tell contributors where to put new work

The easiest way to fail documentation in this repository is to describe legacy behavior as if it were still the preferred path. That creates implementation drift immediately.

Practical documentation rules:

- keep active-language docs aligned with the root English structure
- mark compatibility docs as legacy when they are not active migration targets
- update migration status whenever a major documentation area is rewritten
- remove or downgrade legacy examples once a Copilot-first equivalent exists

---

## Parallel Work And Review

For large migration tasks, separate work by intent:

- one branch or worktree for documentation rewrites
- one for prompts and agents
- one for validators and CI

That reduces collisions and makes review easier.

Within a single task, separate research from implementation. Read legacy material first, decide the target structure, then edit toward the new model. Avoid mixing exploration and large-scale editing in the same noisy loop.

---

## Security And Approval Boundaries

As the repository grows more automation under `.github/`, the approval boundary matters more.

Key rules:

- do not normalize dangerous shell behavior in prompts or hooks
- keep hooks transparent and auditable
- treat MCP as optional, bounded integration
- prefer local validation over hidden network dependence
- document where human review is still required

Security is not a separate layer from authoring design. Overly broad prompts, agents, hooks, or MCP assumptions all become security problems later.

---

## Recommended Migration Order

The most effective order remains:

1. active documentation surfaces
2. high-value prompt replacements
3. durable specialist agents
4. deterministic hook expansion
5. validator and package cleanup
6. legacy directory shrinkage or archival

That order keeps the active user path accurate while the deeper implementation work continues.

---

## What Success Looks Like

The migration is in a good state when:

- `.github/` is clearly the active Copilot surface
- contributors know where new work belongs without guessing
- prompts and agents cover the most valuable workflows
- validators enforce the active structure, not the old one
- legacy directories are clearly compatibility-only or are gone entirely
- documentation no longer teaches the old model as default behavior
That is the standard the remaining work should be measured against.
