## Implementation brief — the-board-asks-only-what-changed (wave 2: The call asks only for the delta)

- **Plan (canonical):** [`docs/plans/2026-09-21-the-board-asks-only-what-changed.md`](../../docs/plans/2026-09-21-the-board-asks-only-what-changed.md) on `main`
- **Approved:** 2026-09-21, jwloka, in-session
- **Branch:** `feature/the-call-asks-only-for-the-delta` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** PR review per repo convention

**This wave waits on wave 1, and wave 1 has landed.** `feature/the-store-holds-what-the-host-said` merged as **PR #958** into `a415f1403`. Nothing else waits on this branch; it is the plan's last slice, so delivering it delivers the plan.

### What to build

**One `gh pr list --state all` over 933 pull requests takes 29 811 ms. The same call with `--search "updated:>"` over one day takes 943 ms for 3 rows.** The board refreshes PRs every 60 s against a call that costs 30 s, and under load it reported *"No contact with the board server for 12 polls"* while the server was alive and sitting inside that call. **Factor 32 on GitHub, with every expensive field included** — which is why the answer is a delta call rather than a cache in front of the same call: the call itself gets cheap when it stops asking about history.

Wave 1 built the store that makes the delta possible. It is already on `main` and already works: `refreshPrs` reads `.plot/state/index/<connector>.json` before its call, seeds the board from it on a cold start, and folds the answer back into it afterwards. **The call itself is still the full read** — `['pr-list', '--rich', '--state', 'all', '--limit', String(PR_LIMIT)]` at `packages/board/src/server/fleet.ts:2701`.

This wave narrows that call. Two edits and one consequence:

1. **`plot-host.sh pr-list` gains `--since <iso>`** — passing `--search "updated:>$since"` on GitHub and a `q=updated_on>=$since` clause on Bitbucket.
2. **`refreshPrs` sends the store's watermark** as `--since`, and merges the answer rather than replacing with it.
3. **A periodic full read stays**, because a delta cannot see a deletion — and **`PR_REQUESTS_PER_REFRESH` follows the new cost.**

The plan is canonical; this is orientation. The full argument, including the per-connector table and the three questions it leaves open, is [`docs/stories/the-index-holds-what-the-host-said/DESIGN-index.md`](../../docs/stories/the-index-holds-what-the-host-said/DESIGN-index.md).

### The decisions the plan settles — do not re-derive them

**The watermark is the host's `updatedAt`, never `Date.now()`.** Wave 1 already enforces this: `foldPrIndex` takes the watermark from the merged rows and `PrIndex.at` — this machine's clock — is explicitly for an operator reading the file, never for a window. Do not compute the window from the local clock. A PR updated at 18:42:10 host-time, read by a client whose clock says 18:42:12, is excluded by every later `updated:>18:42:12` — **forever, silently, because the window never reopens.** The store's field is already right; send it unmodified.

**Send the watermark string byte-for-byte; never parse it to a `Date` and re-render.** `watermarkOf` compares ISO-8601 as strings deliberately, and its docstring says why: parsing would send this machine's rendering of the host's stamp rather than the stamp. The same rule applies at the call site.

**A delta answer is `complete: false`.** `foldPrIndex` merges a partial answer into what the store held and **replaces** on a complete one, so that a PR the host no longer lists leaves the store rather than outliving it. A delta that claimed `complete: true` would delete every PR outside its window on the first refresh — **that is #912 reproduced on disk**, where nine branches read *"commits, no PR ever opened"* while two had live ones, except that the next process inherits it. The rule is already written and tested; the only way to get this wrong is to pass the wrong flag into it.

**`complete` is NOT the same question as `PR_LIST_PARTIAL_RC`.** `plot-host.sh` already exits **7** for *some host states answered and some did not* — a Bitbucket-only shape, since `bb` has no `all` state and its arm calls once per state. A successful delta is **not** that: it covers a window completely and exits **0**. Conflating them would set `HOST_VERDICT=ok` off a degraded reading, or — worse in the other direction — raise the partial banner on every healthy delta. `refreshPrs` currently derives completeness from `partialSaid === null` (`fleet.ts:2828`); after this change completeness is *"was this a full read"*, which is a different fact and needs its own value.

**A failed delta never advances the watermark. This is the one direction the feature may not fail in.** The window stays open and the next refresh re-asks it, because a skipped window is a change nobody ever sees again. Wave 1 gives this for free on the failure paths it already has — the `catch` and the `allUnknown` path both leave the file untouched — but check the new path: a delta that returns *zero rows* is a success with nothing to fold, and it must not be confused with a delta that failed.

**A periodic full read is required, not optional.** A delta cannot see a **deletion**, and `updated_on` is the host's word: a PR force-pushed without a metadata change, or a host that back-dates, sits stale forever. The full read is the correction and its cost is known — 30 s, once a day, off the request path. **The cadence itself is an open question in the design** (§"What is still open", item 3: *"Daily is a guess; the honest input is how often a delta misses something, which only running it will say"*). Pick a defensible default, say in the code why it is a guess, and do not spend the branch deriving one.

**A cold store behaves exactly as today.** No index, an unrecognised `v`, or a `null` watermark each mean one full read — the current call, unchanged. **The store is an optimisation and its absence may cost time and nothing else.** `decodePrIndex` already answers `null` for all four failure shapes, so the branch's job is only to treat `watermark === null` as *ask for everything*.

**A field the host did not answer is absent, not false.** `PrIndexRowSchema` carries **no `.default()` anywhere**, by design: a default is how a cold store stops being byte-identical to no store. `refreshPrs` normalizes three fields to three *different* absent values — `url` to `""`, `mergeable` to `"unknown"`, `failing_checks` to `[]` — and the store round-trips whichever it was handed rather than inventing a fourth. Do not add a fourth on the delta path.

**The `allUnknown` outage path stays, and a store makes it more important rather than less.** `fleet.ts:2780` keeps the last good map and raises the banner when every PR reads `unknown`. It is what stops a dark host overwriting good data — and with a store on disk, a dark map written to disk is inherited by the next process as good data, where an in-memory one dies with the process.

**`plot-host.sh` is the ONE place that talks to the host CLI, and that is a gate rather than a rule.** `scripts/check-host-cli-callers.sh` fails CI on a new `gh`/`bb` caller. The `--since` translation belongs in the `pr-list` arm and nowhere else.

**`pr_list_call` call sites must write `|| exit $?`, and it is not optional.** It is invoked inside a command substitution — a subshell — so a `die` inside it leaves only that subshell; without the propagation the outer script carries on with an empty payload and `jq` emits nothing. **That is the silent empty list the helper exists to remove, rebuilt one layer further in and harder to see.** If `--since` adds a call site, it carries the same propagation.

### The one thing the plan did not anticipate

**`refreshPrs` builds its in-memory maps from the answer, not from the store** — `entry.prs`, `entry.prsByNumber` and `entry.prsByHead` are each populated inside the `for (const line of out.split('\n'))` loop at `fleet.ts:2727` and assigned wholesale at `:2801`. That is correct for a full read and **wrong for a delta**: a window returning 3 rows would replace a 933-PR map with 3 entries, and the board would report 930 branches as having no PR.

`foldPrIndex` merges on **disk**. Nothing merges in **memory** today. So this branch must build the served maps from the folded store rather than from the pass's rows.

**`seedPrsFromStore` is the shape to reuse and cannot be called as-is.** It already derives all three maps from stored rows, re-applying the same three rules the host path applies — the open-only filter for `prs`, the number key for `prsByNumber`, and `prOutranks` for `prsByHead`. But its first line is `if (entry.prsByNumber !== null) return;`, a deliberate guard against moving a live board backwards. **Extract the map-building, do not loosen the guard** — the guard is what makes a seed safe, and a delta path that bypassed it would be one that could seed over live data too.

### Done when

The plan's `## Slices` line for this branch is the specification: *"`plot-host.sh pr-list` gains `--since <iso>`, passing `--search "updated:>…"` on GitHub and `q=updated_on>=…` on Bitbucket; `refreshPrs` sends the watermark and merges the answer into the store. A periodic full read stays, because a delta cannot see a deletion. `PR_REQUESTS_PER_REFRESH` follows the new cost."*

Then these assertions, each of which exists **because a naive implementation would pass without it**:

- **A delta whose window returns 3 rows still serves 933.** This is the memory-merge defect above. A test that only asserts the store's contents passes while the board renders 3 PRs, because the store is right and the maps are not.
- **A delta never sets `complete: true`.** Catches the `#912`-on-disk failure. A test asserting only *"the store was written"* passes while every out-of-window PR is deleted.
- **A cold store issues the unchanged full call.** Assert the arguments, not just that a call happened: `--since` with an empty value would still "work" and would ask GitHub for `updated:>`, which is a syntax error the host may answer with everything or nothing.
- **A failed delta leaves the watermark where it was.** Catches a `catch` block that writes a store before rethrowing. The window must still be open on the next pass.
- **A delta returning zero rows is a success, not a failure.** It is the *normal* steady state on a quiet estate, and the path that treats *nothing changed* as *the host did not answer* would raise the outage banner every minute on a healthy board.
- **`--since` on Bitbucket composes with the existing `q=` state filter** rather than replacing it. `bb_branch_sweep` at `plot-host.sh:737` already builds `state="…" AND source.branch.name="…"`; a second `q=` parameter would silently win or lose depending on the host's parsing. Note `/` inside an unencoded `q=` value ends the filter — the file records this — so an ISO stamp's `:` and `-` need the same `url_encode` treatment the existing clause gets.
- **`PR_REQUESTS_PER_REFRESH` matches what the code now issues.** Under-declaring under-stretches the cadence, which is the failure that table's own header names: a board left open a working day made ~1400 Bitbucket requests just watching and hit an account-wide `HTTP 429`. Over-declaring is the mirror — stretching the cadence to pay for calls never issued.

Plus the repo's gates:

```bash
nvm use                      # Node 24 — pnpm crashes on 26
pnpm test                    # skills parse
pnpm run test:contracts      # helper estate + CI gates, incl. check-host-cli-callers.sh
pnpm run test:board          # rebuilds the board artifact + runs its tests
pnpm run typecheck
```

**Do not run `pnpm run test:e2e`.** It is CI's gate, not a local one — it dispatches real workers into sandbox repositories, and two agents running it once produced 53 concurrent `node --test` processes and a board that could not answer in 25 seconds.

**A changeset is required.** `.changeset/the-call-asks-only-for-the-delta.md`, description FIRST and the `bumps:` block LAST — a `bumps:` block written first becomes the published release note and the description behind it never ships. This touches both `packages/board` and `skills/plot/scripts/plot-host.sh`; follow `.changeset/the-store-holds-what-the-host-said.md`, which is on `main` and is this plan's sibling slice. Name the plan on a `plan:` line inside the same comment block.

**Rebuild the board artifact.** `skills/plot/scripts/board/board-server.mjs` is generated; `pnpm run test:board` rebuilds it. On a conflict there, take **either** side and rebuild — never read the diff, and never phrase it as "take ours", which inverts between `git merge` and `git rebase`.

### Bookkeeping

**Open the PR through the controller:**

```bash
skills/plot/scripts/plot-open-pr.sh          # or --draft while the work moves
```

It reads which plan names the branch and titles the PR with that plan's wave heading. **Do not run `gh pr create`** — measured 2026-09-08, three slice PRs opened that way each took their title from the last commit subject, which on this estate is routinely `plot: build the board artifact`.

**When the PR exists, append `→ #<number>`** to this branch's line in the plan's `## Slices` section on `main`. Note the wave heading already carries the sibling's annotation in the `(Branch: …, PR: #958)` form; **this branch's heading has no PR yet**, so follow the heading's own convention rather than the trailing-arrow one — `plot-plan-meta.sh` reads the heading form for waved plans.

**Push the first real commit as soon as it exists.** An unpushed branch is invisible to the fleet scan, which derives from `origin/<branch>`: a desk holding green, unpushed work reads as `eligible` and can be dispatched a second time.

### Scope guard

**This branch owns:**

- `skills/plot/scripts/plot-host.sh` — the `pr-list` arm only
- `packages/board/src/server/fleet.ts` — `refreshPrs`, the map-building extraction, `PR_REQUESTS_PER_REFRESH`
- `packages/domain/src/rules/pr-index.ts` and `entities/pr-index.ts` — only if the delta needs a rule the fold does not already give; prefer calling what is there
- `packages/board/test/unit/pr-store.test.ts`, `packages/domain/test/pr-index.test.ts`, `test/reconcile/host.test.mjs`
- `skills/plot/scripts/board/board-server.mjs` — generated, rebuilt not edited
- `.changeset/the-call-asks-only-for-the-delta.md`

**Other branches in flight, verified at dispatch on 2026-09-22:** none. `bug/the-index-is-read-once` merged as **#948** and touched `plot-reconcile-scan.sh` and its test only — no overlap with this branch. The only other remote ref is `changeset-release/main`, which Changesets owns.

**`packages/domain` style, which this branch will touch:** arrow functions (`export const f = (…) => …`), and **the unit is the function, not the file** — if you write the body it is an arrow; if you are passing through, leave it. TSDoc says what an export does, what its parameters mean and how it fails; the reasoning goes in the commit message and the plan, not in a 4:1 comment ratio.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
