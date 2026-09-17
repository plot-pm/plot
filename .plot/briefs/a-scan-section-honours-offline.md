## Implementation brief — a-scan-section-honours-offline (wave: A scan section honours offline)

- **Plan (canonical):** `docs/plans/2026-09-17-a-scan-section-honours-offline.md` on `main`
- **Approved:** 2026-09-17, jwloka, in-session
- **Branch:** `bug/a-scan-section-honours-offline` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR review per repo convention

Single-slice plan. Nothing waits on this branch and it waits on nothing.

### What to build

`--offline` and `--no-pr` both set `PR_SOURCE=off`, and the scan's own header
promises *"no git-host network call"*. Section 2 honours it. **Section 6 has no
guard at all** — no `PR_SOURCE` test appears between its loop at
`plot-reconcile-scan.sh:1137` and its `pr-state` call at `:1156`.

Guard the section on `PR_SOURCE`, and where it skips, print a note naming what
it could not resolve — the shape section 2 already uses.

### Read the plan before you start

**This is a CONTRACT fix, not a performance fix**, and the plan's Design says so
after two panel rounds argued it there. Two things follow for you:

- **Section 6 offline is byte-identical to online TODAY.** It reports a correct
  answer. You are trading a correct answer for a kept promise, which is why the
  note matters: an empty section reads as *nothing to report*.
- **Do not expect a speed-up here.** Measured: section 6 costs 0.06 s on this
  estate, while 91.2% of an offline scan is `symlinked_from`'s ~207,000 forks
  before section 1 begins. That is a different defect and not yours.

### The one gate you cannot satisfy by plumbing

*Zero `pr-state` calls from section 6 under each flag, counted against a stub.*
The machinery exists — `test/reconcile/scan.test.mjs:411` already builds a
counting host stub; use it rather than timing anything.

**The online-direction fixture must be SYNTHESIZED.** Measured on this estate:
`delivered=2, reaching_pr_state=0` — both delivered plans are `docs`/`infra` and
`:1143` exempts them before the call. **No real plan here exercises the loop**,
so a test pointed at `docs/plans/` measures nothing. Build plans with a `Type:`
outside `docs|infra`.

### Repo gates

`pnpm run test:contracts`. Do **not** run `pnpm run test:e2e` — that is CI's.
