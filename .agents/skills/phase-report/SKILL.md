---
name: phase-report
description: Produces the end-of-phase (or end-of-session) progress report for the Quiet Growth Media build - completed tasks, working features, remaining tasks, cost incurred and the next exact step. Use when finishing a phase, milestone or work session, or when the user asks for status.
---

# Phase report

The project spec requires this report at the end of every phase. Base every line on evidence (commands run, test output, URLs checked), never on assumptions.

## Gather evidence first

- `npm run check` (typecheck + lint + tests): record the pass/fail counts.
- `npm run db:status`: record applied and pending migrations.
- `GET http://127.0.0.1:3000/health/ready` if the API is running.
- `git status --short` (state of uncommitted work; do not commit unless asked).
- Read the phase checklist in `docs/roadmap.md` and update its checkboxes.

## Report template

```markdown
## Phase N report – <name>

### ✅ Completed tasks

- ...

### 🟢 Working features (verified)

- <feature> – verified by <command / test / URL>

### ⏳ Remaining tasks

- ... (owner: me / you)

### 💰 Cost incurred

- This phase: $X (itemised: provider – amount – what for). "$0" if nothing was paid.
- Expected next-phase costs: ... (with source links and the date pricing was checked)

### ⚠️ Risks / blockers

- ...

### 👉 Next exact step

One concrete action, with who does it. If it's manual, follow the beginner-step-guide skill.
```

Never claim revenue, reach or monetisation outcomes.
