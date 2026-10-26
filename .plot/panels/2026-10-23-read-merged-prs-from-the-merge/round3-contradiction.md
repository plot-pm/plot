# Round 3 — contradiction

Subject: `docs/plans/2026-10-23-read-merged-prs-from-the-merge.md` at `9774d8e1b` (Draft, Rounds: 2). Code read at `origin/main` `8f87cb9c4` in the `panel2419-main` worktree. Lens: does the plan disagree with a sibling plan or with a decision this repository already made?

Position: amend

## Summary

The amendment resolves every round-2 defect except one, and it brings four new contradictions with decisions already in the code and in a Released plan:

1. **#2400 is Delivered again on main.** The round-2 rejection did not hold. `c67b5cd1f` re-delivered #2400 43 seconds after `6666041ff` rejected it, with no code. The plan says "#2400's plan file is unchanged" (line 158), and that is false. The release will still publish #2400's Changelog line for code that is not on main.
2. **Slice 1's exit 0 at the limit contradicts `_bb_paged_walk`'s stated rule** of one exit vocabulary (exit 3) for "the answer may be short". The *Shell Lines* fallback, which reuses `_bb_paged_walk`, then contradicts Approach 2.
3. **Approach 3 cuts the queue's merged listing from 500 to 50.** That reverses a measured decision recorded at `registryd-main.ts:784-789`, and the justification ("newest 1000 PRs of each state on both hosts") is false for GitHub.
4. **Paging the full read contradicts the Released plan `2026-09-20-a-pr-list-reads-every-page` (#333, 2.19.0)**, which rejected paging on cadence grounds. The plan does not cite it, and its one unbounded case (a partial full read that repeats every 180 s) is the under-declaring failure that `PR_REQUESTS_PER_REFRESH` names. The plan leaves that case as an open point.

## 1. Round-2 findings

Agreement:

- **A1, false *host unreachable* line from exit 7:** resolved. Slice 1 pages and adds no exit 7 (Approach 2, line 47; Open Point line 167). It stays resolved only if slice 1 does not reuse `_bb_paged_walk` as it is today (see §5, N2). (read)
- **A2, exit 7 gets a second meaning:** resolved (line 47, Open Point line 163). (read)
- **A3, callers that drop rows on exit 7:** resolved (line 168). A page that fails mid-walk fails its state, which is today's meaning, and those callers handle it today. (read)
- **A4, slice 3 duplicates the deliver gate:** scoped with a reason. *Deliver Gate Overlap* (lines 52-61) and Open Point line 173 say that step 4 needs PR numbers, which `DeliverabilityAnswer` does not carry. (read)
- **A5, slice 2's Changelog line has no reachable case:** restated (line 17, Open Point line 172). The line now names only the footer note. (read)
- **A6, line 43 and the existing domain test:** resolved (Approach 2 line 47 cites `wholenessAfter` correctly; line 175). I confirmed `rules/pr-index.ts:268` returns `false` for `partial`. (read)

Disagreements:

- **D1, third cap:** resolved. Slice 2 (line 146) names `production.ts:286-290` and asks for an equality test of all three caps. I confirmed the corpus default at `packages/domain/corpus/production.ts:289` is `limit = 2000`. (read)
- **D2, what slice 1 becomes:** resolved by option (b), paging (lines 46, 133, 166).
- **D3, is slice 1 worth its price:** left open, as Open Points lines 170 and 174. Line 170 is a contradiction, not only a cost question; see §5, N4.
- **D4, slice 3 one call or per branch:** resolved, one call with repeated `--branch` (line 50, line 150). (read)

Found by one juror:

- **#2400 Delivered with no code:** resolved in the text and then overtaken on main. See §5, N1.
- **GitHub `complete: true` above the limit:** left open as Open Point line 174, with three named options. Acceptable as an operator decision.
- **`merge-subjects.ts:40-41`:** resolved (line 146).
- **Summary opens with the July plans:** resolved (line 3 states the HTTP 429 cause and out of scope).
- **Shell-lines offset:** resolved (lines 99-105), but the fallback in line 103 creates N2.
- **Stale `2000` in `merge-subject.ts:39`:** resolved (line 146).
- **`prWindowFor` line:** resolved, `:384` (line 92). I confirmed `rules/pr-index.ts:384`. (read)

Shared blind spots:

- **Page order:** measured (line 34, Notes line 156). I did not re-measure. (read)
- **What the plan is for without #2400:** answered. The plan now does #2400's paging (line 32, line 133).

## 2. Approach against the code

All checks are reads on `8f87cb9c4`.

- **Line numbers.** The plan cites `b2df79eaf`, but every line I checked still matches on `8f87cb9c4`: `plot-host.sh:935`, `:960-970`, `:1132`, `:1222`, `:1309`, `:1393-1406`, `:1544`, `:3250`, `:4488`, `:4735-4736`, `:4771`; `registryd-main.ts:599`, `:791`; `registryd.ts:80`; `queue-reading.ts:325-332`; `pr-refresh.ts:249`, `:303`, `:331`, `:1499-1500`; `rules/pr-index.ts:268`, `:384`; `plot-fleet-scan.sh:472`, `:481-483`, `:1047`, `:1063`; `plot-impl-status.sh:245-277`. Motivation line 26 names `b2df79eaf` as the read commit, which is stale but harmless.
- **Slice 1, paging and exit codes.** False against an existing decision. See N2.
- **Slice 1, the queue change.** False claim and reversed decision. See N3.
- **Slice 1, Cost table.** The `pr-refresh.ts` full read row (3 → 24) is arithmetically right for 1000 / 50 + 1 + 3 on ewz-kus-portal. The note "per day the refresh spends 1440 + 21 requests" holds only while no state fails. See N4.
- **Slice 2.** The three caps and the equality test match the code. `registryd-main.ts:597-599` documents `MERGE_WALK_LIMIT` as "the fleet scan's own cap", so the equality test enforces what that comment already says. No contradiction.
- **Slice 3.** `pr-list` accepts repeated `--branch`; on Bitbucket it runs `bb_branch_sweep` (`plot-host.sh:1222`); on GitHub one branch maps to `--head` (`:4487-4488`) and several keep the listing. Correct. But line 50 says "the helper stays one call per plan, as its header states (`plot-impl-status.sh:251-253`)". The header says "fetched ONCE for the whole plan (constant in branch count)". On Bitbucket the sweep spends one request per branch, so "constant in branch count" becomes false, and slice 3 does not list that comment for correction. Cost line 96 states the per-branch cost, so the plan knows it; the slice text does not carry it through. (read)

## 3. Each slice against its Changelog line

- **Slice 1, line 16:** observable on a Bitbucket board (more PR rows; a branch with an older PR shows it). The line also describes nothing slice 1 does not build. It does not mention the queue change from 500 to 50, which also changes GitHub, and which an operator can observe as a held slice (N3). A Changelog line or a Board-impact sentence must name it, or the change must go.
- **Slice 2, line 17:** accurate and observable (the footer note).
- **Slice 3, line 18:** accurate for step 4.
- **The ewz-kus-portal symptom:** the plan no longer claims to fix it. Line 3, line 20 and line 124 all say the July plans' *state unknown* comes from HTTP 429 and is out of scope. The title is true up to each caller's limit: on ewz-kus-portal, with 3527 merged PRs, the scan's 3000-row listing still misses the oldest 527, and the board's 1000-row full read misses 2527. Line 16 says "up to the caller's `--limit`", which is honest.
- **Release interaction:** #2400's Changelog line ("reads every page … when the installed `bb` supports `pr list --all`") will be published beside line 16 for the same change. See N1.

## 4. Open points

- **Line 162, scope / v6 `subjects`:** operator decision. The repository's rules (*Answers, never verdicts*; `fleet.ts` "A persisted verdict would be a cache git cannot reach") favour the plan's choice. (read)
- **Line 164, reused branch name in slice 3:** needs the read-only measurement the plan names. Not an operator decision until it is measured.
- **Line 165, drop `--merges`:** the code already decided this. `merge-subjects.ts:40-41` keeps `--merges`, and the plan's own numbers (0 on ewz-kus-portal, 7 in about 70 clones) do not overturn it. Keep the default; this point can close.
- **Line 170, partial full read repeats:** not a free design choice. `PR_REQUESTS_PER_REFRESH`'s header (`pr-refresh.ts:184-188`, "an under-counted cost under-stretches the cadence") forbids an unbounded under-declared cost. The precedent the plan cites (line 91, the pending re-ask) is excluded only because `PR_PENDING_REASK_LIMIT` bounds it (`pr-refresh.ts:194-203`). The partial repeat has no such bound. So the back-off is a requirement of slice 1, not an open point. See N4.
- **Line 174, `complete: true` above `PR_LIMIT`:** operator decision. Accepting it matches the GitHub arm's existing behaviour (`plot-host.sh:4735-4736`) and *A Decision Reads The Index* ("the index never says no"), because no lookup reads the flag. The retraction reader (`index-findings.ts:179`, `allPrs: index.complete`) can retract a finding for a PR outside the newest 1000. On ewz-kus-portal that touches no open PR (10 open). (read)

## 5. New defects

### N1. #2400 is Delivered again, and the plan says its file is unchanged

Ran `git log -- docs/plans/2026-10-23-plot-host-bitbucket-pr-list-reads.md` and `git show` on `8f87cb9c4`:

- `b2df79eaf` delivered #2400.
- `6666041ff` (15:38:04) rejected it: `State: Approved`, a `Rejected:` record, symlink to `active/`, sprint item unticked.
- `c67b5cd1f` (15:38:47, 43 s later) delivered it again: `State: Delivered`, a second `Delivered: 2026-10-26`, symlink back to `delivered/`, sprint item `[x]` in `2026-W43-bugfix-2-28-2.md`.
- `bb_state_listing` on `8f87cb9c4` still asks one page (`plot-host.sh:1393-1406`).

The brief's "Approved again" is stale. The plan's line 32 ("delivered with no code") is true, but Notes line 158 ("#2400's plan file is unchanged") is false: it now carries a `Rejected:` record. The round-2 consequence is back: the next release publishes #2400's Changelog line for a `bb pr list --all` path that will never exist, and this plan's line 16 describes the real change. Two Changelog lines for one change, one false.

The cause is likely that the deliver controller finds PR #2422 MERGED and re-delivers; a rejection cannot hold while a merged claim-only PR names the slice. That is a defect for `/plot-reject` and the deliver gate, not for this plan. But this plan depends on its outcome.

**Amend:** the plan names how #2400 leaves the release. Options: the operator edits #2400's Changelog line to say it shipped nothing and points at this plan; or this plan's slice 1 records that it supersedes #2400 and the release step drops #2400's line. Correct line 158. File the reject-then-redeliver loop as its own issue.

### N2. Exit 0 at the limit contradicts `_bb_paged_walk`'s rule, and the fallback contradicts Approach 2

`plot-host.sh:1097-1103` (read) states the decision #2484 made for every Bitbucket walk: "A STOPPED WALK REPORTS ITSELF … AND RETURNS EXIT 3 … A caller reading the exit code sees one vocabulary for 'the answer may be short' whether the cause is a refused call or a walk the cap stopped." `_bb_paged_walk` implements it at `:1138`.

Approach 2 (line 47) gives the state listing the opposite rule: a walk at the limit exits 0 with *possibly truncated*, following the GitHub arm. The GitHub precedent is real (`:4735-4736`), so the choice is defensible, but the plan does not name the decision it departs from, and after slice 1 the Bitbucket arm has two vocabularies for "short".

*Shell Lines* (line 103) then says: "If that is not enough, it reuses `_bb_paged_walk` with a page-cap argument." Reused as it is, the walk returns 3 at its cap. On ewz-kus-portal the merged state (3527) exceeds `PR_LIMIT` (1000), so every full read would fail the merged state, `--state all` would exit 7, the refresh would fold `partial`, the store would never become whole, and every 180 s refresh would spend 24 requests. That is the round-2 A1 defect returning through the fallback.

**Amend:** Approach 2 states that it departs from `:1097-1103` for the plain listing and why (the GitHub arm's behaviour, and a listing at its requested limit is the answer the caller asked for). The `_bb_paged_walk` header gains a sentence that the plain listing uses exit 0 at its limit. The *Shell Lines* fallback says the reused walk must return 0 with the truncation line when the cap equals the caller's limit, or the fallback goes.

### N3. The queue cut from 500 to 50 reverses a measured decision, and its premise is false on GitHub

`registryd-main.ts:784-789` (read): "THE LIMIT IS EXPLICIT AND LARGE, because the join is against the WHOLE history … measured 2026-09-06, #707 and #710 are hundreds of merges back and a default page missed both, leaving their plans blocked". `queue-reading.ts:320-325` records the same failure on 2026-10-10 (#1454) at 800 merges back.

Approach 3 (line 48) lowers the limit to 50 on both hosts and relies on the index: "after step 1 the index holds the newest 1000 PRs of each state on both hosts". Two problems:

- **False for GitHub.** The GitHub arm lists `--state all` in one call (`plot-host.sh:941`), and `pr-refresh.ts:1500` asks `--limit 1000`. The index holds the newest 1000 PRs across all states, not per state. The round-2 estate juror measured this checkout's store at 1007 rows total. The queue's GitHub request cost does not change with the limit (one `gh` call either way), so the cut buys GitHub nothing.
- **The index never says no.** A missing, wrong-version or unreadable store gives zero rows. ewz-kus-portal's store is `v: 2` (round-2 cost juror), which decodes to nothing against `PR_INDEX_VERSION` 5. The 50-row listing then reads as `whole`: `registryd-main.ts:806-807` sets `whole = refusal === null`, and the *possibly truncated* line is stderr only and sets no refusal. So `landedWithoutListing` does not run (`queue-reading.ts:330-332`), and any slice behind a merge between the 51st and 500th newest stays held on `waits`. That is the #707/#1454 failure, made reachable on every estate whose fleetd has not yet written a current store.

**Amend:** keep 500 on GitHub, or keep 500 everywhere and price the 10 Bitbucket requests per tick; or make a Bitbucket listing that reaches its limit non-`whole` in `mergedBranches`, so `landedWithoutListing` asks by number. Correct line 48's "on both hosts". Update the comment at `registryd-main.ts:784-789` in whichever direction is chosen. Name the change in the Changelog or Board-impact comment, since it changes GitHub.

### N4. Paging the full read contradicts the Released #333 plan, and the partial repeat is the under-declared cost it warned about

`docs/plans/2026-09-20-a-pr-list-reads-every-page.md` (State: Released, 2.19.0; read) section *Why not page the list — the shape this plan rejected* rejected walking `next` through the merged pages: "Paging makes it ~21, and the interval follows mechanically … 1260 s — 21 minutes", and "Under-declaring the cost instead is the failure `fleet.ts:176` names". That rule now lives in `pr-refresh.ts:184-188` and is restated for Bitbucket at `:236-238`.

This plan pages the full read and declares 3, not 24 (Cost line 91). The argument is sound for the daily read: deltas (`bb_window_listing`) arrived after #333, so the full read now runs once in about 480 refreshes, and the pending re-ask precedent excludes a rare, bounded cost. But the plan does not cite the Released decision it partly reverses, and one case is neither rare nor bounded: after a `partial` answer, `prWindowFor` asks a full read on every refresh (line 92), and a partial answer gets no back-off (`pr-refresh.ts:1781-1792`). On the estate that throttles (ewz-kus-portal, #333 / HTTP 429), that is 24 undeclared requests every 180 s against a limit that is already hit — exactly the failure `pr-refresh.ts:184-188` exists to prevent, and a direct contradiction with #2386's approved goal of fewer requests on that account.

**Amend:** cite `2026-09-20-a-pr-list-reads-every-page` in Motivation or Cost, and state why its rejection no longer applies (deltas). Move Open Point line 170 into slice 1: the refresh applies its rate-limit back-off to a `partial` answer whose missing state was throttled, and slice 1's HTTP 429 stub test (line 142) also asserts that the next refresh waits. Then the Cost row's "after a `partial` answer" is bounded.

### N5. Comments slice 1 makes false and does not list

Read on `8f87cb9c4`. After slice 1 these state the opposite of the code:

- `bb_state_listing`'s header, `plot-host.sh:1381-1388` ("ONE PAGE, AS BEFORE … answers with its 50 most recent").
- `pr_list_report_truncation`'s rule table, `:3153-3156` ("bitbucket (ONE FIXED PAGE): the listing ignores --limit").
- `:3175-3180` ("closing the ~780-PR gap … is unaffordable … no per-branch fallback is shipped").
- `pr-refresh.ts:240-244`, which says a Bitbucket call spends "one call per state". That is already false for a windowed read and becomes false for the full read.

`rules/listing-page.ts`'s rule needs no behaviour change (a page below 50 or with no `next` is still complete), but its doc likely carries the same "fixed page" wording; I did not read it.

**Amend:** slice 1 lists these comments for correction.

## Siblings read

- `2026-10-23-plot-host-bitbucket-pr-list-reads.md` (#2400): read, including its three state commits. See N1.
- `2026-10-23-one-pr-reader-per-machine-and.md` (#2386): read lines 1-30 and the slice line. Still Approved, slice deferred (PR #2436 closed). The plan's Scope row (line 118) is accurate. N4 is the one tension.
- `2026-09-20-a-pr-list-reads-every-page.md` (#333, Released 2.19.0): read in full. Not in the brief's sibling list; found under `docs/plans/delivered/`. See N4. Its warning that `bb`'s own paginator caps at 10 pages agrees with the plan's choice of `bb api`.
- #2484 and #2560: not re-read this round; round 2 found no contradiction.
- Active sprint `2026-W43-follow-ups-2-28-3.md`: read all 30 titles. #2158 (impl-status host resolution) and #2484 are done and consistent. #2479 (reconcile-scan sections, open) does not touch `plot-reconcile-scan.sh:738`'s listing. I read no other item beyond its title.
