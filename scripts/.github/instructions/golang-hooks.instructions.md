---
name: "Golang Hooks"
description: "Golang-specific hooks guidelines."
applyTo: "**/*.go,**/go.mod,**/go.sum"
---

# Go Hooks

> This file extends [common/hooks.md](../common/hooks.md) with Go specific content.

## PostToolUse Hooks

Configure in VS Code settings or `.github/copilot-instructions.md`:

- **gofmt/goimports**: Auto-format `.go` files after edit
- **go vet**: Run static analysis after editing `.go` files
- **staticcheck**: Run extended static checks on modified packages
