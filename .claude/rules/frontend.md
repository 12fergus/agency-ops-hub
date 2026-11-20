---
paths:
  - "**/*.{js,jsx,ts,tsx,mjs,cjs,vue}"
  - "**/*.{css,scss,html}"
---

# Frontend / JS rules

- Prettier with single quotes; runs automatically via hook if prettier is installed locally.
- Prefer TypeScript for new modules when the project already has `tsconfig.json`.
- Use the package manager the lockfile indicates (`package-lock.json` → npm, `pnpm-lock.yaml` → pnpm, `yarn.lock` → yarn).
- RTL: layouts must work with `dir="rtl"` (Hebrew/Arabic). Use logical CSS properties (`margin-inline-start`, `padding-inline-end`) instead of left/right.
- Tracking: push events to `dataLayer` on confirmed success (server response OK), never on button click.
