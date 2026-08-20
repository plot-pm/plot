# Brief: feature/reconcile-calls-the-index-advisory

Implement wave **Report** of `docs/plans/2026-08-18-the-index-is-derived.md`.
Read the plan first. Wave 1 (`the-scan-derives-its-plan-list`, #254) merged
2026-08-20 — **its premise is now satisfied, which is what unblocks this wave.**

## Why this wave could not be written before now

The branch line says *"once nothing reads `active/`"*. Until #254 landed, an
unlinked plan really was invisible to the pulse, so reporting it as **orphaned**
was correct. That merge is what makes the same report false: the scan now
enumerates plans from the plan directory and groups them by declared phase, so a
plan with no symlink is fully visible.

Nothing about the report was wrong when it was written. It expired.

## What to change

**`plot-reconcile-scan.sh` section 5 stops calling an unlinked plan orphaned.**
The line is at **~425**:

```
attention_out+="  $base — phase '$raw_phase' but NO symlink in $ACTIVE_DIR/ or $DELIVERED_DIR/ (orphaned)\n"
```

An unlinked plan is not orphaned — it is visible everywhere that matters. Index
drift is now a **convenience-level** finding: the symlinks still serve human
browsing, and a missing one is worth mentioning, but it is not something needing
attention and must not inflate the `attention` count that gates hygiene sweeps.

**A dangling symlink is a different fact and keeps its severity.** A link
pointing at nothing is a broken pointer, not a stylistic gap — the plan's test
names exactly this contrast.

## A contradiction between two scripts, and this branch is where it surfaces

Measured 2026-08-20, `attention=1`, and the one entry is not an unlinked plan:

```
2026-08-18-the-repair-exists-report.md — no phase field (pre-plot / legacy plan)
```

**#254 decided that a file with no `Phase:` is not a plan** — `docs/plans/` holds
decision logs and worker reports, and the fleet scan skips them. This script
still treats the same file as a plan that needs attention. Two scripts, one
file, opposite verdicts.

Decide it deliberately and say which way in a comment. Either this script adopts
#254's rule (a phase-less file is not a plan, so it is not reportable), or it
keeps flagging such files for a stated reason — *"a file in the plan directory
that nobody has classified is worth a human glance"* is a defensible position.
**What must not survive is the disagreement**, because two consumers of one
directory answering differently is how the invisible-plan incident happened in
the first place.

If you judge this beyond the wave's scope, say so and leave it — but say it,
rather than leaving a reader to discover the split.

## Definition of Done

- An unlinked plan produces **no** `attention` count
- A symlink pointing nowhere **still** does
- Index drift is reported at convenience level, distinguishable in the output
  from things needing attention
- The machine-countable footer still parses, and `attention` reflects the new
  rule — assert the number, not just the text
- The phase-less-file disagreement with `plot-fleet-scan.sh` is resolved or
  explicitly deferred with a reason
- `pnpm test`, `pnpm run test:reconcile` pass — one at a time
- A changeset with a `bumps:` block

## Do not

- Do not delete `active/` or stop writing it — `/plot-idea`, `/plot-deliver` and
  `plot-approve.sh` still maintain it, and whether it survives as a browsing
  convenience is the plan's first Open Point
- Do not touch `/plot-idea` or `/plot-deliver` — that is wave 3
  (`the-lifecycle-does-not-need-the-symlink`)
- Do not touch `plot-fleet-scan.sh`; #254 settled its half

## Platform notes

CI runs Linux; you are probably on macOS. Run the suites **one at a time** —
concurrent runs produce false timeout failures that do not reproduce serially.

CI now bounds its own steps (3 min on the Playwright install, 15 on the
integration suite, 25 on the job), so a hang fails fast instead of blocking.

**Line numbers here may drift** — follow the rule, not the number.

If you find something the plan did not anticipate, implement what you can and
report the discovery rather than improvising.
