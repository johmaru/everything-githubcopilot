---
name: "JavaScript And Node Standards"
description: "Use when editing JavaScript, TypeScript, Node scripts, validators, or package metadata in this repository."
applyTo: "**/*.js,**/*.cjs,**/*.mjs,**/*.ts,**/*.tsx,package.json"
---

# JavaScript And Node Standards

- This repository is primarily configuration, documentation, and validation code. Optimize for clear structure and deterministic behavior over framework abstractions.
- Treat `.github` as the active Copilot customization surface. If a validator or script still points at legacy ECC directories, migrate it toward `.github` rather than adding more legacy coupling.
- Keep validators and support scripts focused and easy to reason about. Prefer small functions, explicit error messages, and non-destructive failure modes.
- Preserve Node 18+ compatibility and cross-platform behavior in CI. Avoid shell assumptions that only work on one OS unless the workflow is explicitly OS-scoped.
- When changing package metadata or CI-related scripts, update the validation or workflow path assumptions in the same change.
- Run the smallest relevant validation first, then `npm test` and `npm run lint` before finalizing changes.