---
name: "verify"
description: "Verify the current change set by running the relevant validators, tests, diagnostics, and regression checks."
agent: "supporter"
argument-hint: "Optionally scope verification to a specific file, command, or area"
---

Use [the repository-wide instructions](../copilot-instructions.md) and the relevant instruction files in [../instructions](../instructions).

1. Work in read-only mode. Inspect the current change set and existing diagnostics before suggesting anything.
2. Verify in this order:
   - Confirm the latest file contents are saved.
   - Check current problems or diagnostics.
   - Run the narrowest relevant validation commands first.
   - Re-run broader regression checks when the narrow checks pass, prioritizing final verification or high-risk change sets.
3. Prefer the repository defaults unless the user gives a narrower scope:
   - `node scripts/ci/validate-copilot-customizations.js`
   - `node scripts/ci/validate-github-hooks.js`
   - `node scripts/ci/validate-no-personal-paths.js`
   - `npx markdownlint <touched files>`
   - `npm test` for final verification or high-risk change sets
   - `npm run lint` for final verification or high-risk change sets
4. Operate in verification-only mode. Do not use edit tools or implementation handoffs unless the user explicitly asks for fixes.
5. Report checklist outcomes alongside the verification results:
   - `neutral` when no checklist tool was used in the current session
   - `blocked` when checklist items remain incomplete
   - `pass` when the checklist is complete
