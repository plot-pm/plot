# Consumer lens — both plans

Position: amend

Driven by **`a-pr-list-costs-one-round-trip`**. `a-capped-page-says-what-it-hid` would be `proceed` on consumer grounds alone; the shared position is the lower of the two.

The concurrency plan's central consumer claim — *"Every consumer parses line-delimited JSON and joins by branch, so order is irrelevant"* — is **true for stdout and false for stderr**, and the plan never looks at stderr. Three consumers read stderr positionally, one of them is the plan's own named evidence, and the plan asserts that evidence passes unedited.

---

## Every reader of `pr-list`, and what it depends on

| consumer | site | stdout order? | stderr? | timing? |
|---|---|---|---|---|
| `plot-fleet-scan.sh` | `:691` | **no** — re-ranks | whole string, `case` match | no |
| `plot-reconcile-scan.sh` (open) | `:473` | no — `jq` map | **first line only** (`:475`) | no |
| `plot-reconcile-scan.sh` (merged) | `:503` | no | `2>/dev/null` | no |
| `fleet.ts refreshPrs` | `:2477` | no — `prOutranks` | whole string → `prError` (`:2580`) | **yes** — `withHostSlot` |
| `registryd-main.ts` | `:436` | no | — | no |
| `corpus/production.ts` | `:205` | no — `bestPrPerBranch` ranks | classified on exit + stderr | no |
| `test/reconcile/host.test.mjs` | `:1075` | sorts (`:1051`) | **first line only** | no |

**The stdout half of the claim is verified and holds.** `plot-fleet-scan.sh:840-841` prefixes a rank digit (`OPEN 1, MERGED 2, else 3`) and `sort -k5,5 -k1,1` before the loop reads it — it explicitly does not trust arrival order. `fleet.ts:2528-2533` says so in words: *"Without the rank the answer would depend on the host's listing order, which no adapter promises: `gh` sorts by number descending today, `bb` says nothing at all."* `bestPrPerBranch` (`branch-state.corpus.test.ts:130-137`) ranks the same way. No consumer takes the first row or assumes open comes first. **That part of the plan is right, and the test it asks for is cheap.**

**The stderr half is where it breaks**, and the plan does not mention stderr once.

---

## Plan 1 — `a-pr-list-costs-one-round-trip`

### Finding 1 (blocking): the plan's own unedited evidence fails under concurrency

The plan's Done-when:

> pinned by the existing tests at `test/reconcile/host.test.mjs:1038` and `:1081` **without editing them**, since they already pin exactly this and a passing unchanged test is the evidence

`host.test.mjs:1075-1077` is inside `:1038`:

```js
const firstLine = r.stderr.trim().split('\n')[0];
assert.match(firstLine, /rate limit/i,
  'the host’s reason was buried under this helper’s own bookkeeping');
```

That asserts on **stderr line ordering**. Today `pr_list_states` (`plot-host.sh:600-629`) is a serial `for`, so state N's stderr is flushed before state N+1 starts, and `declined`'s `rate limit` is the only stderr line in that fixture. Under concurrency, three states write to one fd at once and the first line is whichever state returns first.

Measured in a sandbox reproducing the shape (three backgrounded writers, one stderr):

```
# failing state slowest (open 0.01s, merged 0.02s, declined 0.06s)
plot-host: bitbucket pr-list state=open possibly truncated   ← first line
{"number":1,"head":"open"}
plot-host: bitbucket pr-list state=merged possibly truncated
```

Reproduced 2/2. The failing state's sentence is no longer first, and `/rate limit/i` does not match.

**This is not a contrived ordering.** The plan's own table makes it the expected one: `open` 5.4 s, `declined` 15.1 s, `merged` 23.0 s. The fast state is `open`; a failure in `merged` or `declined` arrives last by ~18 s. So the plan's stated evidence fails in precisely the shape the plan's own measurement predicts.

The plan cannot both (a) run states concurrently and (b) leave `:1038` unedited, unless the implementation **buffers each state's stderr and replays it in state order after the joins**. That is a real design constraint and the plan states none. `pr_list_states` already spools per-state stderr to `_tmp` (`:601`, `:607`) — the mechanism exists — but replaying in order is a decision the plan has to make and does not.

### Finding 2 (blocking): the first-line contract is a shipped consumer, not just a test

`plot-reconcile-scan.sh:475`:

```sh
err=$(head -1 "$tmpstderr" 2>/dev/null)
```

and it classifies on that one line (`:482-487`) into `PR_SOURCE=absent` vs `failed`. The comment at `host.test.mjs:1070-1074` names this reader explicitly as the reason the ordering rule exists:

> Caught by the contract suite 2026-09-18: an earlier draft printed `state 'open' failed` ahead of the host's sentence, and `plot-reconcile-scan.sh` — which reads the first stderr line into its error field — showed that instead of `HTTP 429`.

So the estate has already been bitten once by stderr ordering in this exact function, fixed it deliberately, and pinned it. The concurrency plan reopens it by a different route and does not cite the fix.

*Mitigating*: reconcile calls `--state open` and `--state merged` — single-state calls, where `bb_states_for` yields one word and concurrency is a no-op. So reconcile is safe **by accident of its call shape**, not by design. A future caller asking `--state all` through that path inherits the race. Worth naming.

### Finding 3 (blocking): three concurrent calls break the board's concurrency accounting in two independent places

**(a) The slot gate.** `fleet.ts:2476` wraps the `pr-list` call in `withHostSlot`, which takes **one** slot (`:1867-1900`). The bound comes from `concurrencyBound`, derived by `boundFromLimit` (`concurrency.ts:138-143`) from `SECONDS_PER_SLOT = 4`:

> A limit is requests per hour; a concurrency bound is requests at one moment. … At 4 seconds a call, an account allowed `limit` calls an hour can sustain `limit / (3600 / 4)` of them simultaneously

One slot is modelled as **one in-flight request**. Today one slot covers three *sequential* `bb` round trips, which honours that model. After this plan one slot covers **three simultaneous** in-flight requests, so on Bitbucket the real concurrency against the account is `3 × bound` while the gate still counts `bound`. The gate exists precisely because an account-wide `HTTP 429` was measured (`fleet.ts:173-175`), and this silently triples the number it was tuned against.

**(b) The slot duration.** `SECONDS_PER_SLOT = 4` is the assumed call length. On this repo the measured single-state times are 5.4/15.1/23.0 s. That assumption is already wrong and the plan does not make it worse — but it means the derived bound is already optimistic, so tripling on top of it is not absorbed by headroom.

The plan asks nothing about either. **Amendment**: state whether the three calls take one slot or three, and if one, say why.

*Note in the plan's favour*: `PR_REQUESTS_PER_REFRESH.bitbucket = 4` (`fleet.ts:193`) counts *requests per refresh* for the **hourly** cadence, not concurrency. Three concurrent calls still cost three requests, so `prRefreshMsFor` stays correct and the hourly spend does not change. That half of the accounting survives. Only the *at one moment* half breaks.

### Finding 4: a claim with no measurement behind it

> `pr_list_states` already collects results per state before classifying. (`:40-41`)

It does not "collect". `:628` **streams** each state's rows to stdout inside the loop, immediately after that state's jq. There is no per-state buffer on the stdout side; the only spool is stderr (`:601`). This matters because the plan rests its low-risk framing on a collection step that isn't there — concurrency requires *adding* buffering, not reordering an existing collection. Line-level correction, but the design section reads as though the work is smaller than it is.

### Finding 5: interleaved partial writes are unaddressed

`:628` is `printf … | jq -c …`. Three concurrent `jq` processes writing to one pipe: writes under `PIPE_BUF` (4096 on Linux, 512 POSIX minimum) are atomic, but a `--rich` PR row with a long title and `failing_checks` can exceed that. A torn line reaches `fleet.ts:2502` `JSON.parse(line)` **unguarded** — it throws, is caught at `:2582`, and the whole refresh degrades to `prError`, keeping the last good map. So the failure mode is *the board silently stops updating PRs*, which is #912's symptom by a new route. The plan's Done-when ("every row that the sequential form emitted is still emitted, pinned by comparing sorted output") would pass against a stub whose rows are short and never catch this. **Amendment**: buffer per state, or pin the row-length case.

### What is right

- The cost analysis is measured, dated, and names the repository.
- The `47 s is this repository at this moment` note (`:104-108`) correctly refuses to bake a number into the Done-when.
- `What must not change` correctly identifies the partial classification as load-bearing, and the `--state all`-is-one-call GitHub carve-out matches `host.test.mjs:1131`.
- The stdout-order claim is correct, verified against all seven consumers above.

---

## Plan 2 — `a-capped-page-says-what-it-hid`

No consumer breaks. On my lens this is `proceed`, with two notes.

### The board banner effect is real and the plan does not name it

`pr_list_report_truncation` (`plot-host.sh:2020-2032`) is a bare `echo … >&2` returning 0. It never touches the exit code. So on exit 0, `hostSaid` returns `{answer:'answered', stdout}` with **no `said` field** (`scripts-shell.ts:89`) and the warning reaches nothing — `prError` is untouched.

The warning reaches the board on **exit 7 only**: `fleet.ts:2496` `partialSaid = said.said` where `said` is `run.stderr.trim()` — the *whole* stderr (`scripts-shell.ts:90`) — and `:2580` sets `entry.prError = partialSaid`. `prNote` (`host-notes.ts:370`) then renders `PR data unavailable (${fleet.prError})`, whole string.

So today, on a Bitbucket partial answer, the banner reads the truncation warnings **concatenated with** the missing-states sentence. The cap plan makes those warnings disappear for under-cap states, so the banner gets shorter and more accurate. **That is the intended effect, not a side effect** — the plan's own framing (*"the board's banner carries a truncation warning for a three-row list that is demonstrably whole"*, `:74-76`) is correct about the mechanism even though it does not name the exit-7 path that carries it. Worth writing down so an implementer does not go hunting for a banner that fires on exit 0.

### The `.list-complete` derivation is untouched, correctly

`plot-fleet-scan.sh:900` and `production.ts:231` both derive completeness from `_pr_rows < PR_LIST_LIMIT` — a **whole-call** test against 1000, which on Bitbucket is satisfied by 66 rows and therefore already claims completeness over a capped page. That is #333's real teeth and the plan explicitly does not fix it (`:80-82`, *"It does not page"*). Correct scope; the plan says so plainly.

### One claim with no measurement

> `bb pr list` can be asked a second time for a **count** it can prove (`:67`)

No command is named and no measurement is given, in a plan whose every other claim carries a measured `bb` invocation (`:31`, `:43`, `:51-53`). The Done-when does not depend on it — it asks only for "the page size read from the measured response" — so it is a stray sentence rather than a load-bearing one. **Delete it or measure it.** As written it implies a second round trip per state, which would undo plan 1's saving and nobody would notice the two plans arguing.

---

## Do the two plans conflict?

**No hard conflict, and a soft one worth an annotation.**

They touch adjacent code: plan 1 rewrites the `pr_list_states` loop (`:600-629`), plan 2 changes the predicate inside `pr_list_report_truncation` (`:2020-2032`), which the loop calls at `:626`. Different functions, no shared line.

Neither plan carries a `waits:` annotation, and I do not think either needs one.

**But the test estate is shared and the order matters for one file.** Plan 2's Done-when says *"a Bitbucket state returning fewer rows than the page size produces no truncation warning, pinned by a test — today a three-row list warns."* Plan 1's Done-when says *"each capped state still produces its own truncation warning naming it."* If plan 2 lands first, plan 1's clause is testing a *narrowed* warning — still satisfiable, but the fixture it must use changes from "any non-empty page" to "a page at the cap". `host.test.mjs:3035-3058` already uses `bbFullPage(50)`, so it survives either way; `:3078-3091` (empty state, no warning) survives both.

**The real coupling is stderr line count, and it runs one way.** Plan 2 *removes* stderr lines. Plan 1 is the plan whose correctness depends on which stderr line is first. Fewer warning lines makes plan 1's race *less* likely to be observed — which is worse, not better: it turns a deterministic test failure into an intermittent one.

**Recommendation**: if both ship, land **plan 1 first**, so its ordering problem is visible against today's noisy stderr rather than masked by plan 2's quieter one. That is an ordering preference, not a dependency, and it is the opposite of what a `waits:` annotation would express — so state it in plan 1's Notes rather than annotating either branch.

---

## Amendments asked for

**`a-pr-list-costs-one-round-trip`** (all four are blocking):

1. Say what happens to **stderr ordering**. Either buffer per state and replay in state order, or amend the Done-when to stop claiming `host.test.mjs:1038` passes unedited — it will not, and the plan's evidence is that test.
2. Say whether stdout rows are **buffered per state** before emission. `:628` streams; concurrent streaming can tear a long `--rich` row into an unguarded `JSON.parse` at `fleet.ts:2502`.
3. Say what three concurrent calls do to **`withHostSlot`**. One slot is modelled as one in-flight request (`concurrency.ts:114-121`); this makes it three on Bitbucket without telling the gate.
4. Correct `:40-41` — `pr_list_states` streams per state, it does not collect.

**`a-capped-page-says-what-it-hid`**:

5. Delete or measure *"can be asked a second time for a count it can prove"* (`:67`).
6. Name the exit-7 path (`fleet.ts:2496` → `:2580` → `host-notes.ts:370`) as the route by which the warning reaches the banner, so the narrowing's board effect is stated as intended rather than discovered.
