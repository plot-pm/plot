# Concurrency — juror verdict

Position: reject
concurrency: reject

Subject: `docs/plans/2026-09-20-a-pr-list-costs-one-round-trip.md`
Lens: concurrency — is `pr_list_states`' loop safe to run as three background jobs in bash, and what breaks.

Reject rather than amend, because the plan's central premise — *"the board pays 47 s on every PR refresh"* — is measured against a refresh path that already stretched itself for this exact cost, and the remedy it proposes fights the mechanism that stretch exists to protect. Three of the five findings below are amendable engineering defects. Findings 1 and 5 are not: one says the latency being bought is not on any critical path, and the other says the purchase is charged against a limit that has already taken this estate's Bitbucket account down account-wide once.

---

## 1. The board already fixed this, by stretching the cadence — and the plan's own framing is what the fix refutes

The plan's motivation (line 3) is *"a list the board refreshes on a timer"* and (line 32) *"the board pays it on every PR refresh."* Both are true only of a naive timer. The board's is not naive. `packages/board/src/server/fleet.ts:184-193`:

```ts
const PR_REQUESTS_PER_REFRESH: Record<string, number> = {
  github: 1,
  // Three for `pr-list --state all` (open, merged, declined — `bb` has no `all`
  // state) plus one for `issue-list`, which now reaches the network instead of
  // exiting 4. Do not "fix" the three by inventing an `all` — it would fabricate
  // an answer the host cannot give.
  bitbucket: 4,
};
```

and `fleet.ts:162-169`:

```
 * cadence did not stretch. `prRefreshMsFor` multiplies `PR_REFRESH_MS` by it,
 * so the hourly spend stays 60 on both hosts; the higher a host's per-refresh
 * cost, the further apart its refreshes.
 *     GitHub      1 request  → refresh every  60 s → 60 requests / hour
 *     Bitbucket   4 requests → refresh every 240 s → 60 requests / hour
```

**The Bitbucket refresh interval is 240 s and the call takes 47 s.** The call is not on the critical path of anything — it occupies 20 % of its own window and the next refresh is not waiting on it. Nothing in the plan identifies a reader who is blocked for 47 s. The board is a background poller; the operator reads the last completed pulse, not the in-flight one.

The plan's own Notes section (lines 93-102) records the symptom that actually hurts — **0 of 5 rows carrying a PR, `prAgeSeconds: null`, eight hypotheses refuted** — and then explicitly disclaims it (lines 65-67): *"Not a fix for the board's PR data."* So the plan concedes it does not fix the defect anybody noticed, and proposes to optimise a latency nobody waits on. That is the whole case against it, before a single line of bash is written.

## 2. The partial classification cannot survive `&` without being rebuilt — the plan calls this "must not change" and does not say how

`skills/plot/scripts/plot-host.sh:599` declares the state the plan promises to keep:

```bash
local _s _raw _rc _err _tmp _ok=0 _failed=0 _first_rc=0 _failed_states=""
```

Every one of these is mutated inside the loop body (`:619-621`, `:625`) and read after it (`:630-638`) to choose between `return 0`, `return "$_first_rc"` and `return "$PR_LIST_PARTIAL_RC"`. Moving the body into `( … ) &` puts each mutation in a subshell. Measured, `t2_counters.sh`:

```
  inside child open: ok=1 failed=0
  inside child merged: ok=0 failed=1
  inside child declined: ok=1 failed=0
AFTER: _ok=0 _failed=0 _first_rc=0 _failed_states=''
```

**All four counters read zero in the parent.** `_ok=0` with `_failed=0` means `[ -z "$_failed_states" ]` at `:630` is true and the function returns **0** — a complete reading reported over a page that may be missing two whole states. That is precisely what the header at `:546-552` forbids:

> NON-ZERO IS THE LOAD-BEARING PART. `plot-fleet-scan.sh:675` reads this code DIRECTLY, not through the transport, and branches on `rc -ne 0`. Exiting 0 on a partial answer would set `HOST_VERDICT=ok` over a page missing a whole state […] It would also re-create precisely the state fixed on 2026-08-30, when `pr-list` swallowed its own failure and exited 0 with empty stdout.

The plan names this risk at lines 47-51 and says only *"Concurrency must feed the same counters."* It never says through what. The answer is per-child status files plus a post-`wait` reduction pass — a rewrite of the classification, not a preservation of it, and the plan budgets nothing for it. `_first_rc` is worse than a counter: `:620` means *the first failure in state order*, and under concurrency "first" becomes arrival order. `host.test.mjs:1081` asserts a total outage exits **5 for a quota message, 6 for a secondary one, 3 for DNS** — with mixed failure kinds arriving in racing order, which code `_first_rc` holds is nondeterministic.

## 3. `pr_list_call`'s temp file has no state suffix, and three concurrent children share one `$$`

`plot-host.sh:526`:

```bash
pr_list_call() { # "$@"=the host command → payload on stdout, or dies
  local out rc err tmp="/tmp/plot-host-prlist-err.$$"
```

`$$` in a bash background subshell is the **parent's** pid, not the child's. Measured, `t1_dollardollar.sh`:

```
parent $$ = 84044
child 1: $$ = 84044  BASHPID = 84045
child 2: $$ = 84044  BASHPID = 84046
child 3: $$ = 84044  BASHPID = 84047
```

So all three children compute the **identical path** and each runs `rm -f "$tmp"` on it. Measured, `t3_tmpfile.sh`:

```
state=open read-back-err='ERR-FROM-open'
state=declined read-back-err=''
state=merged read-back-err=''
```

**Two of three states lost their error text entirely** to a sibling's `rm`. That text is the sole input to `pr_list_failed`, whose `host_failure_kind` (`:410-418`) reads it to choose between exit 5, 6 and 3. An emptied buffer falls through both regexes to `failed` → **exit 3**, so a secondary rate-limit refusal is reported as an outage needing `bb auth login`. That inverts the distinction `die6`'s 22-line header (`:365-386`) was written to establish:

> A caller told only *throttled* counsels one when it means the other: it waits minutes for a limit that cleared, or it retries in seconds into a bucket that is empty.

The per-state file at `:601` (`…-state-err.$$.$_s`) *is* suffixed and survives. The unsuffixed one inside `pr_list_call` is the collision, and the plan never mentions it because it reads the loop and not the function the loop calls.

## 4. Output tears mid-line at this repository's real row size — the plan checks the wrong property

The plan, lines 53-57: *"Every consumer parses line-delimited JSON and joins by branch, so order is irrelevant — but a test should pin that it is."* Order is indeed irrelevant. **Atomicity is not, and the plan does not raise it.**

`getconf PIPE_BUF /` on this machine returns **512**. Writes above it are not atomic, and `jq -c` block-buffers rather than emitting one `write()` per line. With three real `jq` processes producing rows of this repo's own shape and size — median **259 bytes**, measured from `plot-host.sh pr-list --state merged --limit 30 --rich`:

```
run 1: lines=300 torn=4
run 2: lines=300 torn=4
run 3: lines=300 torn=4
run 4: lines=300 torn=4
run 5: lines=300 torn=2
```

A sample torn line:

```
{"number":63,"{"number":0,"title":"a plan that does a thing on the estate", …
```

**The line count stays correct at 300 while the content is spliced.** A consumer counting rows sees no problem; one parsing them gets a JSON error on a row that names two PRs. Larger payloads make it near-total — 259 of 300 torn at 2 KB rows, 299 of 300 at 65 KB — and `--rich` rows carrying a long title plus a populated `failing_checks` array reach that range easily.

This is unfixable by "pinning that order does not matter". It requires each child's stdout collected to its own file and concatenated after `wait`, which discards the plan's stated benefit of *"collecting as they return"* (line 41).

## 5. Three at once is what `die6` exists to report, and this estate has already been refused account-wide

The plan never uses the words *rate limit*. `plot-host.sh:365-368` does:

> Exit 6 — the host refused because too many calls arrived AT ONCE. A secondary limit, and a different ceiling from the one exit 5 reports. […] A secondary limit clears in seconds, carries no reset, and the reaction is to **retry shortly and lower concurrency**.

The plan proposes to *raise* concurrency on the one backend that reaches this code path. Both measured incidents in this file are burst-shaped — `:379-383`, *"2026-08-27, eight workers against a cap of seven produced a 403 naming abuse detection"* — and `fleet.ts:171-178` records the Bitbucket one:

> A board left open a working day made ~1400 Bitbucket requests just watching, and reached `HTTP 429 — Rate limit for this resource has been exceeded` **account-wide, with every `bb` call from the operator's own shell failing too**.

The existing guard against this is `host_slot_take`/`host_slot_give` (`:2516-2547`), which the `bb()` wrapper at `:2557` calls on every invocation. It does not help here, for two independent reasons I measured:

**(a) Bitbucket is unbounded today.** `host_concurrency_bound` (`:2485-2497`) requires `basis` to be `actual` or `predicted`. Measured:

```
bitbucket budget_rate: {"spent":0,…,"limit":null,…,"basis":"unknown"}
```

`unknown` → `return 1` → `host_slot_take` returns 0 having taken nothing. Nothing throttles the burst. The plan's three simultaneous calls go straight out.

**(b) When a bound does exist, backgrounding corrupts it.** `budget_slot_release` (`plot-budget.sh:426-437`) guards on pid identity, documented at `:426-428`:

> Removes only THIS process's own claim: a slot reclaimed as stale while its owner still ran belongs to somebody else now, and unlinking it on the way out would let the cap be exceeded by one.

The guard is `[ "$pid" = "$$" ]`. Three background subshells share one `$$`, so the guard cannot distinguish them. Measured, `t11_slot_crosstalk.sh`:

```
slot 0 held by pid 80059 (sibling A, still running)
sibling B (BASHPID=80065) released slot 0 -- guard passed because $$=80059 matches
--- is sibling A's live slot still held? ---
  NO -- a LIVE sibling's slot was unlinked; the cap can now be exceeded
```

**A child can release a live sibling's slot**, which is the exact "cap exceeded by one" the comment forbids. Fixing it means `$BASHPID` throughout `plot-budget.sh` — a change to the shared budget substrate that the plan does not scope and that affects `gh` and `jen` equally.

## 6. The Done-when's own evidence fails — `host.test.mjs:1038` cannot pass unedited

The plan (lines 83-86) makes an unedited pass of `test/reconcile/host.test.mjs:1038` its proof:

> pinned by the existing tests at `test/reconcile/host.test.mjs:1038` and `:1081` **without editing them**, since they already pin exactly this and a passing unchanged test is the evidence.

That test asserts on the **first line** of stderr (`host.test.mjs:1074-1077`):

```js
const firstLine = r.stderr.trim().split('\n')[0];
assert.match(firstLine, /rate limit/i,
  'the host’s reason was buried under this helper’s own bookkeeping');
```

Sequentially this holds by construction: `open` and `merged` succeed silently, so the only stderr is `declined`'s reason. Concurrently, whichever child writes first wins. Under the plan's **own measured profile** (open 5.4 s, merged 23.0 s, declined 15.1 s, lines 23-28) the fast `open` state emits its truncation warning ~10 s before the failure text arrives. Simulated at 1/1000 scale, `t8_real_profile.sh`, 10 runs:

```
host.test.mjs:1038 first-stderr-line assertion under the MEASURED timing profile:
  PASS=0  FAIL=10  (of 10)

first line on a sample run:
plot-host: pr-list: bitbucket returned exactly 50 rows for state 'open' — the list is capped
```

**Zero of ten.** The plan's nominated evidence disproves the plan. And the requirement it encodes is real, not incidental — `plot-host.sh:609-617` records that `plot-reconcile-scan.sh` reads the first stderr line into its error field, and that the contract suite caught an earlier draft burying the reason. Preserving it under concurrency means buffering every child's stderr and emitting it in a deterministic order after `wait`, which again removes "collect as they return".

---

## What I could not refute

The latency measurement itself looks sound, and the asymmetry is real: `bb` has no `all` state (`plot-host.sh:557-560`), GitHub takes one call, and the three states are genuinely independent — none reads another's output. If the 47 s were on a critical path, concurrency would be the right shape. Finding 1 is that it is not.

## The cheaper alternative the plan did not consider

The plan asks (implicitly) for all three states on every refresh. The states have very different volatility: `open` is 3 rows and 5.4 s, while `merged` (50 rows, 23.0 s) and `declined` (13 rows, 15.1 s) are near-static — a merged PR does not un-merge. Asking `open` on the frequent timer and the terminal states rarely cuts both the latency *and* the request count, needs no subshells, keeps every counter in one process, and moves the cadence in the direction `fleet.ts:171-178` was burned into the file to protect. It also composes with the 240 s stretch rather than against it. If the latency is genuinely worth attacking, this is the shape to cost first — and it is a change to the board's refresh policy, not to `plot-host.sh` at all.

## What would change my position

Evidence that a *person or a gate* waits on those 47 s — not a background poller with a 240 s window. Absent that, this spends rewrite risk across `plot-host.sh` and `plot-budget.sh`, against a secondary limit with a recorded account-wide outage, to speed up something nothing waits for, while the defect the plan itself documents in its Notes (0 of 5 rows carrying a PR, eight hypotheses refuted) stays unexplained.
