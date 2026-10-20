## Implementation brief — chain-under-one-heading-reads-as (wave 2: Eligibility)

- **Plan (canonical):** docs/plans/2026-10-19-chain-under-one-heading-reads-as.md on main
- **Approved:** 2026-10-19, Jan Wloka, plan-PR #2095 merged
- **Branch:** `bug/an-unmerged-waits-target-blocks-eligibility` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** pr

Wave 1 (`bug/a-waits-chain-is-a-cut-slice-sequence`, PR #2108, merged) covered
the *other* defect — `unsliced-wave` chain detection. It did not touch
eligibility: its diff holds `slice-chain.ts`, `plot-reconcile-scan.sh`
section 7 and their tests, nothing under `branch-state.ts` or
`plot-fleet-scan.sh`'s `waits_on`/`prereq_missing` path. This wave starts
clean — nothing here depends on wave 1's code, only on its merge having
happened.

### What to build

The plan's Motivation is the bug: on 2026-10-19 a board row for
`manifest-retry-and-race-findings` showed `bug/an-unstarted-continue-resumes-no-stranger`
as `eligible` / `approved — nobody has taken it`, while its
`<!-- waits: bug/a-continuation-obeys-the-limits -->` target (#2078) was
an open draft PR. The equivalent shape on `one-chip-row-and-a-sprint`
correctly read `blocked`. Same prerequisite kind, different verdict,
and the difference the plan names is heading structure: the first pair
sits under one `###` heading, the second spans two.

**Before changing anything, reproduce it.** This is the plan's own first
Open Question, and it is binding, not optional: "Why does the waiting
branch read `eligible` when its target is an open draft? Reproduce
against `manifest-retry-and-race-findings` before cutting the fix." That
plan is now Delivered (`docs/plans/delivered/manifest-retry-and-race-findings.md`),
and its `### Continuation limits` / `### Unstarted resume` headings are
still on record as the exact fixture — `bug/an-unstarted-continue-resumes-no-stranger`
waits on `bug/a-continuation-obeys-the-limits`, which sits under the
*other* heading. Run `plot-fleet-scan.sh` (or `--next`) against a sandbox
carrying that plan shape with the target left as an open PR, and confirm
what state comes out before touching `branch-state.ts`.

### Decisions the plan settles — do not re-derive them

**The domain rule already looks correct for this exact shape, on inspection.**
`packages/domain/src/rules/branch-state.ts`'s `waitVerdict()` returns
`'waiting'` for any prerequisite whose `pr` is not `'MERGED'` (OPEN,
CLOSED, or unreadable), and `'blocked'` only when a prerequisite has no PR
*and* is not a slice some live plan still names. `packages/domain/test/branch-state.test.ts`
already has unit cases asserting `pr: 'OPEN'` → `'waiting'`, including
with `namedSlice: false`. **Do not "fix" this function on the strength of
the plan's description alone** — if the reproduction in the previous
section shows the rule itself returning the wrong verdict, that is new
information worth reporting precisely (which input shape it mishandles);
if the rule already returns `'waiting'` correctly, the defect is upstream
or downstream of it, in the shell plumbing that feeds it or the row that
renders it, and chasing it inside `branch-state.ts` will waste the time
this section exists to save.

**The corpus test's one scenario-shape gap is a concrete, scoped task.**
`packages/domain/corpus/branch-state-waits.corpus.test.ts` pairs the rule
against a sandboxed `plot-fleet-scan.sh` run through a fake `gh` shim —
but that shim unconditionally answers "no pull requests found" for every
branch (`GH` constant, lines 62–66). Every existing case in that file is
therefore a `pr: 'none'` scenario; none exercises a `waits:` target that
*has* an open or draft PR, which is precisely the Motivation's case. Per
`docs/shell-and-domain.md`, the scan's `waits_on`/`prereq_missing` path
and the domain's `waitVerdict` are a declared duplicate and need a corpus
test proving they agree — extend the shim (or add a second one) to answer
a PR for one named branch, and add a case through a cross-heading chain
(mirroring `manifest-retry-and-race-findings`'s two headings) alongside
a same-heading one, so the heading-count variable the Motivation flags is
actually varied in the fixture, not assumed.

**Named-slice carries through both sides identically, and that is not new
here.** `namedSlices()` governs `blocked` vs `waiting` for a no-PR target;
it is unrelated to the open-PR path this wave adds coverage for, but the
existing corpus cases already prove scan and rule agree on it — don't
re-litigate it, only don't break it.

**Open Question 2 and 3 (chain length, cross-heading `waits:`) belong to
wave 1's chain-detection rule, not this wave.** This wave's own open
question is only the first one, reproduction. If reproduction surfaces
that the eligibility bug *also* depends on heading structure (not just PR
state), say so precisely and check whether `slice-chain.ts` needs a
second look — don't silently expand this wave's scope to cover it.

### Done when

The plan's `## Done when` is the second slice's line: "a branch whose
`waits:` target has not merged reads blocked with the target named, in
the row and in dispatch; corpus test pairs the scan with the domain."
Lift these assertions, each catching a specific naive-implementation gap:

- **An OPEN (not just missing) `waits:` target's PR reads `waiting`, not
  `eligible`.** Catches a rule that only checks for PR *absence* and
  treats any existing PR as settled.
- **The same OPEN-PR shape gives the same verdict under one heading and
  across two.** Catches a fix that only repairs the same-heading case the
  bug report led with, leaving the cross-heading shape — the real
  `manifest-retry-and-race-findings` shape — unfixed.
- **The board row names the blocking target**, not just a generic
  "blocked" or "waiting" label — `stuck.ts`'s existing `waits_on`
  threading should already do this; a regression here is a naive fix
  that recomputes the verdict but drops the target name.
- **Dispatch (`plot-fleet-scan.sh --next`) will not hand out a branch
  whose `waits:` target is open.** A fix that only touches the board's
  rendering and not `--next`'s own read leaves the real hazard (an agent
  claiming and starting work on a branch whose prerequisite isn't done)
  in place.
- **The corpus test fails if scan and rule disagree on the new
  open-PR case** — add it under `branch-state-waits.corpus.test.ts` or a
  sibling file, following the existing shim-based pattern.

Plus the repo gates: run `node skills/plot/scripts/board/plot-local-checks.mjs`
before each push and run what it prints; the suites in the `CI suites`
config key run in CI, and a failure there comes back as a correction.
List no full suite locally.

`scripts/check-shell-lines.sh` refuses a PR whose shell under `skills/`
grew past its merge base. If `plot-fleet-scan.sh` needs new lines to feed
PR state through the `waits_on` path, pay for it in the same change —
remove shell elsewhere, or push the logic through the domain bundle
instead.

### Bookkeeping

- Push the first real commit as soon as it exists.
- Open the PR with `../plot/scripts/plot-open-pr.sh` (`--draft` while it
  moves). Never `gh pr create`.
- When the PR exists, write its number into this slice's heading in the
  plan's `## Slices` section: `### Eligibility (Branch: bug/an-unmerged-waits-target-blocks-eligibility, PR: #N)`.

### Scope guard

This branch owns:

- `packages/domain/src/rules/branch-state.ts` and its unit test — only if
  reproduction proves the rule itself wrong; otherwise leave it unchanged
  and say so in the PR description
- the corpus test gap in `packages/domain/corpus/branch-state-waits.corpus.test.ts`
  (or a new sibling corpus file), including its `gh` shim
- `skills/plot/scripts/plot-fleet-scan.sh`'s `waits_on`/`prereq_missing`
  path — only as far as reproduction shows it to be the actual source
- `packages/board/src/app/lib/agent-rows/stuck.ts` and `packages/board/src/server/stuck.ts`
  only as far as the row's blocking-target label requires
- one `.changeset/*.md`, description first, `bumps:` last, with a `plot`
  entry beside `'@plot-pm/board'` if the scan or board changes

Not this branch: `unsliced-wave` chain detection (wave 1, already merged
via PR #2108), `/plot-reslice`, and Open Questions 2–3 (chain length,
cross-heading chaining for the `unsliced-wave` rule) unless reproduction
proves they are actually this wave's defect too.

Other branches in flight, verified 2026-10-20: check
`git ls-remote --heads origin` for anything naming `waits`, `chain`, or
`eligib` before the first push, and `git diff origin/main...origin/<branch> --stat`
against `branch-state.ts`, `plot-fleet-scan.sh`, and `stuck.ts` for any
match — whichever lands second rebases.

If you find something the plan did not anticipate, report it rather than
improvising outside scope.
