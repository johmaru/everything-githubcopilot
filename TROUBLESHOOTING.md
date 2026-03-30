# Troubleshooting Guide

Common issues and fixes for the GitHub Copilot-first customization layout in this repository.

## Table of Contents

- [Instructions, Prompts, Or Agents Not Showing Up](#instructions-prompts-or-agents-not-showing-up)
- [Legacy `.claude` Behavior Is Still Taking Over](#legacy-claude-behavior-is-still-taking-over)
- [Validation Fails](#validation-fails)
- [Hook Problems](#hook-problems)
- [Prompt Or Agent Names Do Not Match](#prompt-or-agent-names-do-not-match)
- [Getting Help](#getting-help)

---

## Instructions, Prompts, Or Agents Not Showing Up

**Symptoms:** VS Code or GitHub Copilot does not surface the expected customizations.

**Check these first:**

```bash
# Validate the active customization files
npm test

# Inspect the active directories
dir .github\instructions
dir .github\prompts
dir .github\agents
dir .github\hooks
```

Common causes:

- the file is not under `.github/`
- frontmatter is invalid
- the prompt or agent name does not match the intended invocation
- the instruction has no usable `applyTo`

Fixes:

- move the asset into the correct `.github/` directory
- repair frontmatter and rerun validation
- keep prompt and agent names explicit and consistent
- narrow `applyTo` instead of relying on broad or ambiguous matching

---

## Legacy `.claude` Behavior Is Still Taking Over

**Symptoms:** Copilot seems to follow old guidance instead of the repository's `.github` files.

Check:

- `.vscode/settings.json` exists and is present in the workspace
- changes were added under `.github/`, not only under legacy directories
- the docs you followed were Copilot-first, not historical instructions

Rule of thumb:

- if `.github` and legacy files disagree, follow `.github`

---

## Validation Fails

**Symptoms:** `npm test` or `npm run lint` fails on customization or hook validation.

Useful commands:

```bash
npm test
npm run lint
```

Typical causes:

- invalid YAML frontmatter in instructions, prompts, or agents
- malformed JSON in `.github/hooks/*.json`
- missing required metadata fields
- stale documentation describing old structure as active

Fixes:

- validate the changed file format first
- compare with an existing valid file in the same directory
- update docs if the active workflow changed
- keep `.github` as the primary source of truth

---

## Hook Problems

**Symptoms:** hooks do not run, run too broadly, or produce noisy results.

What to check:

- the hook lives under `.github/hooks/`
- the JSON is valid
- the matcher is narrow enough to be predictable
- the hook does not depend on undocumented external state

Good debugging pattern:

- reduce the matcher scope
- validate the hook file again
- compare with `.github/hooks/deterministic-hooks.json`
- avoid adding heavyweight behavior to every edit or tool call

If a hook behaves like hidden orchestration, redesign it. The active hook path should stay deterministic.

---

## Prompt Or Agent Names Do Not Match

**Symptoms:** the workflow exists on disk but cannot be invoked as expected.

Check that:

- the frontmatter `name` is what you intend users to invoke
- filenames and logical names stay aligned
- prompts reference real agents when an `agent` field is used
- docs use the current names rather than historical ECC command names

This mismatch often happens during migration when a legacy command name is copied into new docs without updating the actual prompt file.

---

## Performance And Context Issues

**Symptoms:** too much irrelevant guidance, slow interactions, or noisy automation.

Common causes:

- instructions are too broad
- hooks run on too many events
- prompts duplicate rules already present elsewhere
- contributors rely on too many legacy compatibility surfaces at once

Fixes:

- keep repository-wide instructions short
- move specific guidance into narrow `applyTo` instruction files
- prefer a small set of strong prompts over many overlapping workflows
- keep hooks cheap and deterministic

The migration is partly a performance project: less ambiguity, less duplication, fewer hidden paths.

---

## Getting Help

If you still hit a problem:

1. Read [README.md](./README.md) for the active repository overview.
2. Read [CONTRIBUTING.md](./CONTRIBUTING.md) for the current authoring model.
3. Read [docs/migration-status.md](./docs/migration-status.md) for known remaining gaps.
4. Run `npm test` and `npm run lint`, and include the failing output when reporting an issue.
5. Open an issue at [github.com/johmaru/everything-githubcopilot/issues](https://github.com/johmaru/everything-githubcopilot/issues).
