---
name: "Common Quality And Security Standards"
description: "Use when editing Copilot customizations, validation scripts, hooks, or package metadata in this repository."
applyTo: ".github/**/*.md,scripts/**/*.js,scripts/**/*.cjs,scripts/**/*.mjs,package.json,.github/hooks/**/*.json,hooks/**/*.json,mcp-configs/**/*.json"
---

# Common Quality And Security Standards

- Treat `.github` as the active Copilot customization surface and prefer deterministic behavior over implicit or stateful automation.
- Never commit secrets, tokens, credentials, or URLs with embedded authentication. Document required environment variables instead of adding placeholders that look real.
- Treat hook matchers, shell commands, external configuration, and file content as untrusted input. Validate at boundaries and avoid broad command execution when a narrower check will work.
- Fail safely and clearly. Do not swallow errors, and do not leak secrets, machine-specific paths, or unnecessary internal details in user-facing messages.
- When changing scripts or hooks that execute commands, review injection risk, destructive command paths, and cross-platform quoting or escaping in the same change.
- Prefer immutable updates, focused files, and explicit naming so validation behavior stays easy to reason about during migration.
- Run the smallest relevant validation first, then broader repository checks before finalizing changes.