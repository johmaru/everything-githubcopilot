# Contributing to Everything GitHub Copilot

Thanks for contributing. This repository is being migrated into a GitHub Copilot customization pack for VS Code, so new work should target the Copilot layout first.

## Table of Contents

- [What We're Looking For](#what-were-looking-for)
- [Quick Start](#quick-start)
- [Contributing Instructions](#contributing-instructions)
- [Contributing Prompts](#contributing-prompts)
- [Contributing Agents](#contributing-agents)
- [Contributing Hooks](#contributing-hooks)
- [MCP and documentation (e.g. Context7)](#mcp-and-documentation-eg-context7)
- [Pull Request Process](#pull-request-process)

---

## What We're Looking For

### Instructions

Targeted `.instructions.md` files with explicit `applyTo` patterns for language, framework, or area-specific guidance.

### Prompts

Reusable `.prompt.md` files for slash workflows such as planning, TDD, review, docs, or migration tasks.

### Agents

Custom `.agent.md` personas for persistent specialist behavior, especially planning, review, security, and TDD.

### Hooks

Deterministic `.github/hooks/*.json` automations that enforce validation or post-edit processing.

### Validation And Docs

CI validators, migration docs, and repository documentation that strengthen the Copilot-first layout.

---

## Quick Start

```bash
# 1. Fork and clone
gh repo fork johmaru/everything-githubcopilot --clone
cd everything-githubcopilot

# 2. Create a branch
git checkout -b feat/my-contribution

# 3. Add your contribution under .github/ first

# 4. Validate locally
npm test
npm run lint

# 5. Submit PR
git add . && git commit -m "feat: add copilot customization" && git push -u origin feat/my-contribution
```

---

## Contributing Instructions

Instructions are the first choice for project conventions in GitHub Copilot.

### File Location

```
.github/instructions/your-topic.instructions.md
```

### Instructions Template

```markdown
---
name: 'Your Instruction Name'
description: 'Use when editing the relevant files or performing the relevant task.'
applyTo: '**/*.ts'
---

# Your Instruction Title

- Keep rules short and explicit.
- Explain the preferred pattern and why it exists.
- Use narrow `applyTo` patterns instead of broad global matching.
```

### Instructions Checklist

- [ ] Stored under `.github/instructions/`
- [ ] Valid YAML frontmatter
- [ ] Has a discoverable `description`
- [ ] Has an explicit `applyTo` when automatic loading is intended
- [ ] Avoids duplicating always-on guidance already covered by `.github/copilot-instructions.md`

### Guidance

- Use instructions for language-specific or area-specific rules.
- Prefer multiple focused instruction files over one large file.
- Do not make critical behavior depend on semantic-only loading when `applyTo` can be used.

## Contributing Prompts

Prompt files are the preferred way to define reusable slash workflows.

### File Location

```
.github/prompts/your-workflow.prompt.md
```

### Prompt Template

```markdown
---
name: 'your-workflow'
description: 'What this reusable slash workflow does.'
agent: 'planner'
argument-hint: 'Describe the work to run with this prompt'
---

Use [the repository-wide instructions](../copilot-instructions.md).

1. Restate the request.
2. Execute the workflow.
3. Report the result and validation.
```

### Prompt Checklist

- [ ] Stored under `.github/prompts/`
- [ ] Valid YAML frontmatter
- [ ] Uses a real built-in agent or existing custom agent name
- [ ] References relevant instruction files instead of duplicating rules
- [ ] Has a clear output expectation

---

## Contributing Agents

Agents are specialized Copilot personas for persistent workflows.

### File Location

```
.github/agents/your-agent-name.agent.md
```

### Agent Template

```markdown
---
name: 'your-agent-name'
description: 'Use when this specialist persona is appropriate.'
argument-hint: 'What the user should provide'
---

# Your Agent Title

You are a specialist for this workflow.

## Goals

- Primary goal
- Secondary goal

## Workflow

1. Understand the request.
2. Execute within scope.
3. Report clearly.
```

### Agent Checklist

- [ ] Stored under `.github/agents/`
- [ ] Uses valid YAML frontmatter
- [ ] Description includes strong trigger phrases
- [ ] Keeps persona narrow and practical
- [ ] Avoids depending on hidden legacy behavior

### Example Agents

| Agent                        | Purpose                              |
| ---------------------------- | ------------------------------------ |
| `planner.agent.md`           | Planning and migration decomposition |
| `architect.agent.md`         | Architecture and trade-off analysis  |
| `tdd-guide.agent.md`         | Test-driven implementation           |
| `code-reviewer.agent.md`     | Review current change set            |
| `security-reviewer.agent.md` | Security-focused review              |
| `build-error-resolver.agent.md` | Minimal build and validator fixes |
| `docs-lookup.agent.md` | Current docs and API lookup |
| `e2e-runner.agent.md` | E2E workflow generation and execution |
| `refactor-cleaner.agent.md` | Safe dead-code cleanup |

---

## Contributing Hooks

Hooks are deterministic automations for VS Code Copilot.

### File Location

```
.github/hooks/your-hook.json
```

### Hook Guidance

- Prefer `.github/hooks/*.json` over legacy `.claude/settings.json` or `hooks/hooks.json`.
- Keep hooks deterministic and small.
- Prefer format, typecheck, validation, or approval controls.
- Avoid complex orchestration, session persistence, or continuous learning hooks in the active Copilot path.
- Use `.github/hooks/deterministic-hooks.json` as the current reference pattern for Copilot-first hook definitions in this repository.

### Hook Types

| Type           | Trigger          | Use Case              |
| -------------- | ---------------- | --------------------- |
| `PreToolUse`   | Before tool runs | Validate, warn, block |
| `PostToolUse`  | After tool runs  | Format, check, notify |
| `SessionStart` | Session begins   | Load context          |
| `Stop`         | Session ends     | Cleanup, audit        |

### Hook Format

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "tool == \"Bash\" && tool_input.command matches \"rm -rf /\"",
        "hooks": [
          {
            "type": "command",
            "command": "echo '[Hook] BLOCKED: Dangerous command' && exit 1"
          }
        ],
        "description": "Block dangerous rm commands"
      }
    ]
  }
}
```

### Matcher Syntax

```javascript
// Match specific tools
tool == "Bash"
tool == "Edit"
tool == "Write"

// Match input patterns
tool_input.command matches "npm install"
tool_input.file_path matches "\\.tsx?$"

// Combine conditions
tool == "Bash" && tool_input.command matches "git push"
```

### Hook Examples

```json
// Block dev servers outside tmux
{
  "matcher": "tool == \"Bash\" && tool_input.command matches \"npm run dev\"",
  "hooks": [{"type": "command", "command": "echo 'Use tmux for dev servers' && exit 1"}],
  "description": "Ensure dev servers run in tmux"
}

// Auto-format after editing TypeScript
{
  "matcher": "tool == \"Edit\" && tool_input.file_path matches \"\\.tsx?$\"",
  "hooks": [{"type": "command", "command": "npx prettier --write \"$file_path\""}],
  "description": "Format TypeScript files after edit"
}

// Warn before git push
{
  "matcher": "tool == \"Bash\" && tool_input.command matches \"git push\"",
  "hooks": [{"type": "command", "command": "echo '[Hook] Review changes before pushing'"}],
  "description": "Reminder to review before push"
}
```

### Hook Checklist

- [ ] Matcher is specific (not overly broad)
- [ ] Includes clear error/info messages
- [ ] Uses correct exit codes (`exit 1` blocks, `exit 0` allows)
- [ ] Tested thoroughly
- [ ] Has description

---

## MCP and documentation (e.g. Context7)

Skills and agents can use **MCP (Model Context Protocol)** tools to pull in up-to-date data instead of relying only on training data. This is especially useful for documentation.

- **Context7** is an MCP server that exposes `resolve-library-id` and `query-docs`. Use it when the user asks about libraries, frameworks, or APIs so answers reflect current docs and code examples.
- When contributing **instructions or prompts** that depend on live docs, describe the intended MCP-assisted workflow clearly and point to Context7 as the pattern.
- When contributing **agents** that answer docs/API questions, document the resolve -> query workflow and keep the agent scoped to documentation lookup rather than broad research.
- Active Copilot integrations should be documented and validated explicitly.

---

## Pull Request Process

### 1. PR Title Format

```
feat(instructions): add python standards instructions
feat(prompts): add review workflow prompt
feat(agents): add architecture review agent
feat(hooks): add post-edit formatter hook
docs: update copilot migration docs
```

### 2. PR Description

```markdown
## Summary

What changed and why.

## Type

- [ ] Instructions
- [ ] Prompt
- [ ] Agent
- [ ] Hook
- [ ] Docs
- [ ] Validator or CI

## Testing

Commands run and what they validated.

## Checklist

- [ ] `.github/` is used as the primary source of truth
- [ ] Frontmatter is valid
- [ ] `description` fields are explicit
- [ ] `applyTo` is narrow and intentional when used
- [ ] No sensitive info or machine-specific paths
- [ ] `npm test` and `npm run lint` were run, or the reason they were not run is documented
```

### 3. Review Process

1. Maintainers review within 48 hours
2. Address feedback if requested
3. Once approved, merged to main

---

## Guidelines

### Do

- Keep contributions focused and modular
- Include clear descriptions
- Test before submitting
- Follow existing patterns
- Document dependencies

### Don't

- Include sensitive data (API keys, tokens, paths)
- Add overly complex or niche configs
- Submit untested contributions
- Create duplicates of existing functionality

---

## File Naming

- Use lowercase with hyphens: `python-testing.instructions.md`, `code-reviewer.agent.md`
- Be descriptive: `tdd-workflow.prompt.md` not `workflow.prompt.md`
- Match name to filename

---

## Questions?

- **Issues:** [github.com/johmaru/everything-githubcopilot/issues](https://github.com/johmaru/everything-githubcopilot/issues)
- **GitHub:** [johmaru](https://github.com/johmaru)

---

Thanks for contributing! Let's build a great resource together.
