## Implementation brief — a-finished-plan-delivers-and-clears-up (wave: Extracted)

- **Plan (canonical):** `docs/plans/2026-08-27-a-finished-plan-delivers-and-clears-up.md` on main
- **Approved:** 2026-08-27, Jan Wloka, in-session
- **Branch:** `feature/plot-deliver-has-a-script` (base: `main`)
- **Ends as:** one PR to `main`

**Wave 2 of 3.** `Delivered` follows and calls what you build. `Landed` is
independent and may be in flight beside you on `plot-reap.sh` — different file.

### What to build

The mechanical half of delivery moves into `skills/plot/scripts/plot-deliver.sh`,
and `/plot-deliver` calls it.

**`plot-approve.sh` is the template — read it first.** This wave is the same
split, done for the same reason, and the shape is already proven:

```
no Approve command:    board → plot-approve.sh
with Approve command:  board → agent → SKILL.md → plot-approve.sh
```

The mechanical steps for delivery are the ones `/plot-deliver` step 7 performs
today: flip `Phase: Approved` → `Delivered`, fill the `Delivered:` record, move
the `active/` → `delivered/` symlink, update the sprint annotation, push via
`plot-push-main.sh`.

### **This wave changes NO behaviour** (`Done when` item 9)

`/plot-deliver` must deliver exactly what it delivered before, by the same rules.
Only the location of the writes moves. If your diff changes what gets delivered,
or when, the wave has overreached — that is `Delivered`'s job, and it depends on
this one being a faithful extraction.

### The decisions the plan settles — do not re-derive them

**Why this wave exists at all:** the board never writes a plan file. `approve.ts`
writes only state and prompt files and shells out; the repo's rule is *board
writes wrap scripts, or they are licensed repairs — the board never invents a
lifecycle transition*. There is no `plot-deliver.sh`, so the next wave had a
caller with nothing safe to call. Without this extraction an implementer would
rebuild the phase flip, the record and the symlink move in TypeScript, which is
the drift the approve split removed.

**Idempotent, and re-running is the repair** (item 8). `plot-approve.sh` says why:
one step writes irreversibly to the host, so an interruption after it leaves the
work half-done. Every step must test the SOURCE it would have written — never a
progress file — so a second run completes what the first left and changes nothing
already done.

**The `Delivered:` record is load-bearing, not provenance.** `plot-fleet-scan.sh`
reads its rolling window from `delivered_raw`. A phase flip without the record
makes the plan invisible to the scan rather than delivered — measured in this
repo. Write both, in the same commit.

**The index write is best-effort and must not fail the delivery.** `/plot-deliver`
step 7 spells this out: a plan with no `active/` link (the ordinary shape for a
plan written directly) once aborted the delivery of finished work. Use
`git rm --ignore-unmatch`, `ln -sfn`, `|| true`. The phase edit and the record are
the transition; the symlink is browsing convenience.

**Refuse on its own preconditions**, the way `plot-approve.sh` refuses a non-Draft
plan and a draft/closed/absent PR. Here: a plan not in `Approved`, and any
non-deferred branch unmerged. Report the reason on stderr and exit non-zero — do
not work around a refusal.

**The judgement stays in the skill.** `/plot-deliver`'s completeness check (step
5) and its partial-deliverable question are a person's, and they do not move into
the script. Manifesto Principle 3: scripts collect and report, skills interpret
and adapt.

### Done when

Items 7, 8 and 9 of the plan are yours. Item 9 — *no behaviour changes* — is the
one an eager implementation fails.

Plus: `pnpm run validate`, `pnpm run test:reconcile`, `pnpm run test:e2e` green
(the e2e suite walks the lifecycle and is where a faithful extraction proves
itself); a changeset with a `bumps:` block naming `plot`; Node 24; `trash` not
`rm`.

Run e2e with `env -u PLOT_UNATTENDED` — the worker's own environment sets it and
poisons a control test.

### Bookkeeping

Annotate the plan's `## Waves` heading on main as `(Branch: x, PR: #N)`. Push
your first real commit as soon as it exists.

### Scope guard

Owns `skills/plot/scripts/plot-deliver.sh` (new), `skills/plot-deliver/SKILL.md`,
and their tests. **Do not touch `packages/board`** — the board wiring is the
`Delivered` wave. `plot-reap.sh` belongs to `Landed`. Rebase onto current main
before you start.
