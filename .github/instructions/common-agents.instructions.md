---
name: "Common Agents"
description: "Common agents guidelines applied across all file types."
applyTo: "**/*"
---

# Agent Orchestration

## Available Agents

Located in `.github/agents/`:

### User-Visible Core Agents (直接呼び出し可能)

These 4 agents are user-visible and can be invoked directly by users:

| Agent | Purpose | When to Use |
|-------|---------|-------------|
| planner | Implementation planning | Complex features, refactoring |
| coder | Implementation & verification | Executing planned work or direct tasks |
| researcher | Deep codebase investigation | When detailed analysis is needed |
| supporter | Safer support without edits | When you want AI assistance without file changes |

### Internal Specialist Agents (明示呼び出し専用)

These agents have `user-invocable: false` and are explicitly invoked by core agents or prompts:

| Agent | Purpose | When to Use |
|-------|---------|-------------|
| architect | System design | Architectural decisions |
| tdd-guide | Test-driven development | New features, bug fixes |
| code-reviewer | Code review | After writing code |
| security-reviewer | Security analysis | Before commits |
| build-error-resolver | Fix build errors | When build fails |
| e2e-runner | E2E testing | Critical user flows |
| refactor-cleaner | Dead code cleanup | Code maintenance |
| safety-checker | Post-edit safety review | Immediately after risky edits |
| agent-auditor | Agent file auditing | Checking agent definitions for structural issues |
| best-practice-researcher | Research best practices | Before implementing new features |
| code-structure-auditor | Structural integrity auditing | Detecting broken imports, dead exports, invalid JSON |
| design-coherence-auditor | Schema/type coherence | Checking if implementation matches stated intent |
| docs-lookup | Live documentation lookup | When answers need current docs, not memory |
| go-reviewer | Go code review | Go projects |
| knowledge-curator | Knowledge base maintenance | Capturing session learnings, evolving instructions |
| python-reviewer | Python code review | Python projects |
| typescript-reviewer | TypeScript/JS code review | TypeScript/JavaScript projects |

**Note:** Internal specialist agents are not user-invocable but remain fully functional when called by core agents (planner/coder/researcher/supporter) or from prompt files.

## Immediate Agent Usage

No user prompt needed:
1. Complex feature requests - Use **planner** agent
2. Code just written/modified - Explicitly invoke **code-reviewer** from the active core agent or prompt
3. Bug fix or new feature - Explicitly invoke **tdd-guide** from the active core agent or prompt
4. Architectural decision - Explicitly invoke **architect** from the active core agent or prompt

## Parallel Task Execution

ALWAYS use parallel Task execution for independent operations:

```markdown
# GOOD: Parallel execution
Launch 3 agents in parallel:
1. Agent 1: Security analysis of auth module
2. Agent 2: Performance review of cache system
3. Agent 3: Type checking of utilities

# BAD: Sequential when unnecessary
First agent 1, then agent 2, then agent 3
```

## Multi-Perspective Analysis

For complex problems, use split role sub-agents:
- Factual reviewer
- Senior engineer
- Security expert
- Consistency reviewer
- Redundancy checker
