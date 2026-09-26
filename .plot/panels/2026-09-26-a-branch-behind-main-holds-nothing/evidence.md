# Evidence lens — a-branch-behind-main-holds-nothing

Position: amend
Evidence: executed

## What I ran

- Scratch probe `packages/domain/test/zz-probe-branch-behind-main.test.ts`, driven with `npx tsx`, ten reading-shapes. Deleted after.
- The same probe after applying the plan's `:264` fix as a mutant.
- `npx vitest run test/branch-state.test.ts` — before and after the mutant.
- `npx vitest run` (full domain suite, 114 files) with the mutant.
- `npx vitest run --config vitest.corpus.config.ts corpus/branch-state.corpus.test.ts` with the mutant, 72 s against the live estate.
- `pnpm run build:board`, then drove the rebuilt `skills/plot/scripts/board/plot-branch-state.mjs` and the baseline one from `git show HEAD:` on real readings off `origin/feature/the-domain-knows-a-round`.
- `isClaimable` driven directly over four states.
- `git for-each-ref` sweep over all 7 remote branches for the shape.
- Tree restored with `git checkout --`; `git status --porcelain` clean on `packages/domain` and `skills/plot/scripts/board`.

## 1. Is the defect real? — YES, confirmed by execution

The plan's four-row table reproduces **exactly**, on the unmutated rule:

```
claimed (pushed claim commit)      -> claimed
behind main, NO commit             -> merged   <-- :264, the defect
ref points AT main                 -> open
no ref at all                      -> open
```

`branch-state.ts:264` is `return 'merged';`, confirmed by line number. A live instance exists right now: `origin/feature/the-domain-knows-a-round`, ahead=0, tip != main, **no PR row from `plot-host.sh pr-list`**, named by `docs/plans/2026-09-22-a-round-is-a-domain-fact.md`. Driving the *shipped* baseline bundle on its real readings answers `merged`.

The `merged`-settles-a-wave chain is real and I traced every hop:
- `plot-fleet-scan.sh:3985` — `case "$st" in merged) ;; ... *) outstanding=$((outstanding + 1))` — `merged` is the ONE word that settles; `unknown` falls to `*)` and counts outstanding. The plan's claim holds.
- `plot-dispatch.sh` takes `plot-fleet-scan.sh --list-eligible "$slug"` as a reading (two call sites). Confirmed.

## 2. Does the fix work, or break something?

**It works at the rule, and it needs a step the plan does not name.**

With the mutant (`if (readings.pr === 'MERGED') return 'merged'; return 'unknown';`) all six "Done when" rows hold:

```
behind main, NO commit             -> unknown
behind main + pr MERGED            -> merged
ref points AT main                 -> open
claimed (pushed claim commit)      -> claimed
wip (real work)                    -> wip
```

**Breakage, measured:** `test/branch-state.test.ts` — 4 failed / 38 passed. All four are in the file the slice already edits, and all four assert `merged` for a zero-ahead behind-main branch:
- `:57` `merged — a ref behind main, carrying nothing of its own`
- `:171` `leaves merged alone — overriding it would stop the wave settling forever`
- `:280` `answers merged when its tip is behind main`
- `:285` `answers merged where main cannot be read and the tip differs`

The plan's Done-when list mentions none of them. That is the answer to your count question: **four**, not one.

**No collateral breakage.** Full domain suite with the mutant: 4 files failed, but baselining the three suspects on unmutated main gave `109 passed (109)`, `3 passed (3)` — the `ports-real-state` / `refs-git-reads` failures were 5 s timeouts on shell-spawning tests under full-suite load, plus my own probe being collected by vitest. Not the fix.

**The corpus passes, and that pass is worthless as confirmation.** `packages/domain/corpus/branch-state.corpus.test.ts` (5 tests, 72 s) passed with the mutant — because it compares the rule against `plot-fleet-scan.sh --json`, and the scan asks `board/plot-branch-state.mjs`, which I had just rebuilt from the same mutated source. Both sides moved together. A reader who runs this and sees green has confirmed nothing.

## 3. What the plan claims that a measurement contradicts

**(a) The fix does not make the withheld slice dispatchable. This is the big one.**

Line 57: *"Deleting the three refs made all three dispatchable and agents took all three within two minutes."* Line 17 promises *"an approved slice cannot be silently withheld from dispatch."*

Driven directly:

```
verdict=eligible state=open     -> claimable=true
verdict=eligible state=unknown  -> claimable=false
verdict=eligible state=merged   -> claimable=false
```

`eligible.ts:172` — `verdict === 'eligible' && state === 'open' && held === ''`. `--list-eligible` prints claimable branches only. So after the fix the branch is STILL not dispatched; it moves from invisibly-settled to visibly-held. `plot-fleet-scan.sh:4114` says so in its own words: *"`unknown` is excluded by naming the two states rather than by negating the flag."* And the rule's own comment at `:190-200` says the same of the no-ref case: *"What it changes is CLAIMABILITY: `--next` offers `open` branches, so an `unknown` branch is not handed out."*

That is a defensible outcome — the plan's Changelog wording ("holds it with a named reason") is honest — but the Motivation's remedy (ref deletion → agents took them in two minutes) is NOT what this fix delivers, and a builder reading line 57 will expect dispatch to resume. **The operator still has to delete the ref.** The plan must say that.

**(b) The slice omits the artifact rebuild, and the rule ships compiled.**

`plot-branch-state.mjs` is minified and marked `-merge` in `.gitattributes:50`. Its baseline tail is literally `...e.refTip===e.mainTip?"open":"merged"`. Nothing in the fleet changes until `pnpm run build:board` runs. Proof through the shipped artifacts on the live branch's readings:

```
FIXED bundle    -> unknown
BASELINE bundle -> merged
```

`pnpm run build:board` rewrites **two** tracked artifacts, not one: `plot-branch-state.mjs` and `board-server.mjs`. The slice says only "change the `:264` return, extend the table comment, cover four rows". Also: `pnpm run build:board` fails under `corepack pnpm` here (`configured to use 10.27.0 ... your current pnpm is v11.24.0`); it must be invoked as plain `pnpm`.

**(c) `:264` swallows more shapes than the plan's table shows.** Three more reach it, all reading `merged` today:

```
behind main + pr OPEN         -> merged
behind main + pr CLOSED       -> merged
behind main + host throttled  -> merged
behind main + mainTip null    -> merged
```

`pr: 'CLOSED'` is the case the rule's own `:255` measurement is about (`one-deliver-rule-decides-in-the-domain`, PR CLOSED and never merged) — so the reset-to-main incident and this one overlap at `:264`, not only at `:260`. And `mainTip: null` reaching `merged` is asserted deliberately at test `:285` (*"an unreadable main is not equality"*) — an unreadable default branch currently settles every zero-ahead wave. The plan's "THREE sources" framing is too narrow; the arm is reached by an unreadable reading too.

**(d) A bounded-population claim I could not reproduce as stated.** Line 87 cites *"24 rows read `merged`, 23 carry a PR, exactly one does not."* This checkout has 7 remote branches total and one holds the shape — and that one's plan (`a-round-is-a-domain-fact`) is **`State: Released`**, so `sliceVerdict` returns `complete` from `FINISHED_PHASES` regardless of branch state and the shape is harmless there. The 24-row measurement is not re-derivable here; the plan should say which estate and when, because on this one the live instance does not demonstrate the cost.

## 4. What the plan must say before someone builds it

1. **That the fix does not restore dispatch.** Name the outcome as *visible hold*, not *dispatchable*, and say the operator still deletes the ref. Cite `eligible.ts:172`.
2. **The artifact rebuild as a step**: `pnpm run build:board` (plain `pnpm`, not `corepack pnpm`), and that it rewrites `plot-branch-state.mjs` AND `board-server.mjs`.
3. **The four existing assertions it must rewrite**, by line: `branch-state.test.ts:57`, `:171`, `:280`, `:285` — and for `:285`, a decision on whether `mainTip: null` should answer `unknown` (I believe yes, and the plan is silent).
4. **That the corpus test cannot verify this change.** `corpus/branch-state.corpus.test.ts` reads the scan's output, the scan asks the rebuilt bundle, so it agrees by construction. A green corpus must not be reported as confirmation.
5. **`pr: 'CLOSED'` and `pr: 'OPEN'` at `:264`** — state whether they answer `unknown` too (the mutant makes them, and the plan's table never lists them).
6. **Re-state or drop the 24-row measurement** with the estate and date, since it is not re-derivable here and the one live instance is a Released plan.

## 5. What executing revealed that reading would not

Reading the plan, the fix looks like a one-token change with a clean downstream story, and every line number it cites checks out. Three things only came out of running it:

- **`isClaimable` requires `open`.** Reading `queue.ts:56` and `plot-fleet-scan.sh:3473` — both of which the plan cites, both of which say `unknown` HOLDS — confirms the plan. Driving `isClaimable` shows that *holds* means *still not handed out*, so the plan's headline benefit (dispatch resumes) does not follow from its own fix. The plan's two cited sources are accurate and together they are misleading.
- **The rule ships minified.** Nothing in the plan or in the source file hints that `:264` also exists as `?"open":"merged"` inside two committed `-merge` artifacts. I only saw it because I rebuilt and diffed the bundles. A builder who edits the `.ts`, runs the domain tests green and pushes has shipped a fix the fleet never executes.
- **The corpus's green is circular.** Reading the corpus docstring — which is unusually careful, and explicitly says readings are taken *"from the same sources the scan reads, and never from the scan's own output"* — I would have trusted it. Running it after a rebuild shows the comparison's production side is the artifact I just changed.

One further note on the panel's own premise: the four failing tests are not a reason to reject. They are the file the slice edits, they assert the defect, and rewriting them is the work. The amendment is about the three things the plan does not say, of which (a) is the one that would mislead a builder into reporting the defect fixed while the branch still sits undispatched.
