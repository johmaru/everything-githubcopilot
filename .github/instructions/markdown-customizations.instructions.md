---
name: "Markdown Customization Standards"
description: "Use when editing Markdown instructions, prompt files, agent files, docs, or migration notes in this repository."
applyTo: "**/*.md"
---

# Markdown Customization Standards

- Use `.github/copilot-instructions.md` for short always-on guidance only.
- Use `.github/instructions/*.instructions.md` for file-scoped rules with explicit `applyTo` patterns.
- Use `.github/prompts/*.prompt.md` for reusable slash workflows.
- Use `.github/agents/*.agent.md` for persistent specialist personas.
- Put trigger phrases in each `description` field so Copilot can discover the file without guesswork.
- Avoid duplicating the same rule across multiple files. Link to the relevant instruction or prompt instead.
- Keep frontmatter valid YAML. Quote strings that contain punctuation or commas.
- Do not reintroduce Claude-specific authority language into active Copilot files. Legacy directories are migration inputs unless a task explicitly targets compatibility work.