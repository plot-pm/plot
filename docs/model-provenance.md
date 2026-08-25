# Model Provenance

Which model class Plot's skills were authored and tuned against. Skills are
prompts; a model update can change behaviour with no commit to this repo. This
file makes that dependency visible.

## Current

| Period | Model class | Notes |
|--------|-------------|-------|
| 2026-02 → 2026-07 | Claude Opus 4.x / Sonnet 4.x (Claude Code) — **unconfirmed** | Original authoring and the documented lifecycle test runs. The dates are from git history (first commit 2026-02-07); the model class is inferred from that period and has not been confirmed by the authors. Treat as approximate until someone who ran those sessions verifies it. |
| 2026-07 → | Claude Opus 5 | First model class for which known long-horizon failure modes were explicitly designed against — see `docs/plans/2026-07-25-opus5-longhorizon-hardening.md`. |

## Why this is tracked

A skill that reads clearly to one model class may be followed differently by the
next. Behavioural regressions after a model update are not necessarily regressions
in the skill text. Recording provenance turns "Plot broke" into the answerable
question "did the skill change, or did the model?".

The `## Model Guidance` table in each skill records the *minimum* tier a step
needs — a floor, not a target. This file records something different: which model
the wording was actually tuned against. Those are independent facts, and only the
second one changes when a provider ships an update.

## Updating this file

When Plot's skills are re-tested or re-tuned against a new model class, add a row.
State the class, not the exact snapshot — the point is which generation the wording
assumes, not reproducing an exact build.

Behavioural testing is manual (see `CLAUDE.md` → Testing). A row here means a full
lifecycle walkthrough was run against that model class, not that it is expected to
work. If a row is inferred rather than verified, say so in the Notes column, as the
first row does.
