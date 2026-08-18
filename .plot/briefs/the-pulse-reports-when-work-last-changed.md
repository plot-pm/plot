# Brief: feature/the-pulse-reports-when-work-last-changed

Implement `docs/plans/2026-08-18-the-pulse-measures-progress-not-elapsed-time.md`.

Read it first. The measurement behind it is settled: **do not re-derive it.**

## The bug

Measured across four concurrent workers on 2026-08-18:

| Branch | Runtime | Commits | Outcome |
|---|---|---|---|
| `the-gate-reads-what-was-shared` | 55 min | 4 | **opened its PR** — the session's hardest bug |
| `the-scan-enumerates-the-ref` | 27 min | 0 | uncommitted, nothing written for 6 min |

The longest-running worker was the **most productive**. Runtime carried no
signal about health, and an operator watching the clock would have restarted
exactly the wrong one.

`local_ahead` and `local_dirty` are **state**, not **change**: a branch with an
open PR and four commits behind it reads `ahead=0 dirty=False` — identical to
one claimed a minute ago and abandoned.

## What to build

`changed_ago_seconds` beside `local_ahead` and `local_dirty`, computed as the
max of:

- the newest commit's timestamp (`git log -1 --format=%ct`)
- the newest mtime among tracked-but-modified and untracked files, **excluding
  editor leftovers** (`.tmp*`, `.swp`, `.orig`, `.rej`, `.bak`)
- the worker log's mtime, when one exists

A branch with no worktree on this machine reports it **absent** — the same
*cannot see* that `elsewhere` already uses. Never a fabricated zero.

## The scan reports the number and draws no conclusion

"Stuck" depends on what the branch is doing: fifteen minutes of silence is
alarming during an edit and unremarkable during `test:board`, which takes that
long by itself. The threshold belongs to the reader; the measurement belongs
here.

## A fact the plan did not have

Measured after it was written: a worker deep in a serial test run writes no
file for minutes while its **child processes** are working. `changed_ago_seconds`
will report that worker as quiet, correctly — the number is honest, and the
reader must not be led to conclude "stuck" from it alone. Keep the output a
measurement, and say so in whatever the scan documents.

## Do not

- **Do not add a verdict.** No `stalled`, no threshold, no "probably stuck".
  `plot-worker-state.sh` owns worker verdicts and gained `waiting`/`stalled` in
  PR #219 — this branch adds a number, not an opinion.
- **Do not restart anything.** The scan is read-only (Manifesto Principle 1).
- **Do not pay for branches with no local worktree.** Skip them entirely; the
  plan's cost argument depends on it.

## An open point you must answer

Should `changed_ago_seconds` also cover the **pushed** branch — a worker on
another machine changes a ref, and that is evidence this machine cannot see in
a worktree? `git log -1 origin/<branch>` would catch it at the price of a
second call per branch. Decide, implement or defer, and **say which and why**.

## Definition of Done

- A worktree touched a second ago reports near zero; one untouched for an hour
  reports that hour
- A branch with no worktree reports **absent**, never zero
- A `.tmp1` written now does **not** reset the clock
- Branches with no local worktree cost nothing extra
- `pnpm test`, `pnpm run test:reconcile`, `pnpm run test:e2e`,
  `pnpm run test:board` pass — run the suites **one at a time**
- A changeset with a `bumps:` block

## Coordination

`plot-fleet-scan.sh` is yours alone right now. Your change sits beside the
`local_dirty` computation.

## Platform note

CI runs Linux; you are probably on macOS. **`stat -f` does not fail cleanly on
GNU** — it prints a filesystem report to stdout and then exits 1, so a
`bsd || gnu` fallback concatenates both. Detect the format once. This exact
fault was found here on 2026-08-18.

If you find something the plan did not anticipate, implement what you can and
**report the discovery** rather than improvising.
