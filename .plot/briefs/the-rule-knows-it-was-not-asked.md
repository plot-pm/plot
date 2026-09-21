## Implementation brief — an-unasked-host-is-not-an-absent-pr (slice: the rule knows it was not asked)

- **Plan (canonical):** `docs/plans/2026-09-21-an-unasked-host-is-not-an-absent-pr.md` on `main`
- **Approved:** 2026-09-21, jwloka, in-session
- **Branch:** `bug/the-rule-knows-it-was-not-asked` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR review per repo convention

The plan has one live slice. The second `## Slices` entry — *`prUnknown` is the same concept and its producer is broken* — is prose about scope, not a branch: it says fixing `prUnknown`'s producer belongs in THIS slice. Nothing waits on you and you wait on nothing.

### What to build

`quietKind` answers `abandoned` when `prState === 'none'`, and the board's constructors produce `'none'` from `pr ? 'open' : 'none'` — an absence they never checked. So a failed PR fetch and a genuinely PR-less branch are the same input, and the rule turns not-knowing into the most consequential word on the row: the one that tells a person the branch can be deleted.

Measured 2026-09-20 on `quatico/quaweb-website`: `prAgeSeconds: null`, seven branches rendered *"commits, no PR ever opened — abandoned"*, **three carrying pull requests** — #358 OPEN, #405 and #445 DRAFT. The raw host call answers correctly in 0.4 s; the board never sees it before its own timeout.

Give `QuietBranchReadings.prState` a fourth word, `'unknown'`, thread the fact that produces it from the one place that knows it, and let `quietKind` return `'quiet'` for it. The plan is canonical; this is orientation.

### The decisions the plan settles — do not re-derive them

**The reading gains a word; the verdict does not.** A panel divided two-to-one on this and the plan resolves it from the code. `QuietKind` keeps its four words, `quietNote`'s `Record<QuietKind, string>` is untouched, and `AgentRowSchema` is unchanged — **nothing crosses the wire that did not before**, so no old client meets a value it cannot parse. Do not add a fifth kind.

**And `null` is not the escape either.** `quietKind`'s `null` already means *the question is not asked of this row* — a live agent, a merged branch, a PR under review. Reusing it for *asked and unanswered* collapses two different silences, and the row would then render exactly as it did before the fetch failed. That is the current defect with extra steps.

**`'unknown'` is the estate's existing word.** `HostReach`, `PrSchema.state` and `BriefStateSchema` already use it. Do not coin `'unfetched'`, `'unasked'` or a nullable `prState`.

**The estate already made this decision three lines above the defect.** `fleet.ts:3088`, on `backend`: *"Null, never 'github': 'not yet asked' and 'asked, and it is GitHub' are different answers."* Same argument, same initialiser, one field over. The rule existed and was not applied to `prState`.

**The per-reading convention is already there too.** `QuietBranchReadings.hasMergedPr` documents *"An unreachable host answers `false`, so silence is never a merge."* Silence is answered on the reading, not by the caller guessing.

**This exact defect has been fixed once, one field over — read that fix before writing yours.** `hasMergedPr` was added to `classifyGroup` (`fleet.ts:4735`) because `wipReadings` hardcoded `hasMergedPr: false`, so `quietKind`'s first guard could never fire and every merged branch fell through to `abandoned`. Measured 2026-09-04: WAITING ON YOU held 35 rows, of which **3** were work anyone was waiting on. A hardcoded constant standing in for an unread fact is the mechanism; you are removing the second instance of it.

**Ordering is decided: below `hasMergedPr`, above `prState === 'none'`.** The two readings are not independent — a host that did not answer has no `prState` worth consulting — but a branch git reports as merged reads `merged` regardless of whether the host could be asked. Tests must pin both ends.

**`abandoned` must still fire.** A host that WAS asked and reported no pull request is genuinely abandoned work. Narrowing this into never saying so trades one wrong answer for another.

**One derivation.** `quietKind` is forwarded, never re-derived on the client — the rule `worker` and `findings` already follow.

#### The fact, and where it comes from

**`entry.prs === null` is the reading, and it is per ENTRY, not per branch.** `fleet.ts:6987` passes `entry.prs` into `rowsFromPulse` as `prsByHeadMap`; a null map is the outage. Thread ONE boolean from there through `classifyGroup` / `rowQuietKind`, and supply both `prState: 'unknown'` and `prUnknown` from it. Do not invent a second independent spelling.

**`prUnknown`'s existing producer is broken, and fixing it is in scope.** `fleet.ts:5878` reads `held?.state === 'unknown'` over `prsByHeadMap?.get(b.branch) ?? null` — which is a strictly narrower question (*the host answered but could not report this PR's state*), and evaluates `false` for the whole outage because a null map yields a null `held`. The loose-branch path at `fleet.ts:6604` hardcodes `false` in its spelled-out default list. Its docstring is this plan's own thesis: *"an origin that could not be asked propagates as a gap, never as a value a verdict can be computed from."*

#### The rules carried over unchanged

**A new `classifyGroup` parameter goes LAST.** `fleet.ts:3829` and `:3859` state it twice: *"inserting a parameter mid-list shifts every spread-tuple caller in the suite silently past the compiler, and this file has paid that once already."* `hasMergedPr` is last today; yours goes after it. `fleet.ts:4887`'s `args[16]` tuple reader is the caller that proves why.

**Both `rowQuietKind` call sites, and the loose-branch path.** `fleet.ts:5950` (the plan-branch path) and `fleet.ts:6622` (the loose-branch path, which also passes the spelled-out positional default list at `:6604`). A fix that reaches one and not the other leaves half the rows lying — that asymmetry is what `:6585`'s comment records as already measured.

**Absent is not false.** The invariant this whole slice is an instance of.

### Done when

The plan's `## Done when` is the specification. It has no such section — so the slice line in `## Slices` is, and it is specific:

- `QuietBranchReadings.prState` gains `'unknown'`
- `quietKind` tests it **below `hasMergedPr`** and **above `prState === 'none'`**, returning `'quiet'`
- `wipReadings` / `claimedReadings` take the fact instead of deriving `'none'` from a null `pr`
- one boolean threaded from `rowsFromPulse` through `classifyGroup` / `rowQuietKind`, **appended last**, reaching both `rowQuietKind` call sites and the loose-branch path
- `prUnknown` supplied from the same fact
- `everyCase()` in `packages/domain/test/quiet.test.ts` gains a dimension

The assertions that exist because a naive implementation passes without them:

- **`abandoned` still fires on a successful fetch reporting no PR.** Catches the fix that narrows `abandoned` out of existence — right about the outage, wrong about every genuinely abandoned branch.
- **A merged branch never reads as unasked.** Catches the arm inserted above `hasMergedPr` instead of below it.
- **`everyCase()` gains a DIMENSION, not a case.** Its docstring: *"12 records, all of them reachable, enumerated rather than sampled so a fourth arm cannot be added without a case covering it."* A hand-written 13th case passes the suite while defeating the helper — the product must widen to 16, and `quietNote`'s two `everyCase()` agreement tests (`quiet.test.ts:111`, `:124`) then cover the new value for free.
- **The threaded boolean reaches the loose-branch path.** Catches the fix applied at `:5950` only. Assert on a row built at `:6622`.

Plus the repo's gates:

- `nvm use` first — Node 24 per `.nvmrc`; **pnpm crashes on Node 26** and a background job under it exits silently having produced nothing
- `pnpm test`, `pnpm run test:contracts`, `pnpm run test:board`, `pnpm run typecheck`
- `pnpm build:board` — `packages/board/src/server/fleet.ts` is in the board artifact, so the built `board-server.mjs` must be rebuilt and committed
- a changeset. This touches both packages: `'@plot-pm/board'` and the domain. Copy the format from git history — `.changeset/` is often empty in a fresh worktree. Description FIRST, `bumps:` block LAST
- **do NOT run `pnpm run test:e2e`** — it is CI's gate, not a local one

Arrow functions: `packages/domain/src/**` is strict. In `fleet.ts`, the unit is the function — if you write the body it is an arrow, if you pass through leave it.

### Bookkeeping

Open the PR through the controller:

```bash
skills/plot/scripts/plot-open-pr.sh          # or --draft while the work moves
```

**Do not run `gh pr create`** — measured 2026-09-08, three slice PRs opened that way each took their title from the last commit subject, which on this estate is routinely `plot: build the board artifact`.

When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists.

### Scope guard

**Yours:** `packages/domain/src/rules/quiet.ts`, `packages/domain/test/quiet.test.ts`, `packages/board/src/server/fleet.ts` (the four regions above), the board artifact, one changeset.

**Not yours:** `QuietKind`, `quietNote`'s record, `AgentRowSchema`, any client-side derivation, and the host's slowness — that is `docs/plans/2026-09-21-the-ledger-prunes-what-it-read.md`, an independent plan. This fix would be worth making if every call were instant, because a fetch can fail for reasons no cache removes.

Verified at dispatch, 2026-09-21: this plan names exactly one branch, and no other branch is in flight on `fleet.ts` or `quiet.ts`.

Full measurement: `docs/notes/2026-09-20-the-board-never-fetches-pr-data.md`.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
