---
name: "Perl Hooks"
description: "Perl-specific hooks guidelines."
applyTo: "**/*.pl,**/*.pm,**/*.t,**/*.psgi,**/*.cgi"
---

# Perl Hooks

> This file extends [common/hooks.md](../common/hooks.md) with Perl-specific content.

## PostToolUse Hooks

Configure in VS Code settings or `.github/copilot-instructions.md`:

- **perltidy**: Auto-format `.pl` and `.pm` files after edit
- **perlcritic**: Run lint check after editing `.pm` files

## Warnings

- Warn about `print` in non-script `.pm` files — use `say` or a logging module (e.g., `Log::Any`)
