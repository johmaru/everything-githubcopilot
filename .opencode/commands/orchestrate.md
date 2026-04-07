---
description: Orchestrate multiple agents for complex tasks
agent: planner
subtask: true
---

# Orchestrate Command

Orchestrate multiple specialized agents for this complex task: $ARGUMENTS

## Your Task

1. **Analyze task complexity** and break into subtasks
2. **Identify optimal agents** for each subtask
3. **Create execution plan** with dependencies
4. **Coordinate execution** - parallel where possible
5. **Synthesize results** into unified output

## Available Agents

| Agent                | Specialty               | Use For                           |
| -------------------- | ----------------------- | --------------------------------- |
| planner              | Implementation planning | Complex feature design            |
| architect            | System design           | Architectural decisions           |
| code-reviewer        | Code quality            | High-risk or cross-cutting review |
| security-reviewer    | Security analysis       | Vulnerability detection           |
| tdd-guide            | Test-driven dev         | Feature implementation            |
| build-error-resolver | Build fixes             | TypeScript/build errors           |
| e2e-runner           | E2E testing             | User flow testing                 |
| doc-updater          | Documentation           | Docs and codemap updates          |
| refactor-cleaner     | Code cleanup            | Dead code removal                 |
| go-reviewer          | Go code                 | Go-specific review                |
| go-build-resolver    | Go build fixes          | Go build and vet failures         |
| database-reviewer    | PostgreSQL review       | Schema and query review           |

## Orchestration Patterns

### Sequential Execution

```
planner → tdd-guide → build-error-resolver
```

Use when: Later tasks depend on earlier implementation and stabilization work

### High-Risk Sequential Execution

```
planner → tdd-guide → code-reviewer → security-reviewer
```

Use when: Workspace instructions, hooks, prompts, skills, installer scripts, package metadata, validators, schemas, or other high-risk surfaces changed

### Parallel Execution

```
┌→ security-reviewer
planner →├→ architect
└→ doc-updater
```

Use when: Tasks are independent

### Fan-Out/Fan-In

```
         ┌→ agent-1 ─┐
planner →├→ agent-2 ─┼→ synthesizer
         └→ agent-3 ─┘
```

Use when: Multiple perspectives needed

## Execution Plan Format

### Phase 1: [Name]

- Agent: [agent-name]
- Task: [specific task]
- Depends on: [none or previous phase]

### Phase 2: [Name] (parallel)

- Agent A: [agent-name]
  - Task: [specific task]
- Agent B: [agent-name]
  - Task: [specific task]
- Depends on: Phase 1

### Phase 3: Synthesis

- Combine results from Phase 2
- Generate unified output

## Coordination Rules

1. **Plan before execute** - Create full execution plan first
2. **Minimize handoffs** - Reduce context switching
3. **Parallelize when possible** - Independent tasks in parallel
4. **Clear boundaries** - Each agent has specific scope
5. **Single source of truth** - One agent owns each artifact

---

**NOTE**: Complex tasks benefit from multi-agent orchestration. Simple tasks should use single agents directly.
