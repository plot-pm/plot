## Implementation brief — the-board-asks-only-what-changed (wave 1: The store holds what the host said)

- **Plan (canonical):** [`docs/plans/2026-09-21-the-board-asks-only-what-changed.md`](../../docs/plans/2026-09-21-the-board-asks-only-what-changed.md) on `main`
- **Design (the full argument):** [`docs/stories/the-index-holds-what-the-host-said/DESIGN-index.md`](../../docs/stories/the-index-holds-what-the-host-said/DESIGN-index.md)
- **Approved:** 2026-09-21, jwloka, in-session
- **Branch:** `feature/the-store-holds-what-the-host-said` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention — CI gates plus a reviewer

`feature/the-call-asks-only-for-the-delta` waits on this branch, and its wave heading carries the `waits:` annotation that makes the fleet honour it. That slice adds `--since` to `plot-host.sh pr-list` and sends the watermark this slice writes. **Nothing waits on that one**, so a field this slice omits is a field the next slice cannot recover: a store already on disk holds the rows it was written with.

### What to build

`refreshPrs` in `packages/board/src/server/fleet.ts:2437` reads a durable store before its host call and writes it after. **The call's filter is unchanged** — still `pr-list --rich --state all --limit 1000` — so what this slice buys is measurable on its own: a board restart stops costing a full read, and the store exists for slice 2 to refresh incrementally.

The failure this fixes, with its numbers: one `gh pr list --state all` with the fields the board needs is **29 811 ms** of a **32 105 ms** scan — 96%. The board refreshes against that every 5 s, so under load it reported *"No contact with the board server for 12 polls"* while the server was alive and inside the call. This slice does not make the call cheaper; it makes the *answer* survive the process, which is the precondition for slice 2 making it cheap.

The plan is canonical and the design carries the per-connector lifecycle and the three questions left open. This is orientation.

### The decisions already settled — do not re-derive them

**The store's directory comes from `git rev-parse --git-common-dir`, never `--show-toplevel`.** Copy `packages/domain/src/adapters/slice-spend/slice-spend-file.ts:60-104`, which exists for exactly this and records the measurement:

```
--show-toplevel   → …/.worktrees/feature-one-monitor-watches-the-slice   ← the DESK
--git-common-dir  → …/plot/.git                                          ← shared
```

`plot-reap.sh` runs `git worktree remove --force` over the desks, so a store written to a desk is destroyed by the reaper on the machine that measured it, with every gate green — a test in the main checkout cannot see the difference. `--git-common-dir` answers *relatively* in the checkout it runs from, so resolve it against the cwd rather than trusting it as absolute.

**`.plot/state/` is already gitignored** (`.gitignore:30` and `:35`, the unanchored `**/` form for nested fixtures). Add no ignore rule; adding one under a different path is how a store ends up committed.

**`updatedAt` DOES NOT EXIST YET, and adding it is this slice's job.** Measured 2026-09-21 on this repository: `plot-host.sh` emits three `--json` field lists (`plot-host.sh:3454`, `:3483`, `:3514`) and **none carries `updatedAt`**; `PrRecord` (`fleet.ts:359`) has no such field. The design says the watermark is *"the newest `updatedAt` the host RETURNED, never the local clock"*, so without the field there is no watermark to write.

The plan's sentence *"the call itself is unchanged"* means the **filter** is unchanged — no `--search`, no `--since`, same 933 rows. Adding one field to the `--json` list keeps that true and is required for the store to be advanceable later.

**Its cost was measured rather than assumed: `gh pr list --state all --limit 1000 --json number,updatedAt` over 937 PRs is 4 715 ms** — the cheap tier, beside `number,title,state,headRefName,isDraft,url` at 5 417 ms and nowhere near `statusCheckRollup` at 18 842 ms. The design's own table is why the measurement was taken: cost is per FIELD, not per call, so a new field is never free by assumption.

**Keyed by PR number, never by branch.** A branch carries several PRs over its life. `plot-pr-merged.sh` records what keying by the newest costs — `--limit 1` reported three branches unlanded whose work was on main, each masked by a duplicate the fleet opened itself. `byHead` is re-derived in memory and already ranks an open PR over a closed one (`fleet.ts:2556`); the store must not flatten that.

**A cold store behaves exactly as today.** No file, an unrecognised `v`, unparseable JSON, or a failed write each fall back to the current behaviour: one full read, no error surfaced to the operator. The store is an optimisation and **its absence may cost time and nothing else** — deleting it must never change an answer.

**A field the host did not answer is absent, not false.** `an-unasked-host-is-not-an-absent-pr` is the plan that exists for this shape, and it is in flight on `bug/the-rule-knows-it-was-not-asked` — a board called seven branches abandoned and three of them carried PRs. Writing `checks: false` for an unasked field manufactures the verdict that plan removes. The existing normalizers say the same in three different absent-value shapes (`url` → `""`, `mergeable` → `"unknown"`, `failing_checks` → `[]`); the store must round-trip each of those unchanged rather than inventing a fourth.

**The `allUnknown` outage path stays, and the store makes it more important.** `fleet.ts:2568` keeps the last good map and raises the banner when every PR reads `unknown`. It must not write the store: a dark host overwriting good data on disk is worse than overwriting it in memory, because the next process inherits it. Same for the `catch` at `fleet.ts:2602` — it keeps the last good map, and it must keep the last good store.

**A partial answer is not a refusal, and it is not whole either.** `fleet.ts:2519` accepts `said.answer === 'partial'` — Bitbucket has no `all` state, so its arm asks once per state and may reach some and not others. Those rows are real and dropping them is #912 (nine branches reading *"commits, no PR ever opened"* while two had live ones). A partial answer may be merged into the store; it may **not** be written as a complete replacement, or a state that failed to answer would delete every PR in it.

**Completeness is recorded, not inferred.** `plot-fleet-scan.sh:1031` falls through to one host call per branch when the bundled list cannot be proven whole — measured 2026-08-23, **28 of 29** such calls were for branches with no ref and no PR, re-learning `NONE` forever, one board spending ~3 600 calls/hour. A partial store must never license the answer *"asked, and there is no PR"*; that is a fact with a timestamp, not an absence.

**The layering rule applies: the domain takes readings as values.** `refreshPrs` is board code and may not reach the filesystem directly — the store is a port with a file adapter, and the shape to copy is `slots`/`slice-spend`, which are the two machine-local precedents. `reap(readings, input)` rather than `reap(ports)`: keep the rule synchronous and testable without mocks.

**Arrow functions.** `packages/domain/**` is arrows by rule, and any function you write or rewrite anywhere is an arrow — the rule follows the diff, not the file. Passing through a `function` declaration you did not write leaves it alone.

**TSDoc says what an export does, not why the decision was made.** Measured on the first rule moved into the domain package: 28 lines of code carrying 109 lines of comment. The reasoning goes in the commit message and the plan, both dated and searchable.

### Done when

The plan's `## Done when` list is the specification. This plan states its constraints under **What must not break** rather than as a checklist, so treat those four as the done-when and lift these assertions, each of which catches something a naive implementation passes without:

- **A cold store produces byte-identical board output to no store at all.** Catches an implementation that writes defaults into absent fields — the store looks populated and the board has invented data.
- **An unrecognised `v` falls back to a full read and does not throw.** Catches version handling that only tolerates the version it was written against; the next schema change then takes the board down rather than costing it one read.
- **A failed write leaves the board working.** Catches a store treated as required — a read-only filesystem or a full disk must cost time, not answers.
- **The `allUnknown` path and the `catch` path each leave the store untouched.** Catches the outage case writing a dark map to disk, which the next process would inherit as good data. Assert the file's mtime or content is unchanged, not merely that the in-memory map survived.
- **A partial Bitbucket answer merges rather than replaces.** Catches a whole-store write that deletes every PR belonging to a state that did not answer.
- **A branch with two PRs round-trips both.** Catches branch-keying, which loses the older one and is the `--limit 1` defect by another route.
- **The watermark is the newest `updatedAt` in the returned rows, not `Date.now()`.** Catches the skew bug the design names: a PR updated at 18:42:10 host-time read by a client whose clock says 18:42:12 is excluded by every later `updated:>18:42:12` — forever, silently. A test with a fixture clock deliberately ahead of the fixture data is what proves it.

Plus the repo's gates:

```bash
nvm use                      # Node 24 — pnpm crashes on 26
pnpm test                    # skills parse
pnpm run test:board          # rebuilds the artifact + runs its tests
pnpm run typecheck
pnpm run test:contracts      # helper estate + CI gates
```

**Do not run `pnpm run test:e2e`.** It is CI's gate, not a local one — it dispatches real workers into sandbox repositories, and two agents running it once produced 53 concurrent `node --test` processes and a board that could not answer in 25 seconds.

A changeset is required: `'@plot-pm/board': patch` in the frontmatter, description first, `bumps:` block last if any skill changes. A `packages/board` change uses the package frontmatter and no skills bump. `.changeset/` in a fresh worktree often holds siblings' files — add yours, touch none of theirs.

### Bookkeeping

Open the PR through the controller, never `gh pr create`:

```bash
skills/plot/scripts/plot-open-pr.sh          # or --draft while work moves
```

It takes the title from the plan's wave heading. Measured 2026-09-08: three slice PRs opened with `gh pr create` each took their title from the last commit subject, which on this estate is routinely `plot: build the board artifact`.

When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section on `main`. Push the first real commit as soon as it exists — fifteen branches once carried finished work nobody could see because no PR was raised.

### Scope guard

**This branch owns:** `packages/board/src/server/fleet.ts` (`refreshPrs` and the `CacheEntry` fields it writes), the new store port and its file adapter under `packages/domain/src/ports/` and `packages/domain/src/adapters/`, the `--json` field lists in `skills/plot/scripts/plot-host.sh`, and their tests.

**Other branches in flight, verified 2026-09-21 rather than guessed:**

- `bug/the-rule-knows-it-was-not-asked` — `packages/domain/src/rules/quiet.ts`, its tests, and the built artifacts. **Touches no `fleet.ts` source and no `plot-host.sh`.** It is the `absent is not false` rule this brief cites; if it merges first, read it rather than re-deriving the reading.
- `bug/the-index-is-read-once` — `plot-reconcile-scan.sh` only. No overlap. Note the name collides with this work's vocabulary and the subject does not: that *index* is the plan index.

**The one shared file is `skills/plot/scripts/board/board-server.mjs`**, the generated artifact. It is marked `-merge` in `.gitattributes`, so on a conflict **do not read the diff**: take either side, run `pnpm build:board`, commit the result. The rebuild overwrites whichever side was kept. Never phrase it as "take ours" — *ours* inverts between `git merge` and `git rebase`.

If you find something the plan did not anticipate, report it rather than improvising outside scope. The three questions the design deliberately leaves open — including whether `plot-fleet-scan.sh` should read the same store — are **not** this slice's to answer.
