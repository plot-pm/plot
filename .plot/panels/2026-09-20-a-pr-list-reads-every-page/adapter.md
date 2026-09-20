# Juror: the adapter

Position: amend

Lens: this plan replaces a `bb pr list` call inside `plot-host.sh`'s Bitbucket `pr-list` arm with a REST paging walk. What does that break in the payload contract?

## The decisive question is answered, and it answers FOR the plan

I tried to refute the plan on its own stated risk — *"Not a `--rich` equivalence claim … whether the REST envelope carries the same fields is the slice's first question"* (plan:95-98). The plan presents this as an open question. **It is not open. It is already closed, and closed favourably.** The plan is wrong about its own uncertainty, in the safe direction.

### Measured 2026-09-20, `quatico/quaweb-website`

`bb pr list --state merged --json` and `bb api "/repositories/quatico/quaweb-website/pullrequests?state=MERGED"` return **the same objects**. Both produce the identical 20-key set:

```
author close_source_branch closed_by comment_count created_on description
destination draft id links merge_commit queued reason source state summary
task_count title type updated_on
```

And PR 902, sorted-key normalised, is **byte-identical** between the two sources:

```
$ jq -S -c '.[]|select(.id==902)'     bblist.json > a.json
$ jq -S -c '.values[]|select(.id==902)' rest.json  > b.json
$ diff a.json b.json && echo IDENTICAL
IDENTICAL
```

`bb pr list --json` is `.values` of the REST envelope with the envelope stripped. That is exactly what the plan asserts at :44 (*"returns a bare array — no envelope, no cursor"*) and it is why the adapter cannot page today.

### Against the exact jq shape the arm reads

The Bitbucket `--rich` program at `plot-host.sh:3226-3244` and the plain one at :3252-3254 read these paths:

```
.id  .title  .state  .source.branch.name  .draft  .links.html.href
```

Every one resolves on the REST row:

```
{"number":902,"title":"f: /ki-anwendungen zieht unter /angebote","state":"MERGED",
 "head":"feature/ki-anwendungen-unter-angebote","draft":false,"draft_present":true,
 "url":"https://bitbucket.org/quatico/quaweb-website/pull-requests/902"}
```

`.draft` is **present**, not defaulted — `has("draft") == true`, so the `// false` at :3231 is belt-and-braces rather than load-bearing.

### The `--rich` overlay question dissolves

The plan says `bb pr list --rich` *"overlays check status per PR"* (:95). **It does not.** `plot-host.sh:3254` hardcodes:

```
checks:"unknown", mergeable:"unknown", review:"", failing_checks:[]
```

and the comment above it at :3190-3194 says so explicitly:

> *"Bitbucket carries no check rollup through `bb pr list`, and no mergeability verdict either. Rather than guess, --rich reports checks:"unknown" and mergeable:"unknown""*

So there are **no per-PR extra calls**, and the feared 886 × N cost does not exist. Where checks ARE real they come from the **Jenkins** overlay (`$jmap[.source.branch.name]`, :3227), which is joined from one `jenkins_build_map` call, sits *above* the backend branch, and keys on `.source.branch.name` — a field REST carries identically. **The Jenkins overlay is unaffected by the source of the rows.**

The REST row confirms the absence from the other side: grepping every scalar path for check/merge/review vocabulary returns only `state`, `merge_commit.*` and `links.merge.href` — no rollup exists to lose.

**Verdict on the plan's "first question": the slice should record it as already measured and delete the contingency. There is no field to drop.** That paragraph is the plan describing a risk it does not have, and it should be replaced by the measurement above so the implementer does not re-spend the calls.

## What I found instead — and it is why this is `amend`, not `proceed`

### FINDING 1 (strongest): the plan's success makes `plot-fleet-scan.sh`'s completeness guard fire BACKWARDS

This is not in the plan and it is a live correctness regression.

`plot-fleet-scan.sh:691` calls:

```bash
host_err=$("$script_dir/plot-host.sh" pr-list --state all --limit "$PR_LIST_LIMIT" --rich
```

with `PR_LIST_LIMIT="${PLOT_PR_LIST_LIMIT:-1000}"` (`:623`).

The scan then decides whether it may derive `NONE` from a cache miss, at `:900`:

```bash
if [ "$_pr_rows" -gt 0 ] && [ "$_pr_rows" -lt "$PR_LIST_LIMIT" ] 2>/dev/null; then
  printf '1' > "$HOST_STATE_CACHE/.list-complete" 2>/dev/null || true
fi
```

Its own comment at `:876-882` states the rule the plan quotes approvingly:

> *"a list returned AT the limit is evidence of *at least* that many PRs, never of exactly that many. Deriving absence from a partial list would report a real PR as having none — strictly worse"*

**Now do the arithmetic on the measured repository.** The plan's own table (:36-40) gives `OPEN 3`, `MERGED 886`, `DECLINED 13`. `--state all` expands to those three states (`bb_states_for`, :1434), so a complete walk emits **902 rows**.

- **Today:** 3 + 50 + 13 = **66 rows**. 66 < 1000 → `.list-complete` **is written**. The scan derives `NONE` for 836 branches it never saw. That is #333, correctly diagnosed.
- **After this plan:** **902 rows**. 902 < 1000 → `.list-complete` is **still written**, and now correctly.
- **The trap:** at **1000+ rows** — which this repository reaches at roughly 100 more merged PRs, and which any older repository is already past — the guard sees `_pr_rows == 1000` (or more) and **stops writing `.list-complete`**. Every branch then resolves to `-` (unanswerable) instead of `NONE`.

So a paging walk that returns a **complete** 1000+ row list is read by the scan as **truncated**, because the guard's only completeness signal is *"fewer rows than I asked for"*. The plan makes the list complete and simultaneously removes the scan's ability to *know* it is complete. The envelope's `size` — which the plan correctly identifies as the fix (`:61-63`) and which I measured as `886` — is the fact that would settle it, and **the plan never routes it to the one consumer that needs it.**

The plan says at :104 the arm *"reports the envelope's total"*, but Done-when (:107-119) only requires that total be *"verified against"* in a test. Nothing says where the total goes at runtime, and `pr-list`'s stdout contract is one JSON object per PR — `fleet.ts` casts every stdout line to a `PrRecord` with no discriminator, which is exactly why `pr_list_report_truncation` was forced onto stderr (`:2005-2010`). **So `size` has no channel out today.** That is a design gap the slice must resolve, not a detail.

**Amendment required:** Done-when must name what carries `size`/completeness to `plot-fleet-scan.sh:900`, or must state that `PR_LIST_LIMIT` no longer means what that guard reads it to mean. Shipping the walk without this trades a 94%-invisible list for a fleet that reports `-` on every branch of any repository past 1000 PRs — the outage-shaped failure the same file's comment at `:889-895` warns about from the other side.

### FINDING 2: `pr_list_report_truncation` cannot stay "exactly as it is" AND be correct

The plan insists at :75-81 that the detector is *"correct"* and stays unchanged. Read the rule it actually encodes, `plot-host.sh:1997-2001`:

> *"bitbucket (IGNORES --limit): `bb pr list` has no --limit and cannot report a total or a cursor, so it can NEVER prove completeness for a --limit call. Any non-empty page is therefore possibly truncated."*

The premise — *cannot report a total or a cursor* — is **precisely what this plan falsifies.** After the walk, Bitbucket reports both. The implementation at `:2022-2031` has no bitbucket escape: `[ -n "$limit" ]` and `count > 0` are the only guards, and the GitHub completeness test at `:2026-2029` is inside `if [ "$be" = "github" ]`. So **every complete 902-row Bitbucket answer will still print** *"possibly truncated (902 rows, requested limit 1000 unprovable)"*.

The plan's defence is that this *"costs nothing"* because `grep -rn 'possibly truncated' packages/board/src packages/domain/src` returns zero consumers. **I reproduced that: zero.** So the plan is right that nothing breaks. But it then writes at :77-78 that a *"path that pages completely simply stops being truncated"* — which is **false of the code as written**, and the plan's own "must not change" instruction is what makes it false. Those two sentences contradict each other.

This is smaller than Finding 1 (the output is stderr noise nobody parses), but the slice will hit it on the first manual run and needs to be told which of the two sentences governs. My reading: the detector's *comment* must change even if its *behaviour* does not, because the comment now states a falsehood about the adapter's own capability. `host.test.mjs:3060` pins the no-constant-50 rule and is untouched by fixing the premise.

### FINDING 3: the gate is clear, but `bb api` needs `bb_require_json`'s sibling and has none

**Gate: no violation.** `scripts/check-host-cli-callers.sh:126` lists `skills/plot/scripts/plot-host.sh` in `ALLOWED`, and the gate is a path check (`:19-22`: *"the line itself is the violation: a script outside `plot-host.sh`"*). Adding `bb api` inside the adapter is exactly where such a call belongs.

**Capability probing: a real gap.** The arm calls `bb_require_json` at `:3209` before `bb pr list --json`, because `--json` is per-flag and craftamap/bb 0.6.0 lacks it (`:1530-1536`). **`bb api` is a different subcommand with a different availability**, and `bb_require_json` says nothing about it — it probes `bb pr list --help --json` (`:1665`). A `bb` that supports `--json` but not `api` reaches the walk and fails with `bb`'s own unknown-command error, classified by `host_failure_kind` (`:410`) as `failed` → exit 3 with a `host_repair` login suggestion. **Wrong advice**: the CLI is fine, the subcommand is absent. The slice needs a `bb_require_api` beside `bb_require_json`, or must state why the identity check at `:1643` suffices.

### FINDING 4: mid-walk failure is reachable, and the error shape classifies acceptably

The plan says a page failing mid-walk must make the **state** fail (:86, :113-115). I probed the error contract:

```
$ bb api "/repositories/quatico/no-such-repo-xyz/pullrequests?pagelen=1"
rc=1
stderr: error: HTTP 404 — You may not have access to this repository or it no longer exists...

$ bb api "repositories/quatico/quaweb-website/pullrequests?pagelen=1"   # no leading slash
rc=1
stderr: error: HTTP 403 — Forbidden
```

Non-zero rc, empty stdout, message on **stderr** — the same shape `pr_list_call` (`:525-534`) already handles, and `pr_list_states` (`:606`) already turns a non-zero subshell rc into a failed state with the host's own text passed through unprefixed. **So the plan's requirement is reachable with the existing machinery** provided the walk runs inside one `pr_list_call`-equivalent per state and a mid-walk failure aborts that state rather than returning the pages collected so far. Done-when :113-115 states this correctly.

One caveat the plan should record: `host_failure_kind` matches `\b429\b` for `secondary` and `rate limit` for `throttled` (`:411-413`). Bitbucket's `bb api` message shape is `error: HTTP <code> — <text>`, so an `HTTP 429` **will** match `\b429\b` and classify as `secondary` → exit 6, *"host refused a burst"*. On a **paging walk** that is the likeliest failure of all — 18 sequential calls is exactly what trips a burst limiter — and exit 6's advice (*"Retry shortly, with fewer at a time"*, `:484-485`) happens to be correct. Worth a line in the slice, not a blocker.

### FINDING 5: the leading-slash diagnosis is confirmed, and the `--repo` gap the plan does not mention is already closed

I reproduced the plan's central claim (:48-53). The no-slash call returns **HTTP 403**, the with-slash call returns **rc=0** and the envelope. The predecessor plan's inference was indeed a URL-construction bug, not a scope gap. `bb api --help` documents *"Paths are relative to https://api.bitbucket.org/2.0"*, so `2.0` + `repositories/...` → `2.0repositories/...` exactly as the plan reconstructs.

I also checked the thing the plan **does not** raise and should have: REST needs `owner/repo` in the path where `bb pr list` infers it. `plot-host.sh:1388-1402` records exactly this problem on the GitHub side and leaves it unsolved:

```
# TODO(decision): resolve the repo when `--repo` was not supplied.
gh_rest_repo() {
  if [ ${#repo_args[@]} -gt 0 ]; then echo "${repo_args[1]}"; return 0; fi
  echo "TODO"
}
```

**For Bitbucket this is a non-issue and that is worth recording**, because a reader who knows `gh_rest_repo` will assume it recurs. `bb api --help`:

> `{ws}` Replaced with auto-detected workspace / `{repo}` Replaced with auto-detected repo slug
> *"See `bb --help` for global flags (e.g. -R workspace/repo to target another repo)"*

So `bb api "/repositories/{ws}/{repo}/pullrequests?..."` honours both the auto-detection `bb pr list` uses **and** the existing `repo_args=(-R …)` at `:3006`. The `--repo` pin survives unchanged. The slice should use the `{ws}/{repo}` form rather than interpolating a resolved slug, and should pin that in the test beside the leading slash.

### FINDING 6: ordering is preserved

`bb pr list --state merged --json` returns ids `902,901,900,899,898`; REST page 1 returns `902,901`. Same descending-id order, same source. Nothing in `pr_list_states` depends on order — `:626-628` counts and pipes — and the scan's dedupe at `plot-fleet-scan.sh:856-861` re-sorts by branch and rank explicitly rather than trusting arrival order. **No ordering risk.**

## Summary

The plan's premise is sound and better-supported than the plan knows: I refuted its own stated uncertainty by measuring that REST and `bb pr list` return byte-identical rows, and that `--rich` costs zero extra per-PR calls on Bitbucket because it fills `checks`/`mergeable` with literal `"unknown"`.

What I could not clear is the downstream contract. **The plan completes the list without giving the scan any way to know it is complete**, and `plot-fleet-scan.sh:900`'s `_pr_rows < PR_LIST_LIMIT` test will read a correct 1000-row answer as truncated — the same "derive absence from a partial list" failure the plan quotes that file to justify itself. `size` is the fix, the plan names it, and then never routes it anywhere.

**Amend:** Done-when must (1) name the channel that carries completeness to `plot-fleet-scan.sh:900` — or explicitly retire that guard's reading of `PR_LIST_LIMIT`; (2) replace the "first question" contingency at :95-98 with the measurement above; (3) reconcile the `pr_list_report_truncation` comment, whose stated premise this plan falsifies; and (4) add a `bb api` capability probe beside `bb_require_json`.
