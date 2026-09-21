# Evidence lens — an unasked host is not an absent PR

Position: amend

Reading position: the plan rests on one measurement — seven branches on `quatico/quaweb-website` rendered *"commits, no PR ever opened — abandoned"* while #358, #405 and #445 carried open pull requests. I tried to refute it. **The measurement survives.** What does not survive is the plan's account of the cause, and the plan misses a released sibling fix for the same symptom.

## What I ran

All commands are quoted with their real output. Repo under test read-only; nothing in quaweb was modified.

### 1 · The three PRs exist

```
$ cd /Users/jwloka/Quatico/Quatico.Webseite/quaweb-website && bb pr list --state OPEN
ID   STATE   AUTHOR              BRANCH                                    TITLE
405  DRAFT   Michael Aemisegger  feature/ki-lp-conversion-events           Draft: KI-LP Conversion-Events (quiz/workshop/refcard)
445  DRAFT   Jan Wloka           idea/hubspot-secret-hydration             Plan: VITE_HUBSPOT_IDENTIFY_PAYLOAD_SECRET erzeugt Hydration-Fehler
358  OPEN    Ralph Bänziger      improvement/QUACDS-958-standardize-ports  I: QUACDS-958 standardize development and production ports
```

**Confirmed, with one correction the plan should carry.** Two of the three are **DRAFT**, one is OPEN. The plan and the note both say *"three open pull requests"* and the plan's Changelog says *"live pull requests under review"*. A DRAFT PR is not under review. The claim is right in the direction that matters — a branch with a draft PR is emphatically not abandoned — but the wording overstates it, and the prior plan `a-partial-page-is-not-an-outage` got this right (*"#358 OPEN, #405 DRAFT"`). Match that precision.

### 2 · The board renders it exactly as claimed

```
$ curl -s http://localhost:7801/api/fleet
```

Seven rows, every one `quietKind: "abandoned"`, `pr: null`:

```
feature/success-story-ewz-leg              abandoned  "commits, no PR ever opened — last commit 247 days ago"
improvement/QUACDS-958-standardize-ports   abandoned  "commits, no PR ever opened — last commit 159 days ago"   ← PR #358 OPEN
feature/aeo-retest-2026-06-28              abandoned  "commits, no PR ever opened — last commit 84 days ago"
feature/seo-quick-wins-2026-06-28          abandoned  "commits, no PR ever opened — last commit 84 days ago"
feature/alt-urls-pruefen                   abandoned  "commits, no PR ever opened — last commit 38 days ago"
feature/ki-lp-conversion-events            abandoned  "commits, no PR ever opened — last commit 25 days ago"    ← PR #405 DRAFT
idea/hubspot-secret-hydration              abandoned  "commits, no PR ever opened — last commit 25 days ago"    ← PR #445 DRAFT
```

`prAgeSeconds: null`. **Seven abandoned, three of them carrying PRs. The central claim reproduces exactly, today, on the live board.** I could not refute it.

Polled three times over 26 s: `abandonedRows=7` each time, `prNextInSeconds` counting down 428 → 414 → 401. Stable, not a transient.

### 3 · `prState: 'none'` on the failure path — traced, not assumed

The lens asked me not to assume this. I traced it, and **the plan's own framing is imprecise**.

`quietKind` (`packages/domain/src/rules/quiet.ts:109`) does read `if (readings.prState === 'none') return 'abandoned'`. But `prState` is **never a host answer**. It is manufactured one layer out, in `packages/board/src/server/fleet.ts:4696`:

```ts
const wipReadings = (pr?: PrRecord | null, hasMergedPr = false): QuietBranchReadings => ({
  branch: '', prState: pr ? 'open' : 'none', hasMergedPr, isEmptyClaim: false,
});
```

reached from `rowQuietKind` at `:4779`:

```ts
if (state === 'wip' && !pr) return quietKind(wipReadings(pr, merged));
```

So `'none'` is a **restatement of `pr == null`** — the row carries no PR object. And `pr` is null because the join against `entry.prs` missed, which happens when (a) the host said there is no PR, **or** (b) the map was never populated. The plan says `none` "carries two meanings"; the sharper statement is that `prState` is a *derived* field with no failure channel at all, and `wipReadings`' own docstring asserts the opposite of what happens here:

> *"A branch WITH one never reaches the fallthrough — the PR arm above answers it — so this is `null` in practice"*

On quaweb three branches **with** PRs reach it. That docstring is a measurable falsehood and the plan should name it as part of the fix, because it is the sentence a future reader will trust.

### 4 · The plan's causal story does not hold — this is my substantive objection

The plan says: *"The raw call answers correctly in 0.4 s; the board never sees it before its own timeout."* The note builds the whole diagnosis on budget-ledger overhead causing a timeout.

Measured now, the failure is **not a timeout**:

```
$ cd quaweb-website && PLOT_BUDGET_OFF=1 plot-host.sh pr-list --state all --limit 1000 --rich
EXIT=6
plot-host: pr-list: host refused a burst — error: HTTP 429 — Rate limit exceeded   (×3, one per state)
plot-host: pr-list: no state answered; this is not a partial answer
```

With the budget **off** — the note's own proposed remedy applied. And `bb` alone, no Plot:

```
$ bb pr list --state OPEN     → error: HTTP 429
$ bb pr list --state MERGED   → error: HTTP 429
$ bb pr list --state DECLINED → error: HTTP 429
```

The host itself refuses. The note's *"`bb` answers in 0.4 s, exit 0"* and *"Rate limits were never reached"* are both **false as of today** — I reached one within a handful of calls. My own first `bb pr list --state OPEN` succeeded, so the limit is a burst limit I exhausted, exactly as the error text says (*"bounds calls at once, not per hour"*).

**This matters for the plan, not against it.** It makes the defect *worse* and *more general* than the plan argues: the branch is reached by a plain `429` on a small repository, not only by a slow ledger. The plan's Notes paragraph already gestures at this (*"a fetch can fail for reasons no cache removes"*) — but the Design section still presents timeout-from-overhead as the mechanism, and that mechanism is not the one I could reproduce. **Amend the Design to rest on the exit code, which is reproducible, rather than on the 0.4 s timing claim, which is not.**

### 5 · `prError` contradicts `prAgeSeconds`, and the plan does not account for it

```
prAgeSeconds: null
prError: "plot-host: bitbucket ignores --limit 1000 … possibly truncated (3 rows, requested limit 1000 unprovable)
          — a join against this page may read older branches as 'no PR' (#333)"
```

`prAgeSeconds: null` means `entry.prAt === null` (`fleet.ts:7056`) — **no fetch ever succeeded**. But that `prError` text names **3 rows** and originates at `plot-host.sh:2334`, which only runs on a state that *answered*. And on the board side `entry.prError = partialSaid` is set **only on the happy path** (`fleet.ts:2600`), which also sets `entry.prAt = Date.now()`.

So the payload asserts both *"a fetch answered with 3 rows"* and *"no fetch has ever answered"*. One of the two is stale or mis-set. **The plan does not mention this, and it should**: if `prError` can survive from a call whose rows were then discarded, a reader has a second false signal on the same screen, and `unasked` will render beside a warning claiming three rows arrived. Worth one sentence in *What must not break*.

Note also `unprovable` appears **0 times** in the running board artifact — I checked — so that string reaches the payload from `plot-host.sh` stderr, confirming the warning is the host's and not the board's own detection.

### 6 · The nearest existing mechanism — the plan ignores a released sibling

This is the finding the plan most needs to absorb.

`docs/plans/2026-09-18-a-partial-page-is-not-an-outage.md` — **State: Released, 2026-09-20, 2.19.0, Issue #912** — opens with:

> Reported as #912 by an operator on `quaweb-website`: three open PRs, the Agents tab shows **nine branches all labelled `commits, no PR ever opened`**, two of which have live PRs (#358 OPEN, #405 DRAFT). *"A reader cleaning up stale branches would delete work that is under review."*

**Same repository, same branches, same wrong word, three days earlier, already fixed and released.** The plan under review cites neither #912 nor that plan, and its Notes cross-reference only the ledger plan. A reviewer reading this plan cold would not know a fix for the identical symptom shipped last week.

I verified the #912 fix *is* in the board serving 7801:
- the board on port 7801 is pid 87207, started 2026-09-20 23:23, running the **marketplace artifact** (`~/.claude/plugins/marketplaces/plot-marketplace/skills/plot/scripts/board/board-server.mjs`, release `2d9ef409` = 2.19.0) — **not** this repo's `packages/board/src`;
- that marketplace `plot-host.sh` carries the partial arm (`:929`, `no state answered`);
- `scripts-shell.ts:101` maps `EXIT_PARTIAL` → `answer: 'partial'`, and `fleet.ts:2504` keeps partial rows.

**And it still shows seven abandoned rows.** So #912's fix does not cover this case, because today's failure is `EXIT=6` — *no* state answered — which is the total-outage branch #912 deliberately preserved. That is a genuine gap and it is the strongest possible argument for this plan.

But the plan must make that argument explicitly. As written it reads as if nobody had looked at this symptom before, when in fact the estate has a released fix whose scope stops one exit code short. **State the relationship: #912 handled `partial`; this handles `failed`/`unaskable`.** Otherwise the first reviewer to find #912 will reasonably ask whether this plan is a duplicate.

## The rubric

**1 · Does the problem exist, verified in code?** **Yes.** Reproduced live on the board (7 rows), in the host CLI (`EXIT=6`), and traced through `rowQuietKind:4779` → `wipReadings:4696` → `quietKind:109`. Three branches with PRs are labelled `abandoned` right now.

**2 · Is it the smallest change?** **Close, with one doubt.** A fifth `QuietKind` plus one reading is minimal for the *rule*. The doubt is the boundary: the plan adds `unasked` to `QuietBranchReadings`, but the honest fact — *the PR map was never populated* — lives in `entry.prAt === null`, not per branch. Threading a per-branch "the host answered" through `rowQuietKind`'s six parameters when the real reading is one process-wide boolean risks a field that is always the same value on every row. **The plan should name which reading it takes and from where**; today it says only *"the server passes the reading it already holds"*, which is the one sentence I could not verify against any line of code.

A narrower alternative the plan does not consider: `rowQuietKind` already refuses to answer for whole populations by returning `null` (`:4774`, `:4776`). Gating on `prAt === null` there is smaller than a new enum value crossing the wire. The plan rejects `null` in *A fifth kind, not a nullable field* — and I accept that argument, because `null` would render as it does today. But the plan argues against reusing `null` in the **rule**; it never argues against gating in the **server**. That alternative deserves a sentence.

**3 · What could I not verify?**
- *"The raw call answers correctly in 0.4 s"* — **refuted today**: `429` from `bb` directly, and `EXIT=6` through `plot-host.sh` with `PLOT_BUDGET_OFF=1`.
- *"the board never sees it before its own timeout"* — no timeout observed; `prNextInSeconds` counts down normally and the fetch returns an error code.
- *"the server passes the reading it already holds"* — I found no per-branch host-answered reading in `fleet.ts`. `entry.prAt`/`entry.prError` are per-entry.
- *"three open pull requests"* — two are DRAFT.
- The note's *"Rate limits were never reached"* — refuted.

**4 · What breaks if it ships as written?**
- Low blast radius. `AgentRowSchema.quietKind` is `.nullable().default(null)`, and `tuple-row.ts:1092` reads `row.quietKind` then calls `quietKindWord(kind)` — a **`switch`** over the enum. A new value reaching an older client, or a `quietKindWord` arm not added, yields `undefined` in slot 5 rather than a throw. Add the arm and a test; the plan says the row renders it but does not name `quietKindWord`.
- `quietNeedsPerson` (`quiet.ts:150`) returns `kind !== 'closed-pr' && kind !== 'merged'` — `unasked` falls through to `true`. That is right (a person should look) but it is an unstated consequence: every `unasked` row joins the attention population. Say so deliberately.
- The bigger risk is **over-firing**. If the reading is process-wide (`prAt === null`), then on any board whose first PR fetch has not yet landed, *every* quiet branch reads `unasked` — including genuinely abandoned ones. `abandoned` would effectively never fire on a cold board. The plan's *"`abandoned` must still fire"* guard names a corpus (*"a repository whose fetch succeeded"*) but not the cold-start window. That is the case that will bite.

**5 · Existing or nearer mechanism?** **Yes, two, and the plan names neither.**
- `a-partial-page-is-not-an-outage` (#912, Released 2.19.0) — same symptom, same repo, same branches. Not a duplicate, because it handles `partial` and this handles total failure, but the plan must say that.
- `plot-host.sh:2334` already emits *"a join against this page may read older branches as 'no PR' (#333)"* — the adapter has been warning about this exact join for some time, on stderr, where the board turns it into `prError` and renders it beside the wrong word. The plan should cite it: the estate already knows, in prose, what this plan proposes to make structural.

## Why amend and not proceed

The defect is real, reproduced, and consequential — `abandoned` is the word that licenses deleting a branch, and it is currently printed over three branches carrying pull requests. I tried to refute the core claim and could not. I would not reject this.

But three things must change before it is built, and each is a factual error a reader would inherit:

1. **The Design rests on a mechanism I could not reproduce** (a 0.4 s call lost to a board timeout) when the reproducible mechanism is an exit code from a refusing host. Rewrite it on the exit code.
2. **The released #912 fix goes unmentioned**, though it targets the same symptom on the same branches. Name it and say where its scope stops.
3. **The reading is unspecified.** *"the reading it already holds"* does not exist per branch. Name the field, and address the cold-start case where a process-wide reading would suppress `abandoned` entirely.

Two smaller corrections: two of the three PRs are DRAFT, not open; and `prError` currently contradicts `prAgeSeconds` on the same payload, which will sit beside the new word.

Position: amend
