## Implementation brief — a-slice-nobody-worked-on-reads-not-started (wave 1: No work waits in not started)

- **Plan (canonical):** `docs/plans/2026-09-30-a-slice-nobody-worked-on-reads-not-started.md` on `main`
- **Approved:** 2026-09-30, jwloka, in-session
- **Branch:** `bug/a-slice-with-no-work-waits-in-not-started` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** per repo convention — the PR is reviewed as code; CI is the authority for e2e

Wave 2 (`bug/zero-ahead-is-not-merged`) waits on this branch. That wave turns a zero-ahead ref from `merged` into `open` or `unknown`; without this wave such a row falls to the `wip` tail and reads *commits, no PR ever opened*. So this wave must land first, and it must not touch `branch-state.ts`, `plot-fleet-scan.sh` or the `plot-branch-state.mjs` bundle.

### What to build

Two changes in `packages/board/src/server/fleet.ts`, both in the board's row placement, none in the domain rule.

1. **`classifyGroup` (`fleet.ts:4073`) becomes total over `BranchState`.** Today it has arms for `deferred`, `open`, `claimed` and `merged`; every other state falls to the tail commented `// state === 'wip'` (`fleet.ts:5073`), which builds `wipReadings` and asks `quietNote`. `blocked`, `waiting` and `unknown` reach that tail and read `abandoned` / *commits, no PR ever opened*. Measured 2026-09-30: `bug/every-state-file-declares-its-bound` had no ref anywhere, state `blocked`, and sat in WAITING ON YOU as *commits, no PR ever opened, age unknown*. Add three arms, each returning `group: 'not-started'` with its own sentence:

   | State | Sentence |
   |---|---|
   | `blocked` | *waits for `<prerequisite>`, which has no pull request* |
   | `waiting` | *waits for `<prerequisite>`* |
   | `unknown` | *state unknown — the host's answer is incomplete* |

   Guard the tail on `state === 'wip'` explicitly. Any state the classifier does not recognise returns `not-started` with *state `<word>` not recognised* — never the `wip` tail.

2. **`rowsFromPulse`'s closed-PR arm yields to a live agent.** `const group = closedPr ? 'done' : openGroup;` (`fleet.ts:6547`) reads no worker. Measured 2026-09-30: `bug/a-state-sweep-is-one-request` (#1049) had an agent resumed 40 min earlier holding two file-touching commits; it had opened #1089 from its claim commit and closed it 38 s later, and the row sat in DONE with a green live marker. While `worker` is `running` or `waiting`, the row stays in `openGroup`, keeps *PR closed without merging* as a second fact in the note, and `rowQuietKind` (`fleet.ts:5257`) receives `closed = null` for that row so the WORKING row carries no `closed-pr` kind. With no live worker the row stays in DONE as today.

The plan is canonical; this is orientation.

### Decisions the plan settles — do not re-derive them

**The three new arms sit AFTER the worker block, not before it.** `blocked`, `waiting` and `unknown` already pass through the worker block, so a running agent on such a branch reads WORKING today. The new arms replace only the `wip` tail these rows reach when no worker holds them. Putting them first would make a live agent on a `waiting` branch read NOT STARTED — a live agent outranks every branch state.

**`waits_on` is a NEW trailing parameter of `classifyGroup`, passed from `rowsFromPulse`.** The field already exists on the pulse (`packages/domain/src/entities/fleet.ts:200`, `waits_on: z.string().default('')`). `blocked` and `waiting` arise only from a `waits:` annotation, so the prerequisite name is always there for those two states. Trailing, because `classifyGroup`'s parameter list is ordered by age and the docstrings at `:4161`, `:4198` and `:4233` record *"LAST, BECAUSE IT IS THE NEWEST"*; follow that convention and document the parameter the way its neighbours are documented.

**`BLOCKED_NOTE` is NOT reused.** It is the slice-verdict sentence (*blocked by an earlier slice*), which answers a different question — the wave's eligibility, not this branch's state. Reusing it would conflate the two readers.

**A closed PR is terminal for the PR, not for the branch.** That is the whole argument for change 2; the existing comment block above `:6547` (*"DONE, NOT QUIET … a closed PR is a decision somebody took"*) stays true for a branch with no live agent and needs one sentence saying where it stops.

**No payload field is added or removed.** Rows move between sections only. So no `BoardSchema` / `FleetSchema` change, no client cast change.

Rules carried over from this repo, unchanged:

- Absent is not false: `worker` defaults to `elsewhere`, which means *could not look*, not *nobody is working*. Only `running` and `waiting` count as live for change 2.
- Every rendered state is a domain property: assert placement through `classifyGroup` / `rowsFromPulse` in unit tests, not through a browser.
- New functions you write are arrows; functions you pass through stay as they are (`classifyGroup` is a declaration — leave it one).

### Done when

The plan's `## Done when` slice-1 items are the specification:

- A `blocked`, `waiting` or `unknown` row with no ref and worker `none` or `elsewhere` classifies to `not-started` with its own sentence, naming `waits_on` where it applies, and never *commits, no PR ever opened*.
- The same row with a running worker classifies to `working`. **This is the assertion that catches the arms placed before the worker block.**
- `packages/board/test/unit/classifier-is-total.test.ts` covers all eight states — add `blocked`, `waiting`, `unknown` to `STATES` (`:77`). It covers five today.
- A `wip` row with real commits, no PR and no worker still reads `abandoned`. **This catches a tail guard that swallows `wip` itself.**
- A row with a closed PR and `worker` `running` or `waiting` classifies to its open group with no `closed-pr` quiet kind; with no live worker it stays in DONE. **Test both halves** — the second is what catches a change that drops closed PRs out of DONE altogether.
- An unrecognised state word returns `not-started` naming the word.

Plus the repo gates:

```bash
nvm use                      # Node 24 — pnpm crashes on 26
pnpm install
pnpm test
pnpm run typecheck
pnpm run test:board          # rebuilds skills/plot/scripts/board/board-server.mjs; commit the rebuilt artifact
pnpm run test:contracts
```

Do not run `pnpm run test:e2e` locally; CI runs it. Add a changeset with `'@plot-pm/board': patch` and the description first (see `CLAUDE.md` › Versioning). The board test suites fail spuriously under load; re-run a failing file alone and compare against `main` before believing it.

### Bookkeeping

- Push the first real commit as soon as it exists — the ref is already claimed at `origin/main`'s tip, and an empty claim is exactly the row this plan is about.
- Open the PR with `skills/plot/scripts/plot-open-pr.sh` (`--draft` while it moves). Never `gh pr create`.
- When the PR exists, append `→ #<number>` to this slice's heading in the plan's `## Slices` section on `main` — the waves form is `(Branch: bug/a-slice-with-no-work-waits-in-not-started, PR: #N)` inside the heading.

### Scope guard

This branch owns:

- `packages/board/src/server/fleet.ts` (`classifyGroup`, `rowsFromPulse`'s closed-PR arm, `rowQuietKind`'s input for that row)
- `packages/board/test/unit/classifier-is-total.test.ts` and new unit tests beside it
- `skills/plot/scripts/board/board-server.mjs` (rebuilt artifact) and one `.changeset/*.md`

Not this branch: `packages/domain/src/rules/branch-state.ts`, `packages/domain/src/entry/branch-state.ts`, `skills/plot/scripts/plot-fleet-scan.sh`, `branch-state.test.ts`, `a-failed-scan-keeps-the-last-sections.test.ts`, the corpus — all wave 2.

Other branches in flight, verified 2026-09-30 at dispatch:

- `bug/scripts-share-one-temp-helper` (10 ahead) touches `plot-fleet-scan.sh` — wave 2's concern, not this one.
- `bug/a-plan-row-says-its-verdict-once` (claim only, 0 ahead) plans edits in `packages/board/src/app/lib/agent-rows/` and `AgentList.tsx` — client side, no overlap with `fleet.ts`.
- `bug/a-fleet-agent-starts-without-the-operators-plugins`, `bug/every-state-file-declares-its-bound`, `feature/a-plan-row-names-its-ticket`, `bug/the-suites-own-their-temp-root` — none touch `fleet.ts` or the classifier tests.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
