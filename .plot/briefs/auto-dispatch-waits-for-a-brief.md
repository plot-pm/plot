## Implementation brief — a-worker-starts-with-its-brief (wave Checked)

- **Plan (canonical):** `docs/plans/2026-08-24-a-worker-starts-with-its-brief.md` on main
- **Approved:** 2026-08-26, Jan Wloka, in-session
- **Branch:** `bug/auto-dispatch-waits-for-a-brief` (base: `main`)
- **Ends as:** one PR to main
- **Review of the code:** repo convention (CI green + review)

Wave 1 of 2. `Offered` (the board's **Write brief** action) waits on nothing
here and can be built independently — but it is the remedy for the refusal this
wave introduces, so land this one first.

### This wave has TWO halves, and the first is a measurement

**Do not start writing the check.** The plan deliberately leaves one decision
open, and it is the decision that determines whether the feature works at all.

### Half one — the spike

A brief's existence is a file question. There are two places to ask it, and both
are wrong in different ways:

| source | wrong how |
|---|---|
| `existsSync('.plot/briefs/<x>.md')` in the board's cwd | the checkout can lag main |
| `git cat-file -e origin/main:.plot/briefs/<x>.md` | a process spawn inside the 5 s pulse |

**The measured failure, 2026-08-26:** the board was running from
`/Users/jwloka/Quatico/Agentic-Tools/plot-board`, **24 commits behind main**,
holding **152** briefs where main held **155**. Three briefs that exist would
have read as missing. That inverts the plan: a feature built to stop wrong
starts would instead stop right ones, silently, on a machine whose board nobody
had restarted.

So measure two things and **write both numbers into the plan** before choosing:

1. **How far behind main does a board checkout actually run?** Sample the
   checkouts on this machine (`git worktree list`, then `git rev-list --count
   HEAD..origin/main` each). One case is already recorded; you need the shape,
   not one point.
2. **What does one `git cat-file -e` per candidate cost?** Time it against the
   real candidate count — `startableBranches` for the approved plans in a live
   pulse, not a guess. Compare to the pulse's 5 s cadence, remembering the scan
   already eats 18.3 s of it.

Then choose, and say in the plan which you chose and which number decided it.
A filesystem read is free and sometimes wrong; a git read is always right and
might be affordable. **Neither is guessable — that is why this half exists.**

### Half two — the check

Once the source is chosen: auto-dispatch does not start a wave whose brief is
absent, and names the wave and the expected path.

**The stop is hard.** Not a warning that starts anyway; not a one-time skip. It
is safe *because it is not sticky*: the check runs every pulse and re-reads the
file, so writing the brief releases the wave on the next pass — no flag, no
restart, nothing for an operator to remember.

### Where the check can live — read this before choosing a file

`planAutoDispatch` (`auto-dispatch.ts:174`) carries this docstring:

> **PURE — no spawn, no disk, no clock.** Every output is a function of the four
> inputs, which is what lets the cross-pulse cap be asserted over repeated calls
> in a unit test rather than through a live fleet.

**That purity is load-bearing and must survive.** It is what lets
`auto-dispatch.test.ts` assert the cap across pulses without a fleet. A brief
check placed inside `planAutoDispatch` breaks it — and breaks it *quietly*,
because the existing tests would still pass while every future test of the
planner gained a hidden filesystem dependency.

Two shapes preserve it, and either is acceptable:

- **Inject the answer.** Extend `PlanAutoDispatchInput` with a predicate or a
  set of branches-with-briefs, computed by the caller. The planner stays pure and
  the test supplies a fake.
- **Filter in `maybeAutoDispatch`** (`auto-dispatch.ts:340`), which is already
  the impure one — it reads controls, counts the registry, and spawns.

**Do not make `planAutoDispatch` touch disk.** If your design seems to require
it, that is the signal to use injection.

### The decisions the plan settles — do not re-derive them

**`plot-dispatch.sh` is unchanged.** Its `brief=missing` is a CONSTANT, and its
own comment argues why: bash cannot invoke a skill, `--dry-run` and `--status`
are legitimate direct calls, and *"a gate that blocks looking-before-leaping is
a gate in the wrong place."* Adding a file test there was considered and
rejected in the plan's Notes.

**The manual path is untouched.** `/plot-dispatch` warns and proceeds, brief or
no brief. The asymmetry is deliberate: auto-dispatch acts with nobody watching,
so its refusal is how a person learns something is missing; a manual dispatch
has a person there already.

**Auto-dispatch does not write the brief.** That needs interpretation — which
alternatives a plan rejected and what killed them — and it is a skill's work.
Wave `Offered` invokes `/plot-implement` from the board instead.

**Warn-and-start was rejected.** The cost being avoided is the worker's first
hour; a warning read afterwards recovers none of it. Measured: eight minutes on
one wave on 2026-08-24, unknown on the other.

### Done when

The plan's `## Done when` list is the specification. Four items exist because a
naive implementation passes without them:

- **Item 2** — it starts normally once the brief exists, asserted by creating
  the file and pulsing again. This is what makes a hard stop safe; an
  implementation caching the answer passes item 1 and fails here.
- **Item 3** — manual `/plot-dispatch` unaffected. A check placed too low
  (in the script, or in a shared helper both paths call) fails this.
- **Item 6** — the spike's numbers are in the plan, and the choice names them.
- **Item 7** — a brief that exists only on main is not reported missing. The
  2026-08-26 case asserted directly. **If the spike chooses the filesystem,
  this is the item that choice has to survive** — so decide it knowingly.

Plus the repo's gates: `pnpm test`, `pnpm run test:reconcile`,
`pnpm run test:board`, `pnpm run typecheck`. Node 24 (`nvm use`) — pnpm crashes
on 26. Add a changeset with `'@plot-pm/board': patch` frontmatter.

### Bookkeeping

When the PR exists, annotate the wave heading on main — `## Waves` plan, so the
PR goes **inside** the heading:

```
### Checked (Branch: bug/auto-dispatch-waits-for-a-brief, PR: #N)
```

A trailing `→ #N` parses as `prs=[]`. Check `git branch --show-current` is main
before that edit.

**Push your first real commit as soon as it exists, and open the PR yourself.**
Run every test in the FOREGROUND: a `-p` run receives no notification, and a
worker on a sibling plan finished 451 lines, pushed them, then stopped without a
PR — its log ends *"I'm waiting on the background board suite."*

### Scope guard

This branch owns `packages/board/src/server/auto-dispatch.ts` and its tests.

**Do not touch** `liveAgentCount` or `isStartable` — both were changed by merged
siblings this week (#427 skips occupied branches, #430 counts landed ones), and
re-opening either re-litigates a settled measurement.

**Do not build the Write brief action** — that is wave `Offered`.

The board artifact `skills/plot/scripts/board/board-server.mjs` is generated and
marked `-merge`. Never read its diff — take either side, run `pnpm build:board`,
stage the **rebuild** (not the merge's copy), then commit. Staging before
rebuilding produces a commit that looks repaired and fails CI's freshness gate.

Do not commit `packages/board/test/fixtures/tiny-garden/.plot/state/last-pulse.json`
— every board suite rewrites it, and a dirty copy makes
`plot-resolve-artifact.sh` refuse with `worktree-busy`.

If you find something the plan did not anticipate, report it rather than
improvising outside scope.
