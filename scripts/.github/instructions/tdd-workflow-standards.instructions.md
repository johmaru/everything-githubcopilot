---
name: "Testing And TDD Standards"
description: "Use when implementing or fixing validator scripts, tests, or customization logic with a write-tests-first workflow."
applyTo: "scripts/**/*.js,scripts/**/*.cjs,scripts/**/*.mjs,tests/**/*.js,tests/**/*.cjs,tests/**/*.mjs,tests/**/*.ts,tests/**/*.tsx,package.json"
---

# Testing And TDD Standards

- Follow `RED -> GREEN -> IMPROVE`: add or update the smallest failing test first, confirm the failure reason, then implement the minimum change needed to pass.
- Prefer targeted tests for script and validator behavior before broader repository checks. Use the narrowest command that proves the behavior changed.
- Keep implementation changes tied to observed behavior. If a test is wrong, explain why and update the test deliberately instead of weakening assertions to make the run pass.
- Cover both happy paths and failure modes for parsing, validation, and command execution logic. Boundary cases matter more than raw test count.
- When executable tests do not exist for the affected path, run the nearest validator or diagnostic check and state what remains unverified.
- Before finalizing, report which tests or validations were run and what coverage gaps still remain.