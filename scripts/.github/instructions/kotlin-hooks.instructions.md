---
name: "Kotlin Hooks"
description: "Kotlin-specific hooks guidelines."
applyTo: "**/*.kt,**/*.kts,**/build.gradle.kts"
---

# Kotlin Hooks

> This file extends [common/hooks.md](../common/hooks.md) with Kotlin-specific content.

## PostToolUse Hooks

Configure in VS Code settings or `.github/copilot-instructions.md`:

- **ktfmt/ktlint**: Auto-format `.kt` and `.kts` files after edit
- **detekt**: Run static analysis after editing Kotlin files
- **./gradlew build**: Verify compilation after changes
