---
name: feature
description: Implement a feature or bugfix end-to-end with sub-agents — research unknown APIs, implement, then review and test in parallel. Use when the user asks to build, add or fix something non-trivial in this project.
---

# Feature workflow (multi-agent)

1. **Understand.** Restate the goal in one line. Read the relevant code. If an API/library detail is uncertain, delegate to the `docs-researcher` agent (one question per agent; run several in parallel if independent).
2. **Plan.** For changes touching more than ~3 files, write a short plan (files, approach, risks) and confirm with the user before editing.
3. **Implement** in the main thread. Focused changes only; follow `.claude/rules/`.
4. **Verify in parallel** — in ONE message, launch both:
   - `code-reviewer` with the list of changed files
   - `test-runner` with the relevant test scope
5. **Fix** confirmed findings and failures, then re-run only the failing checks.
6. **Report:** what changed, which files, how it was verified, what still needs checking.
