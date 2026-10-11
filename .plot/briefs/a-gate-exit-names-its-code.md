## Implementation brief — the-tests-and-gates-close-their-review-findings (wave: Gate exit wording)

- **Plan (canonical):** `docs/plans/2026-10-10-the-tests-and-gates-close-their-review-findings.md` on main
- **Approved:** 2026-10-10, Jan Wloka, plan-PR #1495 merged
- **Branch:** `bug/a-gate-exit-names-its-code` (base: `main`)
- **Ends as:** one PR to main
- **Review of the code:** PR

This is the last branch in this plan's wave list — no slice merges after
it, and no branch merges before it is blocked on. All six branches above
it ("Group signal after exit" through "Bundle declaration pairing") are
already merged into `main`.

### What to build

Issue #1485, against `skills/plot/scripts/plot-install-hooks.sh`'s
`--verify` path. Two findings, both in the retry logic around
`drive_gate` (`:279-286`) and its caller (`:409-427`):

**L1 — the report line lies about why the gate stopped answering.**
`drive_gate` returns `3` for *any* exit of 128 or more (`:284-285`,
`[ "$rc" -lt 128 ] && return 1; return 3`), and the caller's `rc=3`
branch (`:423`) always prints the same sentence:

```
unverified  <gate> — a signal ended the gate twice; Claude Code reads that exit as non-blocking, so it permits
```

That sentence is true for `SIGSEGV` (139), `SIGABRT` (134) or `SIGKILL`
(137) — a real signal, OS-delivered, no custom script logic involved.
It is not true for a gate that calls `exit 255` itself: nothing killed
it, it chose that exit. "A signal ended the gate" asserts a mechanism the
exit code alone cannot support, and the operator reading the report has
no way to tell a self-inflicted 255 from an externally-delivered 137
without rerunning it by hand. The fix: `drive_gate` keeps its three-way
contract (0 refused, 1 permitted, 3 "ended at 128+") but the report line
gives the raw exit code instead of asserting a cause — the test
assertion to match (per the plan's `## Findings`) is wording like

```
unverified  <gate> — exited 255 twice (128 or more); Claude Code reads that exit as non-blocking, so it permits
```

i.e. name the number, keep "128 or more" as the category label, drop
"a signal ended the gate" as a claim. `drive_gate` must therefore pass
its raw `$rc` out of the function (not just the 0/1/3 classification) so
the caller can print it — printf it to a scratch file, or have
`drive_gate` print `3 <rc>` on stdout for the `rc>=128` case and have the
caller parse the second field. Either mechanism is fine; keep whichever
reads more like the surrounding script's existing style (`PIPESTATUS`,
scratch-file capture — see `new_scratch_repo`/`stderr.$$` just above it).

**L2 — no test proves the retry runs in a fresh repository.** The plan's
own-signal retry comment at `:409-412` ("a signal-ended probe runs once
more on a fresh repo") is asserted nowhere: the existing
`--verify reads a gate a signal ended once, then refused, as verified`
test (`install-hooks.test.mjs:595-608`) proves the *count* of runs (2)
and the *verdict* (verified), not that the second run happened in a
different working directory from the first. Add:

1. A test for a signal on the first probe and a **permit** (not a
   refusal) on the second — currently only "ends once then refuses" and
   "ends twice" are covered; "ends once then permits" is a third
   outcome and it is unverified, not verified, because a probe that
   permitted never demonstrated a refusal.
2. `signalStub` (`:579-593`) gets a variant that records `process.cwd()`
   (or equivalent — the gate stub already appends one line per run to a
   log file; add the cwd to that line) on each run, so a test can assert
   the two recorded directories differ. Each `new_scratch_repo` call in
   `plot-install-hooks.sh` (`:263-270`) makes a fresh `$scratch/r$RANDOM$$`
   directory per probe call — the stub needs to observe that from the
   outside.

### The decisions the plan settles — do not re-derive them

**The wording change is the whole fix — no change to the 0/1/3
contract.** `drive_gate`'s return-code classification (refused / permitted
/ ended-at-128+) is correct and unchanged by this slice; only the string
printed in the `rc=3` branch of the caller loop changes, to carry the
actual exit code instead of a signal claim. Do not touch the `[ "$rc"
-lt 128 ]` threshold or the retry-once-on-3 control flow at `:413`
(`"$prober" "$gp"; rc=$?; [ "$rc" = 3 ] && { "$prober" "$gp"; rc=$?; }`).

**"128 or more" stays as the category name.** The finding does not ask
for distinguishing a true signal exit (128+signum, e.g. 137 for SIGKILL)
from a bare `exit 255` at the classification level — `drive_gate` still
cannot tell them apart from the exit code alone, and nothing here claims
otherwise. What changes is only that the report stops *asserting* "a
signal ended it" when the evidence is silent on that. Printing the raw
number lets a human reading the report do that inference themselves
(255 looks deliberate; 137 looks like SIGKILL) instead of the script
asserting a specific, sometimes-wrong cause.

**This branch is under `skills/`, so the shell-line ratchet applies.**
`scripts/check-shell-lines.sh` compares the shipped line count under
`skills/` against this branch's merge base. The wording fix is a
same-line string edit (net zero or near-zero lines); passing the raw
exit code through likely adds one or two lines to `drive_gate` or its
caller. If the net change is positive, remove an equal number of lines
elsewhere in `plot-install-hooks.sh` in the same change — the gate
stores no number and grants no exemption. Check with
`scripts/check-shell-lines.sh` (it prints its own usage for a local,
pre-push run) before opening the PR.

**No slice follows this one.** Unlike every earlier brief in this plan,
there is no "files the next wave needs untouched" caveat — this is the
last entry in `## Slices`. The scope guard below is about this branch's
own blast radius, not about leaving room for a sibling.

**Off-limits files still apply.** The plan's `## Design` section
reserves every `plot-*-gate.sh` file for the sibling plan
`the-gates-are-launchers` in the same sprint. `plot-install-hooks.sh`
itself is not a `*-gate.sh` file — it is the installer/verifier that
*drives* the gates — so it is this slice's to change. Do not edit any
`skills/plot/scripts/plot-*-gate.sh` file even if the wording there looks
related.

### Done when

The plan's `## Done when` is implicit in its `## Findings that still
hold` entry for #1485 — both bullets closed:

- The `unverified` line for an `rc=3` outcome names the actual exit code
  (e.g. "exited 255 twice (128 or more)"), not "a signal ended the gate".
- `test/reconcile/install-hooks.test.mjs` gains a test for "signal on
  probe 1, permit on probe 2" (a `verified` or `unverified` outcome
  distinct from today's two covered cases — work out which verdict is
  correct from `drive_gate`'s contract: a `1` on the second run means
  "permitted", which is `unverified`, not `verified` — don't assume it
  slots into the existing "ends once, refuses" test's expectations), and
  `signalStub` exposes the working directory per run so a test can
  assert the two runs used different scratch repositories.

Plus: a `plot` patch changeset (description first, `bumps:` block last,
per `CLAUDE.md`'s versioning section) — this slice changes shipped shell
under `skills/`. Run `node skills/plot/scripts/board/plot-local-checks.mjs`
before each push and run what it prints — it resolves the tests and
gates this branch's changed files actually need. The suites in this
repo's `CI suites` config key run in CI on the PR; do not run them
locally. Name the shell gate explicitly: `scripts/check-shell-lines.sh`
refuses a PR whose shipped shell under `skills/` grew past its merge
base — see the ratchet note above.

### Bookkeeping

Open the PR through the controller, not `gh pr create`:

```bash
skills/plot/scripts/plot-open-pr.sh
```

It reads the plan, finds this branch under the "Gate exit wording"
heading, and opens the PR with that heading as title and the plan plus
this brief in the body. When it returns the PR number, append `→ #<N>`
to this branch's line in the plan's `## Slices` section (after "Gate
exit wording" / `bug/a-gate-exit-names-its-code`), and commit that to the
plan file on `main`. Push the first real commit as soon as it exists —
do not wait for the full slice to open the PR.

### Scope guard

This branch owns exactly:

- `skills/plot/scripts/plot-install-hooks.sh`
- `test/reconcile/install-hooks.test.mjs`
- a new changeset file under `.changeset/`

Nothing else. In particular, do not touch any `plot-*-gate.sh` file (off
-limits per the plan, owned by the sibling plan `the-gates-are-launchers`
in the same sprint), `scripts/check-decision-count.sh` or
`scripts/check-shell-lines.sh` (closed by the already-merged "Decision
table reading" and "Bundle declaration pairing" waves), or
`packages/board/src/server/entry/reap.ts` (closed by the already-merged
"Reaper readings" wave).

If you find something the plan did not anticipate, report it rather than
improvising outside scope.
