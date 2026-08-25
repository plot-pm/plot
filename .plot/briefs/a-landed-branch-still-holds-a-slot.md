## Implementation brief — a-hung-child-does-not-hold-the-loop (wave Counted)

- **Plan (canonical):** `docs/plans/2026-08-25-a-hung-child-does-not-hold-the-loop.md` on main
- **Approved:** 2026-08-25, Jan Wloka, in-session
- **Branch:** `bug/a-landed-branch-still-holds-a-slot` (base: `main`)
- **Ends as:** one PR to main
- **Review of the code:** repo convention (CI green + review)

The plan's last wave. `Bounded` merged as #426, `Reaped` as #429.

**This brief arrived late** — auto-dispatch claimed the branch before it was
written. If you have already started, read it now and reconcile: the decisions
below are settled and re-deriving them wastes the work.

### What to build

`liveAgentCount` counts **every** live agent, whether or not its branch has
landed, so auto-dispatch cannot start work beside workers that have not exited.

Today it excludes them:

```ts
agents.filter((a) => LIVE_STATES.has(a.state) && !(a.branch && landed.has(a.branch)))
```

### Why this is the third part of one failure

Measured 2026-08-25: **13 live workers, 11 with an already-merged PR**, all hung
on the same unhandled rejection from the agent CLI, one for ten hours. Against a
cap of **3**.

Auto-dispatch started two more beside them — because every hung worker's branch
had landed, so none counted. `Bounded` (#426) stops them hanging; `Reaped`
(#429) stops their rows outliving them; this stops the cap being spent on them.

**Two sound rules composed into an unbounded fleet.** *Lowering the cap never
kills* is correct — a half-done branch killed mid-run strands work nobody can
see. *Landed branches do not count* is the one that breaks: it confuses *has
nothing left to do* with *occupies no machine*.

### The decisions the plan settles — do not re-derive them

**`liveAgentBranches` must stay consistent with the count.** It exists so a
refusal at the cap can name which agents hold the slots. A count that disagrees
with its own explanation is the defect `a-count-answers-to-its-section` fixed
elsewhere on this board — do not fix one and leave the other.

**`LIVE_STATES` is untouched.** This changes which live agents count, not what
*live* means.

**Not chosen: kill a worker whose branch has landed.** The loop's whole purpose
is hopping to the next wave of the same plan, and a worker between waves has a
merged branch **by definition**. Killing on that signal would end healthy
workers mid-hop.

### Done when

The plan's `## Done when` items 9, 10, 11 and 12 are this wave's specification
(1–6 belong to `Bounded`, 7–8 to `Reaped`).

- **Item 9** — `liveAgentCount` counts a live agent whose branch has landed.
  This is the line that let the fleet reach 13 against a cap of 3.
- **Item 10** — `liveAgentBranches` names **exactly** the agents `liveAgentCount`
  counted. The two must not diverge.
- **Item 11** — auto-dispatch refuses while live agents ≥ cap, whatever their
  branches' merge state.

Plus the repo's gates: `pnpm test`, `pnpm run test:reconcile`,
`pnpm run test:board`, `pnpm run typecheck`. Node 24 (`nvm use`). Add a
changeset with `'@plot-pm/board': patch` frontmatter.

### Two traps this plan's own waves already hit

Both cost a CI round trip today:

- `PLOT_ACTIVITY_INTERVAL=0.3` was too tight for a shared runner (#424)
- `PATH='/usr/bin:/bin'` hides `timeout` on macOS and **nothing** on Linux (#426)

If a test needs to hide or time something, make it platform-independent and
generous. CI is slower and laid out differently than this machine.

Also: **`test/dispatch.test.mjs` and `auto-dispatch-spawn.test.ts` fail under
suite contention and pass alone.** If you see `expected: ['--max 1 …'],
actual: []`, run that file by itself before believing it.

### Bookkeeping

When the PR exists, annotate the wave heading on main — `## Waves` plan, so the
PR goes **inside** the heading:

```
### Counted (Branch: bug/a-landed-branch-still-holds-a-slot, PR: #N)
```

A trailing `→ #N` parses as `prs=[]`.

**Open the PR yourself, and run every test in the FOREGROUND.** A worker on this
plan's `Bounded` wave finished 451 lines, pushed them, then stopped without a PR
— its log ends *"I'm waiting on the background board suite"*, a notification a
`-p` run never receives.

### Scope guard

This branch owns `packages/board/src/server/auto-dispatch.ts` and its tests.

`bug/auto-dispatch-skips-an-occupied-branch` (#427) **just merged into that same
file** — rebase onto current main before you finish, and expect the artifact to
conflict.

The board artifact `skills/plot/scripts/board/board-server.mjs` is generated and
marked `-merge`. Never read its diff — take either side, run `pnpm build:board`,
stage the **rebuild** (not the merge's copy), then commit.

Do not commit `packages/board/test/fixtures/tiny-garden/.plot/state/last-pulse.json`
or `packages/board/.omc/state/last-tool-error.json` — both make
`plot-resolve-artifact.sh` refuse with `worktree-busy`.

If you find something the plan did not anticipate, report it rather than
improvising outside scope.
