---
name: "fix-test"
description: "Diagnose a failing test, build, or validator run and make the smallest safe fix that restores green status."
agent: "build-error-resolver"
argument-hint: "Describe the failing command, test name, or error output"
---

Use [the repository-wide instructions](../copilot-instructions.md) and the relevant instruction files in [../instructions](../instructions).

1. Identify the failing test, build, or validator command and the narrowest reproducible scope.
2. Reproduce or inspect the failure, then isolate one concrete breakage at a time.
3. Apply the smallest safe fix that restores the failing test or validation path.
4. Re-run the narrow check first, then report any remaining failures or broader regression risk.
5. Stop and report blockers if the fix requires environment changes, dependency installation, or wider refactoring.
