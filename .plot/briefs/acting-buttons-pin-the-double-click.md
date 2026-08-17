## Implementation brief — acting-buttons-show-they-act, wave 1 (Proof)

- **Plan (canonical):** `docs/plans/2026-08-17-acting-buttons-show-they-act.md` on `main`
- **Approved:** 2026-08-17, jwloka, plan-PR #171 merged (two interrogation rounds)
- **Branch:** `bug/acting-buttons-pin-the-double-click` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR review per repo convention; CI `validate` must pass

### What to build — and in which order

**Write the test first. The fix lands only if the test fails.**

That sentence is the whole brief. `StartWorkButton` claims a protection in a
comment — *"Disabled until the next pulse confirms, so a double click or a
second tab does not fire two runs"* — and implements it as:

```tsx
const blocked = starting || !dispatch.available;
onClick={() => { if (blocked) return; void start(); }}
```

`blocked` derives from `state`, and `setState` does not take effect until the
next render, so two clicks inside one tick may both read `idle` and both call
`fetch`. `ApproveButton` has the same shape.

**Measured: not one test for it, on either button.** No double-click,
rapid-click or two-request assertion anywhere in the board's suites. So the
comment asserts a protection nobody has checked — **and this plan does not get
to claim the defect is real either.**

### Why the order is not negotiable

If you write the fix first and then the test, a green test proves nothing: you
cannot tell whether it catches a real defect or whether React's batching already
covered it and the `useRef` is stock against a problem that never existed.

So:

1. **Write the test.** Two clicks inside one tick, per button, asserting exactly
   one POST reaches the route.
2. **Run it.** Red → the defect is real, continue. Green → **stop and report**:
   the guard already works, the plan was wrong, and no fix should land.
3. Only if red: add the latch.

Reporting a green test is a successful outcome for this branch, not a failure.

### The fix, if the test earns it

```tsx
const inFlight = useRef(false);
// onClick
if (inFlight.current || blocked) return;
inFlight.current = true;
void start();
```

**`blocked` stays.** It carries the *other* refusals — no dispatch binding, a
non-localhost host — and those still belong on the control. The ref answers one
question only: *is one of mine already running?*

**The ref is cleared where the STATE is cleared**, not in a `finally` beside the
`fetch`. The button stays in flight until the pulse confirms or gives up, and a
ref released when the request returns would re-arm the button while it still
reads `starting…`.

**Local, not server-side.** A second browser tab is a different question with a
different answer — git holds the claim for dispatch, the host refuses a second
merge — and an in-flight registry in the server would add state the board does
not otherwise keep. This fixes the reported case: one person, one tab, two
clicks.

### Done when

- **Two clicks inside one tick produce exactly one request.** Assert per button.
  Written before any fix.
- **A slow single click still works.** The pairing that matters: a latch that
  never releases passes the assertion above and breaks the button entirely.
- **The latch releases when the pending state does**, not when the request
  returns. Assert the button is still refusing while it still reads `starting…`.
- **`blocked` still refuses for its own reasons.** Assert an unavailable
  dispatch binding and a non-localhost host still refuse.

Plus: `pnpm run test:board`, `pnpm run typecheck`, `pnpm test`,
`pnpm run validate` all pass; `pnpm build:board` run **in your own worktree**
and the artifact committed (CI gates on no-diff); a changeset is present.

**Versioning:** declare the bump in your changeset's `bumps:` block. Do NOT edit
`metadata.version` or the plugin metadata by hand — `CLAUDE.md` was corrected on
2026-08-17 after describing manual bumps the repo has not done for six releases.

### Bookkeeping

When the PR is created, append `→ #<number>` to this branch's line in the plan's
`## Branches` section on `main`. **Push your first real commit as soon as it
exists.**

### Scope guard

`packages/board/src/app/components/StartWorkButton.tsx`,
`packages/board/src/app/components/ApproveButton.tsx`, and their tests.

**Do NOT change what the button watches for success** — that is wave 2
(`bug/start-work-watches-the-right-count`), which rebases onto you. It swaps
`card.started` for `waveSummary.claimed`, in the same two files.

**Do NOT add the spinner** — that is wave 3
(`feature/acting-buttons-spin-while-acting`), also in the same two files. All
three waves meet here, which is why they are sequential.

**One other branch is in flight:** `feature/agent-rows-line-up` (the grid), which
edits `AgentList.tsx` and `fleet.ts` — no overlap with you except the artifact.

`.gitattributes` marks `skills/plot/scripts/board/board-server.mjs` as `-merge`:
on a conflict there, take **either** side, run `pnpm build:board`, `git add` it,
continue. **Do not read that diff** — the rebuild overwrites whichever side you
took, so the choice genuinely cannot matter.

**Note on CI:** this repo saw two flaky failures on 2026-08-17 on branches
containing no code, both in suites that start real servers on real ports.
`PLOT_EXIT_WITH_PARENT` has since landed and should have reduced that. If CI
fails on a test you did not touch, check whether it passes locally before
assuming you caused it — and say so in your report.

If you find something the plan did not anticipate, report it rather than
improvising outside scope.
