Position: amend
Evidence: executed

# Evidence lens — `a-state-sweep-is-one-request`

The premise is **true**: `bb 1.9.0` takes `--state` repeatedly, in one API call. I executed that check and read `bb`'s source to confirm it.

The plan is still **not safe to build as written**, for three reasons it does not contain. The largest is that collapsing three calls into one **silently truncates the answer** — and it truncates into exactly the "plausible short list" shape this adapter was built to refuse.

---

## 1. The premise survives — with a caveat the plan gets backwards

Executed:

```
$ bb --version
bb 1.9.0

$ bb pr list --help
  --state <state>    Filter by state: open, merged, declined, superseded (default: open)
                     May be repeated to cover several states:
                       --state open --state merged
                     covers both, in one API call. Order does not matter, and a
                     repeated identical state is harmless.
```

The plan quotes this as two lines; the real help is five and says **"in one API call"** — stronger than the plan claimed. So the repeatable form exists and the plan's motivating claim holds.

**But `plot-host.sh:1800-1805` is not an inference — it is a measurement, and the plan never quotes it.** The plan cites only the comment at `:609-612` and calls it "the assumption". The actual decision lives above `bb_states_for`:

```
# `all` becomes SEPARATE CALLS, not repeated flags. `bb` 1.0.0 accepts
# `--state open --state merged` and silently keeps only the last — measured
# 2026-08-18: that pair returned 50 PRs, all MERGED, with the 3 open ones
# gone. No error, a plausible list. One call per state avoids depending on a
# `bb` fix, and the three states partition the set (74 PRs, 74 unique ids,
# 0 duplicates on the repo measured).
```

`git log -S "silently keeps only the last"` → `139f0255 plot-host: speak Bitbucket's --state vocabulary (#210)`.

This changes the plan's story. The Notes say *"the adapter's comment reasons carefully from a true premise to a false conclusion, and `bb pr list --help` refutes it in one line."* That is the wrong diagnosis. The adapter **measured `bb` 1.0.0 dropping states silently**, and chose separate calls specifically to **not depend on a `bb` fix**. The fix arrived; the code did not learn. That is a stale measurement, not faulty reasoning — and the distinction matters, because the original decision anticipated precisely the version-skew risk the plan defers.

The plan is right that the behaviour changed. It is wrong about why the code is as it is, and it credits `--help` with refuting reasoning that was actually a measurement.

## 2. The deferred question — answered now, no API calls made

The plan says *"the slice must confirm this rather than assume it."* It is answerable by reading, because `bb` is a **shell script**, not a binary:

```
$ file $(which bb)
/Users/jwloka/.local/bin/bb: POSIX shell script text executable
```

That is a wrapper; the real script is `~/.claude/plugins/cache/quatico-marketplace/working-with-bitbucket-api/1.9.0/bin/bb` (2673 lines). Its query builder:

```sh
bb_pr_list_query() {
  if [[ -z "$authors" ]]; then
    # No author: repeated state= parameters. Bitbucket returns the union,
    # already sorted descending by updated_on — one call, nothing to re-sort.
    path=""
    for s in $states; do
      path="${path}${path:+&}state=${s}"
    done
```

**Answer: a partial is unreachable.** Repeated `--state` builds ONE URL with repeated `state=` params, and Bitbucket returns the union server-side. There is no client-side fan-out, so there is no per-state outcome that could differ. One request succeeds or fails whole.

**So the plan's trade is sound and `PR_LIST_PARTIAL_RC` becomes unreachable on this path.** I made **zero** Bitbucket API calls to establish this.

## 3. THE DEFECT — the union is capped at 50 total, not 50 per state

This is the finding, and the plan contains nothing about it.

`bb pr list` calls `bb_paginate "$path"` (`bin/bb:832`) **with no limit argument**. The default:

```sh
bb_paginate() {
  local path="$1"; shift
  local limit="${1:-50}"
  ...
    count="$(echo "$all" | jq 'length')"
    if [[ "$count" -ge "$limit" ]]; then
      all="$(echo "$all" | jq --argjson l "$limit" '.[:$l]')"
      break
```

Today, three calls → **50 open + 50 merged + 50 declined = up to 150 rows**, and each state gets its own budget.
After the change, one call → **50 rows total**, drawn from a union **"sorted descending by updated_on"**.

On any repository whose recent activity is merge-heavy — which is every mature repo, and `plot-host.sh:3705` records `quatico/quaweb-website` at **902 PRs, 886 of them MERGED** — the 50 newest updated PRs are overwhelmingly MERGED. **Open PRs get crowded out entirely.**

That is byte-for-byte the failure mode the 2026-08-18 measurement recorded: *"returned 50 PRs, all MERGED, with the 3 open ones gone. No error, a plausible list."* The plan would reintroduce it by a different mechanism — not a `bb` bug this time, but a shared pagination budget.

**The Done-when cannot catch it.** It says *"The payload is identical to today's three-call result for the same repository, asserted by diffing the output."* Against a stub, or any repo under 50 PRs, the diff passes. The divergence only appears above the cap — which is exactly where the plan's own cited motivation (902 PRs) lives.

**There is a second loss in the same place.** `pr_list_states` runs per-state truncation detection:

```sh
[ -n "$PR_LIST_BRANCHES" ] || pr_list_report_truncation "$backend" "$limit" "$_s" \
  "$(jq 'length' <<<"$_raw" 2>/dev/null || echo 0)"
```

One call means one truncation check over a union, so the adapter loses the ability to say *which* state was short. The adapter warns about this exact hazard 30 lines up (`:3717`): *"dropping it silently would serve a short page as if it were the whole set — the quiet wrong answer this adapter refuses elsewhere."*

**The slice must either pass an explicit limit to survive the cap, or the plan must state the truncation trade it is accepting.** As written it accepts it without noticing.

## 4. Question checks

**The three call sites (`:3774`, `:3800`, `:3806`) — TRUE.** All three are `pr_list_states bitbucket "$limit" "$bb_states" <jq>`, differing only in the jq program and `PR_LIST_JQ_ARGS`. The plan is right that they need no edit.

**`PR_LIST_PARTIAL_RC=7` is well tested.** `test/reconcile/host.test.mjs:1040-1144` — four tests: partial keeps answering states and exits 7; total outage keeps 3/5/6 by kind; single state can never be partial; GitHub's single call cannot produce 7. `plot-fleet-scan.sh:675` reads rc 7 directly. Since the single call cannot be partial, these keep passing with the loop gone (the single-state test already covers the new shape) — but the *Bitbucket multi-state* partial test becomes unreachable and must be deliberately retired, not left passing against a stub that no longer models reality.

**The version caveat — precedent exists, and the plan understates the risk.** `plot-host.sh` already version-checks: `BB_ISSUE_VERSION="0.6.0"` with a hard refusal (`:1887`), and `bb_require_json`/`bb_identify` (`:1923-2021`) probe capability **behaviourally via `--help`** rather than by version number. The reason is recorded at `:1896`:

> `TWO TOOLS SHARE THE NAME bb.` craftamap/bb is a Go binary that does NOT support `--json` … their version numbers name different products: craftamap 0.6.0 is not "older than" Quatico 1.0.0 — they are unrelated.

So "an older `bb` may not have it" is the wrong frame — it may be a **different `bb`**. The precedent is unambiguous: **probe the capability, don't compare versions**, and cache it as `BB_CAP_*` does. `bb_require_json` already runs on this exact path (`:3727`), so the probe point exists. The plan should say "detect, following `bb_require_json`" rather than leaving detect-or-require open.

**The cost claim — real, and I traced it.** `plot-fleet-scan.sh:895` calls `pr-list --state all --limit "$PR_LIST_LIMIT"`; `pr_list_verdict` maps the rc to `ok|partial|throttled|secondary|failed`, and `:894` returns early on anything but `ok|partial`, so branches fall back to local evidence and are not offered to `--next`. `packages/board/src/server/fleet.ts:2861` issues the same call on the board's PR timer. **Not inferred — the path is as the plan describes.** `--state all` has real callers (`plot-open-pr.sh:138`, `plot-reconcile-scan.sh`, fleet scan, board), so the saving is not zero.

Note the cost saving is smaller than headline: `plot-fleet-scan.sh:894` makes a **separate `--state open --rich` call first**, so a Bitbucket sweep is 1 + 3 = 4 requests, going to 1 + 1 = 2. A 50% cut, not 67%.

## Against my own position

The strongest case for **proceed**: the premise is verified true, the partial question I was asked to press is now answered (unreachable) and answers in the plan's favour, the three call sites are untouched as claimed, and the cost path is real. The pagination defect is a slice-level implementation detail — pass `--limit` through and it evaporates — and Plot's norm is that slices discover such things. On that reading the plan is directionally correct and my objection is an implementation note.

The strongest case for **reject**: the plan's Notes diagnose the existing code as reasoning from a true premise to a false conclusion, when the code in fact recorded a measurement and deliberately chose not to depend on a `bb` fix. A plan whose stated lesson — *"check what the tool says before inferring what it cannot do"* — misreads the very comment it is correcting has not understood what it is changing.

I land on **amend** because the defect is concrete, cheap to fix, and invisible to the plan's own Done-when. It is not a reason to abandon the change; it is a reason not to build it as specified.

## What the amendment must add

1. **State the pagination cap.** One call shares one 50-row budget across three states, where three calls had 50 each. Either pass an explicit limit to `bb_paginate` or record the truncation as an accepted trade — but do not let a diff against a small stub certify it.
2. **Strengthen the Done-when.** The payload-identical assertion must be made against a fixture with **more than 50 PRs, merge-heavy**, or it cannot fail in the only regime that matters.
3. **Say "detect", and name the precedent.** Follow `bb_require_json`/`bb_identify`: probe `--help` behaviourally and cache. Two products share the name `bb`; a version comparison is the wrong instrument.
4. **Correct the Notes.** `:1800-1805` is a 2026-08-18 measurement against `bb` 1.0.0, not an inference. The defect is a stale measurement nobody revisited when `bb` was fixed — a different lesson, and a more useful one.
5. **Record that the partial question is already answered** (union built server-side, `bin/bb:446-460`), so the slice retires the Bitbucket multi-state partial test deliberately rather than leaving it passing against a stub.

**API calls made to Bitbucket: zero.** Every finding comes from `bb --help`, `bb --version`, `bb`'s own source, `plot-host.sh`, `plot-fleet-scan.sh`, the test suite and `git log`.
