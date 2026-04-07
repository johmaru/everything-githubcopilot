---
name: "verify"
description: "Run the repository verification loop on the current change set in verification-only mode and report regressions, validation failures, or remaining risks."
agent: "coder"
argument-hint: "Optionally scope the verification target or list the commands you want rechecked"
---

Use [the repository-wide instructions](../copilot-instructions.md) and the relevant instruction files in [../instructions](../instructions).

1. Identify the current change set or the user-specified verification scope.
2. Run the verification loop in this order:
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
   - `blocked` when checklist items remain incomplete in the current session
   - `pass` when checklist usage is present and no incomplete items remain
6. Report the result with explicit `✅` or `❌` status for save check, diagnostics, tests, regression coverage, and checklist state, plus the next recommended action.
