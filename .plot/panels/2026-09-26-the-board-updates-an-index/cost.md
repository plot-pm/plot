# Cost lens — the board updates an index

Position: amend

cost: amend

Slices 1 and 2 stand on evidence I could reproduce. Slice 3 is justified by a cost table whose every number I measured to be wrong, and by a saving that PR #1005 already took this morning. Amend: keep the first two, strike the cost argument as written, and either re-measure slice 3 or drop it.

## 1. The defect is real and the diagnosis is exact

Verified rather than taken on trust:

- `App.tsx:283` is the only `setFleet` call and it assigns the whole payload. The failure path (`App.tsx:290-316`) calls `setFleetUnreachable`/`setFleetFailures` and never `setFleet` — so the plan's refutation of its own first reading is correct: a successful partial response destroys rows, the failure path preserves whatever was left.
- `FLEET_POLL_MS = 4_000` at `App.tsx:30`. Confirmed.
- Every code quote in the plan is accurate at the cited line: `fleet.ts:898`, `fleet.ts:2173`, `StartWorkButton.tsx:282` ("Nothing to store"), `queue.ts:51`, `App.tsx:290`.
- "Twelve POST sites across ten endpoints" — exactly right. 12 `method: 'POST'` sites across 12 files, hitting 10 distinct action endpoints (`/api/board` and `/api/fleet` being the two non-action ones).

The mechanism needs no defence. Slices 1 and 2 are sound.

## 2. One factual error in the motivation

> **It has zero readers in `packages/board/src/app/`.**

False. `AgentList.tsx:2206` reads it:

```tsx
{!fleet.complete && ' so far'} · scanned{' '}
```

The comment above it (`AgentList.tsx:2196-2205`) explains the reasoning at length — the total is qualified during a partial scan, the rows deliberately are not. So the client does read `complete`; it reads it for the counter and not for row retention. That is a *narrower and more interesting* claim than the plan makes, and it slightly undercuts the framing: someone already thought about partial arrivals on the client and decided rows were safe. The plan should say why that decision was wrong rather than assert nobody made it.

Not fatal. It does mean the plan overstates its novelty by one line of code.

## 3. The cost table is wrong in every row

The plan:

| consumer | call sites (plan) | call sites (measured) |
|---|---|---|
| `plot-fleet-scan.sh` | 15 | **6**, of which 2 are `backend` probes |
| `plot-reconcile-scan.sh` | 15 | **2** executable (2 more are literal strings printed as operator advice) |
| `plot-impl-status.sh` | 7 | **4** |

The plan's numbers are raw `grep -c plot-host.sh` counts including comment prose. `plot-fleet-scan.sh` mentions `plot-host.sh` on 14 lines; 8 of them are comments. `plot-reconcile-scan.sh` mentions it on 13; 11 are comments or printed advice strings.

Worse, the counts are structurally misleading in the direction that matters. Two of the four remaining reconcile mentions (`:2901`, `:3021`) are inside `unrel_out+="    inspect: plot-host.sh pr-state $last_pr\n"` — text handed to an operator, not a call. And the surviving real calls are **already bundled**:

- `plot-reconcile-scan.sh:503` makes **one** `pr-list --state merged --limit 500` up front, then every section tests set membership against it. Its only per-plan `pr-state` (`:3001`) is in section 6, which is below the blocking marker.
- `plot-fleet-scan.sh:862,878` make **two** `pr-list` calls; the per-branch `pr-state` at `:1147` is short-circuited by `.list-complete` (`:1136-1143`) whenever the list is known whole. On this estate it is whole, so that site fires zero times.

"Nothing shares an answer with anything else" is not true within a consumer. The sharing gap is *across* consumers and across passes, and the plan does not measure that.

## 4. The 37 s figure is obsolete — by about four hours

> The rollup alone was measured at ~37 s of a ~55 s scan

`38e1250ad` "The rollup is asked of open PRs only (#1005)" is on `origin/main`, merged 2026-09-26 12:08. Its own commit message names exactly this number: *"957 on this repo, ~37 s of a ~55 s scan"*. That is the plan's source, and it is the description of the **pre-fix** state. The fix ships two `pr-list` calls instead of one rollup-for-all.

Measured just now, on main at `e10b96e00`:

| run | wall |
|---|---|
| fleet scan, cold | **40.7 s** |
| fleet scan, warm (`PLOT_TERMINAL_CACHE` = 22 entries) | **42.0 s** |
| fleet scan, repeat | 37.6 s |
| `--no-pr` (no host at all) | **13.4 s / 14.5 s / 12.8 s** |
| `--no-fetch` (host still asked) | 28.3 s |
| `pr-list --state open --limit 500 --rich` alone | **2.5 s** |
| `pr-list --state all --limit 500` alone | **4.6 s** |

The two host calls the scan actually makes cost **7.1 s combined**. The plan's headline — the rollup as 37 s of a 55 s scan — describes code that no longer exists. A plan justifying new architecture by a cost its own repo removed hours earlier needs that paragraph rewritten, not softened.

## 5. The scan is not 18 s and not 84 branches

The plan repeats `fleet.ts:898`'s *"18 s on 84 branches"* as a live fact. The scan's own summary today:

```json
{"plans": 22, "waves": 25, "branches": 25, "claimed": 0, "host": "ok"}
```

**25 branches, ~40 s.** The estate shrank by 70% and the scan got slower by 2x. The 4 s-poll-against-a-slow-scan argument therefore holds *more* strongly than the plan claims, not less — the ratio is 10:1, not 4.5:1. This one cuts in the plan's favour, and it should be restated with a number someone can reproduce rather than a comment quoted from a file.

## 6. The existing cross-pass cache already saves nothing

The plan's admissibility argument leans on `PLOT_TERMINAL_CACHE` as precedent, and `fleet.ts:3289` shows the board already feeds it into every scan. I measured its effect: **40.7 s cold vs 42.0 s warm**, 22 terminal entries in play. Within noise — the cache saves nothing measurable on this estate.

That is a real problem for slice 3's premise. The estate's one existing host-answer cache, built on exactly the properties the plan proposes to adopt, delivers no measurable saving. The plan cites it as proof the approach is safe; it is equally evidence the approach is not where the time goes. Neither the plan nor I can tell which without knowing where the other ~18 s of host time lands (25 s total host cost minus 7 s of `pr-list`), and the plan does not ask.

## 7. Does an index save a host call?

Asked directly, per the rubric: **not for the two slices that are specified.** Slices 1 and 2 are pure client-side render state — they save zero host calls and the plan correctly says so (*"entirely client-side. No scan change"*). Their justification is correctness, and it is sufficient on its own.

Slice 3 is the only one making a cost claim, and for it the answer is *unknown on this evidence*. Each consumer needs a fresh answer for correctness at different moments: the supervisor's `landed` (`queue.ts:51`) explicitly holds a slice on `unknown` rather than accepting a stale negative, and `plot-release-refs.sh` deletes refs — an unvalidated shared answer there is the one failure the estate has written most carefully against. The plan's three adopted properties (revalidate against git, store what the host said, absence stays absence) are the right constraints, but a cache revalidated against git on every pass is precisely `PLOT_TERMINAL_CACHE`, which §6 shows saves nothing.

## 8. What the plan must say before someone builds it

- **The key is `branch`, but nothing states its uniqueness.** `plot-reconcile-scan.sh` section 14 (`double_claims=`) exists because a branch can be listed by more than one plan. If two rows in one payload carry the same `branch`, the merge is undefined. Say which wins.
- **No bound on the index.** Rows accumulate forever in a long-lived tab; only `complete: true` reaps, and a board whose scans never complete grows without limit. Name a bound or say why none is needed.
- **`complete: true` is not the only reaping condition it needs.** A branch deleted after merge (`plot-release-refs.sh` runs routinely here) vanishes from every future payload. Under `complete: false` it is held indefinitely. The plan's own Done-when list does not cover a row that is gone for good while scans stay partial.
- **The held-row age conflicts with the one existing `complete` reader.** `AgentList.tsx:2206` currently qualifies the *total* and deliberately not the *rows* — "The rows themselves are NOT qualified". Slice 1 inverts that. Say so explicitly; it is a reversal of a documented decision, not a gap.

## What I would change

1. Strike the four-consumer table. The numbers are grep artefacts and three of the four are wrong by 2-7x.
2. Strike or date-stamp the 37 s / 55 s figure as *pre-#1005*, and replace it with a measurement taken after `38e1250ad`.
3. Replace "18 s on 84 branches" with today's reproducible figure: ~40 s on 25 branches, of which ~13 s is git and ~7 s is the two `pr-list` calls.
4. Fix "zero readers" to name `AgentList.tsx:2206` and argue against the decision recorded there.
5. Either re-measure slice 3's premise — where does the ~18 s of unexplained host time go, and would a shared index reach it? — or drop slice 3 and ship the two slices that stand on correctness alone.

Slices 1 and 2 need none of this and should not be held for it.

