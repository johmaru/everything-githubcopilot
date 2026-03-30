---
name: "Rust Hooks"
description: "Rust-specific hooks guidelines."
applyTo: "**/*.rs,**/Cargo.toml"
---

# Rust Hooks

> This file extends [common/hooks.md](../common/hooks.md) with Rust-specific content.

## PostToolUse Hooks

Configure in VS Code settings or `.github/copilot-instructions.md`:

- **cargo fmt**: Auto-format `.rs` files after edit
- **cargo clippy**: Run lint checks after editing Rust files
- **cargo check**: Verify compilation after changes (faster than `cargo build`)
