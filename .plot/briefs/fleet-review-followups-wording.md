## Implementation brief — fleet-supervisor-holds-scale-slots-too (wave: Log and wording)

- **Plan (canonical):** docs/plans/2026-10-24-fleet-supervisor-holds-scale-slots-too.md on main
- **Approved:** 2026-10-24, Jan Wloka, plan-PR #2536 merged
- **Branch:** `bug/fleet-review-followups-wording` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention (CODEOWNERS / PR review)

This is the plan's third and last slice. Both earlier slices are merged:
`bug/fleet-supervisor-liveness-bounds` → #2564 and
`bug/fleetctl-start-checks-configured-label` → #2642. Nothing waits on this
slice, and it waits on nothing — it touches comments, a changeset, a plist,
one doc header, one SKILL.md example, and one log call; no behaviour the
other two slices exercise.

### What to build

Finding 3 of issue #2486 named five LOW items. Checked against `main` today:
four are still open, one line item (the `queue.test.ts` describe block) needs
re-verifying since slice 1 may have moved code around it.

1. **`refreshDefaultBranch` logs a lasting cause on every tick, not once.**
   `packages/fleet/src/shared/default-branch-refresh.ts` takes a bare
   `warn: (line: string) => void` with no memory between calls (confirmed:
   no `lastCause`/`lastWarned` state anywhere in the file or its caller at
   `registryd-main.ts:2245`). Each of its four `warn(...)` call sites
   (lines 181, 187, 204, 228) fires every tick the cause persists — a
   lasting read failure logs identically every 60s forever. Make it warn
   once per cause and warn again only when the cause changes or the
   reading recovers. This needs a piece of state threaded through
   `refreshDefaultBranch`'s signature (or closed over at the call site) —
   decide which based on what's simplest for the one caller in
   `registryd-main.ts`.

2. **`plot-config.sh`'s own key-reference comment never lists `Fleet
   label`.** The "Known keys" block at `skills/plot/scripts/plot-config.sh:29`
   documents every other config key the fleet reads (`Worker bound`, `Agent
   registry`, `Agent settings`, etc.) in the same one-line-plus-wrapped-detail
   style. `Fleet label` is read by `plot-fleetctl.sh` (confirmed:
   `skills/plot/scripts/plot-fleetctl.sh:629` checks it) but has no entry
   here — a reader of this file's header has no way to learn the key
   exists. Add one, following the existing entries' format, stating that
   `--start` now checks this key ahead of the default label (slice 2's
   change) rather than the env var alone.

3. **The plist and its README overstate `PLOT_FLEET_LABEL` as the only
   lever.** `skills/plot/units/com.plot-pm.fleetd.plist` lines 7–8 and
   20–22 say "a second checkout sets `PLOT_FLEET_LABEL` before
   `plot-fleetctl.sh --start`" — true before slice 2, incomplete after:
   `--start` now checks the `Fleet label` config key too (and the default
   label), so a checkout can declare the key in its config instead of
   exporting the env var. Update both comment blocks to name the
   precedence slice 2 built, not just the env var. Check
   `skills/plot/units/README.md` for the same claim — it's in the grep
   hit list alongside the plist and both SKILL.md files.

4. **`skills/plot-fleet/SKILL.md:259` shows a stale example desk name**
   (`plot-wt-free-3 (pid 71200)`). Swap it for a current-shaped desk name
   per the plan's wording — check what the board/fleet actually names free
   desks now (`plot-wt-free-N` may already be right; if so this item is a
   pid or surrounding-context staleness, not the prefix — read the
   surrounding example block before changing anything).

5. **`packages/domain/test/queue.test.ts:995`'s describe block sits between
   a doc comment and the block it documents.** Re-check this against
   current `main` — slice 1 touched `rules/queue.ts` and its tests
   (`readQueue` gained an `alive` reading), so confirm the doc
   comment/describe-block ordering issue the plan named is still present
   at that line before moving it; line numbers may have shifted.

6. **`registryd-main.ts:2641`'s comment should say the refused hold prints
   its reason too.** Read the comment block at that line (context above,
   the `QUEUE_HOLDS` loop and the `waits` hold's `prerequisiteAnswer`
   note) and add the one line about the refused hold's reason, matching
   the existing comment's voice.

### Rules carried over unchanged

- **Domain rules take readings as values, never ports** (`CLAUDE.md`, *The
  Domain Package*). If item 1's fix touches `packages/domain`, the warn-once
  state is a value passed in, not something the rule awaits or fetches.
- **Arrow functions in `packages/domain/src/`** — any new helper there is
  `const f = (...) => ...`, never `function f(...)`.
- **TSDoc/comments state current behaviour, not decision history.** Item 6's
  added line says what the code does now; it doesn't narrate why the
  earlier comment missed it.

### Done when

The plan's `## Done when` is implicit in its Motivation and Design sections
(this plan has no separate `## Done when` heading) — treat finding 3's five
items, checked against current `main`, as the specification: items still
open get fixed, items already resolved by slices 1–2 get confirmed and
dropped from the PR description with a one-line note of what already
covers them.

Plus: the repo's gates. `scripts/check-shell-lines.sh` refuses a PR whose
shell under `skills/` grew past its merge base — none of these six items
touch `.sh` files in a way that should grow line count (item 2 adds lines to
a comment block in `plot-config.sh`, which **is** shell; if it tips the
gate, remove an equal number of comment lines elsewhere in the same file
rather than trimming the new entry short of the other keys' detail level).
No changeset is obviously required — these are wording/log-cadence fixes
with no user-facing behaviour change beyond item 1's log frequency; decide
per `## Versioning` in `CLAUDE.md` whether item 1 counts as a patch-worthy
fix (it changes operator-visible log output).

Run `node skills/plot/scripts/board/plot-local-checks.mjs` (path resolved
from this skill's directory) before each push and run what it prints. The
suites in the `CI suites` config key run in CI; a failure there comes back
as a correction. List no full suite in the brief beyond that command.

### Bookkeeping

Open the PR through the controller once the branch has its first real
commit:

```bash
skills/plot/scripts/plot-open-pr.sh          # the current branch
```

When the PR is created, append `→ #<number>` to this branch's line in the
plan's `## Slices` section (`### Log and wording` heading, the
`bug/fleet-review-followups-wording` line at line 65 of the plan). Push the
first real commit as soon as it exists — don't wait for the full six-item
sweep before the branch's claim shows activity.

### Scope guard

This branch owns: `packages/fleet/src/shared/default-branch-refresh.ts` and
its caller in `packages/fleet/src/server/entry/registryd-main.ts` (the warn
plumbing only — not the surrounding PR/queue/channel logic in that file),
`skills/plot/scripts/plot-config.sh` (header comment only), the plist and
README under `skills/plot/units/`, `skills/plot-fleet/SKILL.md`, and
`packages/domain/test/queue.test.ts` (describe-block placement only, if
still applicable).

Both sibling branches of this plan are already merged (#2564, #2642) — there
is no other branch in flight on this plan to collide with. If you find
wording or log-cadence issues beyond the six items above while reading
these files, report them rather than expanding scope; this plan's
Motivation section is the bound.
