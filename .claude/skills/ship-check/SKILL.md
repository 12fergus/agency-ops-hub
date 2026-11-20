---
name: ship-check
description: Pre-commit / pre-deploy checklist — run lint, types and tests, scan the diff for secrets, debug leftovers and destructive migrations. Use when the user says "ready to commit", "check before deploy", or "ship it".
---

# Ship check

1. `git status` and `git diff` — list what will ship.
2. Scan the diff for: secrets/tokens, `.env` values, `console.log`/`dd()`/`var_dump`, commented-out blocks, TODOs added in this change.
3. Flag migrations or schema changes and state their rollback.
4. Delegate lint + types + tests to the `test-runner` agent.
5. Output a checklist: ✅/❌ per item, blockers first. Do not commit or push unless asked.
