# Brief: feature/the-scan-derives-its-plan-list

Implement wave **Derive** of `docs/plans/2026-08-18-the-index-is-derived.md`.
Read the plan first. This is the first of three waves, and the only one to
build now — see *Why the other two waves wait* below.

## What the scan does today

`plot-fleet-scan.sh:167` reads `ACTIVE_DIR` and globs it. Line 1421 records the
consequence in its own comment:

> *"The pulse read `active/` only, so a plan left the view the INSTANT it was …"*

So a plan is visible because a symlink exists, not because the plan says it is
active. Measured 2026-08-19: **64 plan files, 6 `active/` symlinks, 56
`delivered/` symlinks.** Every one of those 62 links is hand-maintained, and
whoever forgets one makes a real plan invisible.

That is not hypothetical. The plan's own Notes record the origin: a live
two-agent dispatch where an invisible plan was **misdiagnosed three times as a
board defect** before anyone looked at the index. And it kept happening — the
session that wrote this brief created six symlinks by hand today, one of them
for the plan that carries this very branch.

## What to build

**Enumerate plans from the plan directory and group them by their declared
phase**, not by which symlinks exist.

The phase is in the file, `plot-plan-meta.sh` already reports it, and it is the
plan's own statement about itself. A symlink is a second copy of that statement
maintained by hand — and the two disagree the moment someone forgets.

**`active/` keeps working.** Do not delete it, do not stop writing it. This wave
makes nothing *depend* on it being right; whether it survives as a browsing
convenience is the plan's first Open Point and stays open.

**Two tests carry the whole change**, both named in the plan:

- a plan with **no symlink must appear**
- a symlink pointing at a **delivered** plan must **not** resurrect it

The second is the direction people forget. If the phase decides, then a stale
link is inert — and a test that only proves the first case would pass on an
implementation that still lets `active/` override the file.

**Not every `.md` in the plan directory is a plan.** Measured: two of the 64
files are notes — `the-repair-exists-report.md` and
`kanban-board-v1-open-questions.md`, neither carrying a `Phase:` field. Today
the symlink glob excludes them by accident. Decide deliberately what makes a
file a plan (a parseable `Phase:` is the obvious answer) and state it; a scan
that reports two notes as phase-less plans has traded one wrong list for another.

## Why the other two waves wait

`feature/reconcile-calls-the-index-advisory` is deliberately **not** in scope,
and not merely for size. Its whole premise is *"once nothing reads `active/`"* —
today an unlinked plan really is invisible, so reporting it as a problem is
correct. Only after this wave lands does that same report become false.

Building both together would mean writing wave 2 against a condition wave 1
had not yet created. Report if you find the boundary wrong; do not cross it.

## Definition of Done

- A plan with no symlink appears in the scan
- A symlink pointing at a delivered plan does not resurrect it
- What counts as a plan file is decided explicitly and stated in a comment
- `active/` is neither deleted nor stopped being written
- The scan's existing output shape is unchanged for every plan that IS linked —
  assert it, so the change is provably about coverage rather than format
- `pnpm test`, `pnpm run test:reconcile`, `pnpm run test:e2e` pass — one at a time
- A changeset with a `bumps:` block

## Do not

- Do not touch `plot-reconcile-scan.sh` — that is wave 2, whose premise this
  wave creates
- Do not change `/plot-idea` or `/plot-deliver` — that is wave 3
- Do not remove `active/` or stop maintaining it
- Do not touch the board; it consumes this scan and must see no shape change

## Platform notes

`plot-fleet-scan.sh` is ~1900 lines and four separate changes landed in it
today. **Rebase before you push.** The awk in the sibling script broke on an
apostrophe in a comment today — if you add awk comments, avoid apostrophes.

CI runs Linux; you are probably on macOS. Run the suites **one at a time** —
concurrent runs produce false timeout failures that do not reproduce serially.

**Line numbers here may drift** — a sibling agent found one off by 280 lines
today. Follow the rule, not the number.

If you find something the plan did not anticipate, implement what you can and
report the discovery rather than improvising.
