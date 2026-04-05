# The Security Guide to Everything GitHub Copilot

![Header: The Security Guide to Everything GitHub Copilot](./assets/images/security/security-guide-header.png)

---

This guide covers the minimum security bar for a GitHub Copilot-first customization repository.

The short version: once prompts, agents, hooks, MCP servers, and repository content all influence runtime behavior, security stops being a prompt-writing problem and becomes an execution-boundary problem.

---

## Threat Model

Treat these as untrusted inputs unless proven otherwise:

- repository content from third parties
- pull request descriptions and comments
- linked documentation and web content
- attachments and OCR output
- MCP tool output
- legacy configuration carried forward from older harnesses

If untrusted content can influence a tool-using agent that also has shell access, network access, write access, or secret access, you have a real security boundary to manage.

---

## The Main Risk Areas In This Repository

### Legacy Compatibility Paths

This repository carries some historical material in legacy directories and compatibility surfaces.

They are useful as reference, but they increase risk because contributors may accidentally treat them as active authority. Keep the active path explicit: `.github/` first, legacy second.

### Hooks

Hooks can enforce good behavior, but they can also hide dangerous behavior if they are broad, opaque, or under-documented.

Prefer hooks that are:

- deterministic
- auditable
- narrow in scope
- cheap to execute

Avoid hooks that silently orchestrate large workflows, depend on hidden state, or normalize risky shell behavior.

### MCP And Remote Context

MCP can improve documentation accuracy, but every connected tool expands the trust surface.

For this repository, MCP should remain optional and bounded. Do not make core customization behavior depend on remote state that is difficult to audit locally.

---

## Approval Boundaries

The most important security control is not the system prompt. It is the approval boundary between model output and real actions.

Require extra care around:

- unsandboxed shell execution
- network egress
- reading secret-bearing paths
- writing outside the workspace
- deployment, workflow dispatch, or credential changes

If a workflow does not need one of those permissions, do not grant it.

---

## Sandboxing And Isolation

For untrusted work, isolate aggressively.

Good defaults:

- use containers, VMs, or devcontainers for risky repos
- prefer dedicated bot identities over personal accounts
- use short-lived and narrowly scoped credentials
- deny outbound network access by default when possible
- keep production credentials out of development automation paths

The goal is not perfect prevention. The goal is a small blast radius when something goes wrong.

---

## Sanitization Rules

Everything that enters context can influence behavior. That includes text that looks like passive data.

Before privileged automation acts on external content:

- extract only the information needed
- strip hidden or irrelevant metadata where possible
- keep parsing and action-taking as separate steps
- treat tool output and linked content as potentially adversarial

If a workflow mixes untrusted content, private data, and external communication, the risk rises sharply.

---

## Memory And Persistence

Persistent memory is useful, but it can also preserve unsafe instructions or stale assumptions.

Guidelines:

- do not store secrets in memory files
- separate project memory from user-global memory
- rotate or clear memory after high-risk sessions
- keep memory narrow, factual, and disposable
- keep durable memory on the shipped repo surfaces: `.github/sessions/` artifacts plus `.github/sessions/copilot.db`
- use `scripts/hooks/learn-embed.js` for searchable project knowledge so secrets and personal paths are sanitized before storage
- do not make core workflow continuity depend on hosted memory features or remote memory services

Long-lived memory should help execution continuity, not accumulate uncontrolled authority.

---

## Observability

If automation can act, you need a trace of what it attempted.

At minimum, log or be able to reconstruct:

- which tool ran
- which files were touched
- which approval decision was made
- whether network access was attempted
- which session or task triggered the action

Opaque automation is hard to debug and hard to secure. Predictable automation is easier to review and easier to recover from.

---

## Safe Authoring Rules For This Repository

When contributing prompts, agents, hooks, or docs here:

- keep dangerous behavior explicit and reviewable
- avoid examples that normalize unrestricted shell execution
- do not hide important behavior in legacy compatibility files
- document assumptions around MCP or external services
- prefer validator-backed structure over convention-only structure

Security review starts in the authoring model, not after the fact.

---

## Minimum Checklist

- `.github/` is the active source of truth
- legacy assets are treated as compatibility or migration input
- hooks are deterministic and auditable
- MCP use is optional and bounded
- risky actions remain approval-gated
- secrets stay out of memory and docs
- validation runs locally and in CI
- untrusted work is isolated when necessary

If the convenience layer starts outrunning the isolation layer, stop and tighten the design before adding more automation.
