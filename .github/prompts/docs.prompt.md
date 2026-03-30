---
name: "docs"
description: "Look up current library, framework, or API documentation and answer with concise guidance and examples."
agent: "docs-lookup"
argument-hint: "Describe the library and the question to answer"
---

Use [the repository-wide instructions](../copilot-instructions.md) and the relevant instruction files in [../instructions](../instructions).

1. Identify the library, framework, or API the user is asking about.
2. Use current documentation when available rather than answering from memory alone.
3. Return the smallest accurate answer that solves the question.
4. Include a short code example only when it clarifies the usage.
5. State any uncertainty if the documentation source is unavailable or incomplete.