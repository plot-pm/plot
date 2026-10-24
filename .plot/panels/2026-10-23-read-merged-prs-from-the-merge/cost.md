# Juror: cost lens

Subject: `docs/plans/2026-10-23-read-merged-prs-from-the-merge.md` at worktree HEAD `2dc47dcb2`.

## Measured (commands run, read-only)

- `git rev-list --count --merges origin/main` returns **677** merges out of 8196 commits. `git log origin/main --merges --format='%H %s'` takes **0.014 s wall**, and 0.012 s with `%ct` added.
- Of the 677, **513** carry `Merge pull request #N`, covering PR numbers 3 to 2417. This repo merges most PRs another way (squash), which is the population the plan sends back to the host.
- `plot-fleet-scan.sh:463-472` already records the walk as "nearly free (cap 500: 7.7 ms, no cap: 11.8 ms at 2000 merges)" and walks up to 2000 merges on every scan (`:478`). `merge-subjects.ts:40-41` records 1723 `Merged in` subjects on a Bitbucket estate.

## 1. Approach against the code (read)

- **Step 2 is wrong about the fold.** `foldPrIndex` (`rules/pr-index.ts:146-154`) starts a `whole` answer from an empty map, so it drops every row the host did not list. The daily full read (`PR_FULL_READ_MS`, `pr-refresh.ts:334`) would erase every subject-derived row once a day. "Written once and never re-asked" does not hold without a change to the fold. The plan does not name that change.
- **Step 3 saves no host requests per refresh as written.** A message-less (squash or rebase) merge is only discoverable by asking the merged state. So the merged listing stays, and Bitbucket still spends **3** list calls per refresh (`PR_REQUESTS_PER_REFRESH.bitbucket = 3`, `pr-refresh.ts:249`; 180 s cadence, about 60 requests/h per reader, `:177-180`). Deltas already narrow each call with `updated_on>=` (`plot-host.sh:1201-1214`). The plan states no request count, before or after.
- **The incremental range (`<last indexed>..origin/<default>`) buys about 10 ms and costs state.** It needs a stored commit watermark, which means a schema change, a `PR_INDEX_VERSION` bump (every store goes cold once) and handling for a rewritten default branch. The whole-fold problem above forces a full walk on each `whole` fold anyway. The existing port `Refs.mergeSubjects(ref, max)` (`ports/refs.ts:659`, `refs-git.ts:744`) takes a cap, not a range, and returns no date. A full walk through it, with `%ct` added, needs no new spawn site and leaves the `allowed=28` ratchet alone.
- **The trigger is wrong.** "After each `git fetch`" does not fit `refreshPrs`, which never fetches. The reader belongs in the refresh pass, reading `origin/<default>` as it stands.

## 2. Open Questions: what the estate answers

1. **One index or two.** The code answers it: one store with one writer, `pr-refresh.ts` → `foldPrIndex`. `refs` is already reachable as a port, so the reader adds no writer. Operator decision: none.
2. **Subject or host.** This needs an operator decision, and the cost lens sets the stakes. `plot-impl-status.sh:11,169` takes MERGED rows from the index for `/plot-deliver`, and `plot-reconcile-scan.sh` and `plot-board-probe.sh` read the same bundle. An unmarked subject row with `state: MERGED` therefore reaches delivery, which is a destructive decision. That breaks *One Answer To "Did This Land"*.
3. **Row shape.** The schema (`entities/pr-index.ts:30-90`) requires `draft`, `checks`, `review` and `url`, and forbids invented values (`:18-28`). A subject row cannot fill them honestly. It needs a `source` field and a version bump to 6.
4. **Overlap with #2400.** The code does not settle this, but the cost is countable. With `--all`, the daily full read on the 1723-merge estate walks about 35 merged pages at `pagelen=50` (`plot-host.sh:959`). The merge log could remove those pages from the full read. The plan claims neither that saving nor the per-refresh one.
5. **Inside #2386's reader.** That plan has the cache-versus-index question still open (#2386 OQ3). So this depends on #2386 and is not yet answerable.
6. **Squash fallback.** The code answers it: the index never supplies `none`. A missing row means "ask the host" (CLAUDE.md, *A Decision Reads The Index*). This repo shows the size: 513 subjects across about 2400 PR numbers.
7. **Reused branch names.** The rows are keyed by number (`entities/pr-index.ts:33`), so a subject row is true about its PR. Branch reuse matters only for readers that join by head. Those readers already rank by number (`pr-refresh.ts:1527-1540`). The age rule applies to wave-gate readers only.

## 3. Coverage of the #2385 addendum (read)

| Addendum point | Covered |
|---|---|
| List and single-PR GET throttled separately | No. The plan never mentions the single-PR endpoint |
| Seed once with a full paged walk | No. Left to #2400 at best |
| Terminal rows written once | Partly. Merged only, and the whole fold contradicts it |
| Open PRs as a watch list via `GET …/pullrequests/{id}` | No |
| Discovery by one delta page (`sort=-updated_on`, `q=updated_on>`), only on a new branch ref | No. Today's delta asks on every refresh, per state |
| Pair with #2386's single reader | An open question only |

The addendum's 429 relief comes from moving the open-PR refresh off the list resource. The plan moves only merged rows, which deltas rarely carry. So the plan fixes #333's truncation and leaves the 429 cost mostly where it is.

## 4. Consistency with CLAUDE.md

- **One writer:** consistent, if the reader feeds `foldPrIndex` from `pr-refresh.ts` through the `refs` port.
- **Only terminal answers read:** consistent. A merge is terminal.
- **The index never says no:** consistent in intent (OQ6).
- **One Answer To "Did This Land":** inconsistent unless the plan settles OQ2. The blast radius sits in `plot-impl-status.sh`, which feeds delivery.

## 5. Changes before approval

1. State the cost in numbers: requests per refresh before and after, per state, and full-read pages before and after #2400. If the per-refresh saving is 0, say so and claim only the truncation fix and the full-read pages.
2. Drop the incremental `<last indexed>..` read. Walk the full log through `Refs.mergeSubjects` with a date added, capped and saturation-reported as `plot-fleet-scan.sh:472` does. The measured cost is 14 ms on 677 merges.
3. Name the fold change: a `whole` host fold must keep subject-sourced rows, or re-supply them on every fold.
4. Decide OQ2 in the plan. Subject rows carry `source: merge-subject`, and the index lookup bundle used by `plot-impl-status.sh` and `plot-deliver` refuses them. The alternative is that the plan amends *One Answer* explicitly. Bump `PR_INDEX_VERSION` and name the one cold full read per machine that the bump costs.
5. Either adopt the addendum (a single-PR GET watch list for open PRs, and one delta page gated on a new ref) as a second slice with its request arithmetic, or state that it is out of scope and name where it goes. Then retitle the Changelog so it does not imply relief from HTTP 429.
6. Name where the code lives (TS, not shell), so the `scripts/check-shell-lines.sh` ratchet is not paid.

Verified by command: merge counts, subject split, PR-number range, walk timing. Everything else is from reading the cited lines. I did not run `plot-host.sh` against a host, and I did not measure the Bitbucket page count.

Position: amend
