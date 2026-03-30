---
name: "Java Hooks"
description: "Java-specific hooks guidelines."
applyTo: "**/*.java,**/pom.xml,**/build.gradle,**/build.gradle.kts"
---

# Java Hooks

> This file extends [common/hooks.md](../common/hooks.md) with Java-specific content.

## PostToolUse Hooks

Configure in VS Code settings or `.github/copilot-instructions.md`:

- **google-java-format**: Auto-format `.java` files after edit
- **checkstyle**: Run style checks after editing Java files
- **./mvnw compile** or **./gradlew compileJava**: Verify compilation after changes
