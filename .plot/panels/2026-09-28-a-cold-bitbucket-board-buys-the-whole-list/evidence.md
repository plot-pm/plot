Position: amend
Evidence: executed

# The premise is true of `bb pr list` and false of Bitbucket. The plan's three options omit the one that wins.

Two Bitbucket API calls made, both read-only, both `GET`. No write touched any host.

## 1. The central claim, verified — and it is the wrong subject

The plan's premise is literally true, and I confirmed it:

```
$ bb --version
bb 1.9.0
$ bb pr list --help
USAGE
  bb pr list [--state <state>] [--author <name>] [--json [<fields>]] [--jq <expr>]
```

Four flags, no query flag. The full list is as the plan says, so `bb pr list` genuinely cannot carry `updated_on`.

**But the limitation is the SUBCOMMAND's, not the CLI's, and not Bitbucket's.** `bb`'s own listing already builds a `q=` URL — `bin/bb:445` `bb_pr_list_query`, which the plan does not cite:

```sh
  # An author forces the q= form, so the states must travel inside it too.
  ors=""
  for s in $states; do
    ors="${ors:+$ors OR }state = \"${s}\""
  done
  expr="(${ors})"
  ...
  printf '?q=%s' "$(printf '%s' "$expr" | jq -sRr @uri)"
```

`bb pr list --author X` reaches `q=` today. The `q=` path is one `if` away, in the same function the listing already calls (`bin/bb:829`). And `bb api` is a **documented escape hatch** for exactly this (`bin/bb:2299-2331`, *"Escape hatch for API endpoints not yet wrapped by bb commands"*) — which Plot ALREADY USES for the windowed query at `plot-host.sh:802`:

```sh
  _path="/repositories/{ws}/{repo}/pullrequests?q=${_q}&pagelen=50"
  _out="$(bb "$@" api "$_path")" || return $?
```

So the plan's own quoted adapter comment — *"the only Bitbucket path that can carry `updated_on` is `bb_branch_query`'s own REST `q=`"* (`plot-host.sh:3744-3745`) — is **false as written**. That is not the only path; it is the only path *that exists today*, and the reason is that `bb_branch_query` hardcodes `source.branch.name` into its filter. Remove that one clause and the same code is a windowed bulk listing.

## 2. Option 4, executed — and it dominates all three the plan offers

I ran the query the plan's design section never considers: `q=` with a window and **no branch clause**, against the exact repository the plan cites (`plot-host.sh:3705`, `quatico/quaweb-website`, 902 PRs / 886 MERGED).

```
$ bb -R quatico/quaweb-website api \
  '/repositories/{ws}/{repo}/pullrequests?q=state%3D%22MERGED%22%20AND%20updated_on%3E%3D%222026-09-20T00%3A00%3A00%2B00%3A00%22&pagelen=50'
{
  "size": 9,
  "page": 1,
  "pagelen": 50,
  "returned": 9,
  "oldest": "2026-09-20T17:46:03.675330+00:00",
  "newest": "2026-09-23T17:53:36.794548+00:00"
}
```

Baseline, second and last call:

```
$ bb -R quatico/quaweb-website api '/repositories/{ws}/{repo}/pullrequests?state=MERGED&pagelen=1'
{ "size": 895, "pagelen": 1 }
```

**One request. 9 rows out of 895.** `size: 9` is the server's own count of matches, not a page length — so this is not a truncated page and the plan's entire pagination hazard does not arise: the window did the narrowing, the 50-row budget was never approached.

This is:
- **cheaper than option 1 (sweep)** — 1 call against branches × states, unconditionally, at any working-set size;
- **strictly better than option 2 (keep the full listing)** — same call count, 9 rows instead of 895;
- **not option 3** — option 3 narrows by `--limit` against an unfiltered union sorted by `updated_on`, which is the crowding-out hazard. This narrows **server-side by predicate**, so merged rows outside the window are never in the result set to crowd anything.

**The plan says a windowed Bitbucket listing "has exactly three honest options." It has four, and the fourth makes the other three moot.** Every measurement the plan defers to the slice — the crossover, the pagination interaction, the truncation fixture — is a measurement about options 1 and 3, neither of which anyone should build.

## 3. The deferred crossover, bounded now — it is ~1

The panel brief asks whether the crossover can be bounded by reading. It can, and the answer kills option 1 outright.

- A sweep costs **branches × states** (`plot-host.sh:3765-3766`, `bb_branch_sweep` loops `for _br in $PR_LIST_BRANCHES` at `:864` calling `bb_branch_query` per branch, per state).
- A full listing costs **1 per state** (3 today, 1 if #1049 lands).
- A **windowed bulk listing costs 1 per state** — same as the full listing, proven above.

Against the full listing the crossover is at **branches < 1** once #1049 lands (a sweep of 1 branch × 1 state ties a 1-call listing and returns less). Against option 4 the sweep **never wins at any working-set size**, because option 4 is the same call count with the same narrowing.

So the plan's headline `Done when` — *"the crossover is measured and recorded in the PR: at what working-set size a `bb_branch_sweep` beats a full listing"* — is a measurement of a choice that should not be made. The panel brief's suspicion was right that the deferral hides something; what it hides is that the option being measured is dominated.

## 4. The cost claim is traced, and it is attached to the wrong caller

The plan: *"`plot-fleet-scan.sh:895` calls `pr-list --state all`; `pr_list_verdict` maps the exit … `:894` returns early on anything but `ok|partial`. Branches then fall back to local evidence and are not offered to `--next`."*

The line numbers and the early-return are **correct** (`plot-fleet-scan.sh:895`, verdict at `:898`, `case … *) return 0` at `:902`). But:

**The fleet scan never asks for a window.** Its call is

```sh
  host_err=$("$script_dir/plot-host.sh" pr-list --state all --limit "$PR_LIST_LIMIT" \
         ${_branch_args[@]+"${_branch_args[@]}"} \
```

— `--limit` and branch args, **no `--since`**. `grep -n "since" skills/plot/scripts/plot-fleet-scan.sh` returns only prose comments; the flag appears nowhere. The only caller that passes `--since` is the board (`fleet.ts:2862`, `if (window.since !== null) args.push('--since', window.since)`).

So the plan's cost argument — *"a refusal is a fleet that stops dispatching"* — describes a real hazard, but it is a hazard of the scan's **unwindowed** call, which this plan does not change. The plan's remedy touches only the path the board uses. The scan benefits **only indirectly**, by the board spending less of a shared account budget. That is a real benefit and a much weaker one than the plan's framing, which reads as though narrowing the window stops the fleet stalling. **The cited line is on a path, but not on the path the remedy changes.** This is the brief's "a plan today cited a line whose caller never reaches it" pattern, in a softened form.

## 5. `PR_FULL_READ_MS` — the saving is real but bounded, and the plan overstates the cadence

`fleet.ts:309` `const PR_FULL_READ_MS = 24 * 60 * 60 * 1000;` and `fleet.ts:132` `const PR_REFRESH_MS = 60_000`.

The board refreshes PRs on a **60 s** cadence (stretched further by `prRefreshMsFor`), not "every few seconds" — the brief's premise for question 5 is itself slightly off, and in the plan's favour. Within a 24 h `at`, every one of those refreshes requests a window. So a window IS requested on nearly every pass, and the plan's "every refresh buys the full listing" is fair for the board.

What bounds it: `prWindowFor` (`packages/domain/src/rules/pr-index.ts:158-173`) refuses a window in four cases, and one of them is `complete: false`. On Bitbucket today the `--state all` call fans out per state (#1049's subject) and a partial answer is explicitly tolerated (`fleet.ts:2870-2876`, *"A PARTIAL ANSWER IS NOT A REFUSAL"*). **A partial answer writes `complete: false`, and `prWindowFor` then refuses to narrow against it forever after.** The plan does not mention this, and it matters: on the flakiest estate — the one the plan is for — the store may sit at `complete: false` and no window is ever requested at all. The remedy would then save nothing on exactly the accounts it targets. The plan should state this and say how the store returns to `complete: true`.

## 6. Reproducibility — the `Done when` is partly untestable here, and the plan does not say so

This checkout is GitHub (`origin https://github.com/plot-pm/plot.git`). Nothing in this repository exercises the Bitbucket arm against a live host. `bb` IS authenticated here (`bb auth status` → `Logged in as: Jan Wloka (jwloka)`) and `quatico/quaweb-website` is reachable — which is how I made the two calls above — but that is an operator's credential, not a repository fixture.

Two `Done when` items are therefore not satisfiable by CI in this repo:
- *"at what working-set size a `bb_branch_sweep` beats a full listing, on a repository above the pagination cap. A number, from a run"* — needs a live >50-PR Bitbucket repo.
- *"Per-state truncation detection survives, asserted against a fixture of more than 50 PRs, merge-heavy"* — this one IS fixture-able, and the plan is right to ask for it.

The plan should name which items are CI-gated and which are an operator measurement recorded in the PR. As written it reads as though all six are gates.

## 7. The #1049 interaction — they compose, but the plan's sentence is wrong

`docs/plans/2026-09-28-a-state-sweep-is-one-request.md` collapses three `--state` calls into one repeated-flag call, and its central hazard is that the **50-row budget becomes shared**: 50 per state (up to 150) becomes 50 total over a union sorted by `updated_on`, crowding out open PRs.

The plan under review says: *"Whichever of the two lands second inherits the other's cap."*

**That is false in one direction, and option 4 is why.** With a server-side `updated_on>=` predicate, the union is 9 rows rather than 895 — the shared 50-row budget is no longer a constraint at all. So #1049's hazard is not "inherited"; it is **dissolved** by this plan's remedy if that remedy is option 4. They do not merely compose — **option 4 is the cleanest fix for #1049's own defect.** The two plans should be read together and the ordering argued, not hand-waved with a symmetric sentence that is true of neither.

Conversely, if this plan lands as option 1 (sweep), #1049 is untouched, because a sweep does not use `bb pr list` at all.

## Against my own position

**The strongest case for `proceed`:** the plan's `Done when` does say *"by whichever path the measurement chose"*, and a slice that measures honestly could discover option 4 on its own — the adapter author would be reading `bb_branch_query` anyway, since it is the plan's own cited precedent. The plan is not forbidding option 4; it just failed to enumerate it. That is an argument for amending the Design section, which is what I propose, rather than rejecting.

**The strongest case for `reject`:** the plan's headline `Done when` commits the slice to measuring a crossover for a dominated option, and its premise sentence is quoted from an adapter comment that is false. Three plans this week hid a defect behind a deferral, and this one defers the single question whose answer changes the remedy. A plan whose design section is wrong is usually cheaper to rewrite than to amend.

**Where my own evidence is thin:** I made two API calls against ONE repository. I did not test whether `q=updated_on>=` composes correctly with **multiple repeated states** in one `q=` expression (`bb_pr_list_query` builds `(state = "A" OR state = "B") AND …` for the author case, so the shape exists, but I did not execute it). If Bitbucket's `q=` parser mishandles that conjunction, option 4 costs 1 call per state rather than 1 total — still dominating the sweep, but not dissolving #1049's budget question. **The slice must execute that one query before committing to the claim in section 7.**

I also did not verify that `q=` and `pagelen` interact safely above 50 matches — my window returned 9, below the cap. A window wide enough to match >50 rows still paginates, and `bb_paginate`'s 10-page ceiling (`bin/bb:203`, `"$page" -lt 10`) still applies. The plan's truncation-detection `Done when` survives this amendment and should be kept.

## What I would change

1. **Add option 4 to the Design section and make it the default**: a windowed bulk `q=` listing via `bb api`, the same path `bb_branch_query` already uses, with the `source.branch.name` clause omitted. Executed above: 1 call, 9 of 895 rows.
2. **Drop the crossover `Done when`.** The sweep is dominated at every working-set size. Replace it with: *execute the multi-state `q=` conjunction and record whether one call covers all states.*
3. **Correct the premise sentence** and the adapter comment at `plot-host.sh:3744-3745` it quotes: the limit is `bb pr list`'s, not the CLI's and not Bitbucket's.
4. **Retarget the cost claim.** `plot-fleet-scan.sh` passes no `--since`; only `fleet.ts:2862` does. Say the scan benefits through a shared account budget, not directly.
5. **State the `complete: false` trap** — a partial Bitbucket answer latches the store out of ever being narrowed against.
6. **Split `Done when` into CI gates and operator measurements**, since this checkout is GitHub.
