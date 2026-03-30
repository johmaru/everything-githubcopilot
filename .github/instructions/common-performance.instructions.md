---
name: "Common Performance"
description: "Common performance guidelines applied across all file types."
applyTo: "**/*"
---

# Performance Optimization

## Model Selection Strategy

Choose the appropriate model tier for the task:

**Lightweight / Fast models**:
- Frequent invocations and simple edits
- Pair programming and code generation
- Worker agents in multi-agent systems

**Balanced / Default models**:
- Main development work
- Orchestrating multi-agent workflows
- Complex coding tasks

**Heavyweight / Reasoning models**:
- Complex architectural decisions
- Maximum reasoning requirements
- Research and analysis tasks

## Context Window Management

Avoid last 20% of context window for:
- Large-scale refactoring
- Feature implementation spanning multiple files
- Debugging complex interactions

Lower context sensitivity tasks:
- Single-file edits
- Independent utility creation
- Documentation updates
- Simple bug fixes

## Extended Thinking + Plan Mode

Extended thinking is enabled by default, reserving up to 31,999 tokens for internal reasoning.

Control extended thinking via:
- **Toggle**: model-specific settings
- **Config**: Set extended reasoning settings in VS Code settings or `.github/copilot-instructions.md`
- **Budget cap**: model reasoning configuration
- **Verbose mode**: model-specific debug settings

For complex tasks requiring deep reasoning:
1. Ensure extended thinking is enabled (on by default)
2. Enable **structured planning** for structured approach
3. Use multiple critique rounds for thorough analysis
4. Use split role sub-agents for diverse perspectives

## Build Troubleshooting

If build fails:
1. Use **build-error-resolver** agent
2. Analyze error messages
3. Fix incrementally
4. Verify after each fix
