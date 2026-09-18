# A partial page is not an outage

> `bb` has no `--state all`, so the Bitbucket arm loops three states and exits on the first failure — after printing the rows of the states that answered, which the transport then discards.

## Status

- **State:** Delivered
- **Type:** bug
- **Issue:** #912
- **Review:** in-session
- **Impl:** own branches
- **Rounds:** 1
- **Approved:** 2026-09-18, jwloka, in-session
- **Started:** 2026-09-18, jwloka, `bug/the-arm-reports-the-states-that-answered`
- **Delivered:** 2026-09-18

## Changelog

- A Bitbucket `pr-list` that reaches some states and not others reports the PRs it has, rather than answering as a total outage. A repository with three open PRs stops showing nine branches as having no PR.

<!-- Board impact: no plan format, no template, no layout. One adapter arm
     changes what it exits with; the board reads it unchanged. -->

## Design

Reported as #912 by an operator on `quaweb-website`: three open PRs, the Agents
tab shows **nine branches all labelled `commits, no PR ever opened`**, two of
which have live PRs (#358 OPEN, #405 DRAFT). *"A reader cleaning up stale
branches would delete work that is under review."*

### The cause is an asymmetry only Bitbucket has

`bb pr list` has no `all` state, so `bb_states_for all` expands to three
(`open`, `merged`, `declined`) and the arm loops:

```bash
for _s in $bb_states; do
  _bb_raw="$(pr_list_call bb … --state "$_s" --json)" || exit $?
  …
  printf '%s' "$_bb_raw" | jq -c '.[] | {…}'
done
```

Three sites, all identical: `plot-host.sh:3118`, `:3147`, `:3156`.

**The GitHub arm has no state loop at all** — `--state all` is passed through to
`gh` in one call, so a failure there means nothing was printed. On Bitbucket a
failure on state 2 or 3 exits **after** the earlier states' rows are already on
stdout.

### Partial output plus a non-zero exit is a shape the transport cannot carry

`hostSaid` reads the exit code and nothing else
(`adapters/scripts/scripts-shell.ts`):

```ts
if (run.code === 0) return { answer: 'answered', stdout: run.stdout };
…
return run.code === 4 ? { answer: 'unaskable', said } : { answer: 'failed', said };
```

`stdout` travels **only** on `answered`. So every row printed before the failure
is dropped at the boundary, and `fleet.ts` throws
(`if (said.answer !== 'answered') throw new Error(said.said)`).

Demonstrated 2026-09-18 with the arm's exact shape and a stub that throttles on
the third state:

```
exit=5
stdout (rows already emitted):
  ROW: [{"id":358,"state":"OPEN"}]
  ROW: [{"id":300,"state":"MERGED"}]
--> hostSaid sees code=5 => answer='failed', and DISCARDS the 2 rows above
```

`pr_list_failed` exits **5** (throttled), **6** (burst refusal) or **3**
(everything else), and none of those is `4`, so all three become `failed`.

### The board then blanks, because there is nothing to fall back to

`fleet.ts`'s catch keeps the **last good map** by design — *"An empty PR map
would quietly move every row back to its git-only group, which looks like state
changing rather than data missing."* That rule is right and stays.

It has nothing to keep on a first fetch: `prs: null, prsByNumber: null,
prsByHead: null` (`fleet.ts:3046`). So a board started while one Bitbucket state
is throttled shows every branch as having no PR — which is #912's nine rows.

### What was ruled out first, and why it is worth recording

Three hypotheses were checked against the source and refuted before this one:

1. **"The board discards rows it holds."** It does not — the happy path assigns
   the map and the catch keeps the previous one.
2. **"A stderr warning causes the throw."** It does not — on exit 0 `hostSaid`
   returns `{ answer: 'answered', stdout }` with **no `said` field at all**, and
   `entry.prError` has exactly three assignments (`fleet.ts:2551`, `:2563`,
   `:2570`), the banner one inside the `catch`. A warning alone reaches nothing.

   **The measurement first offered for this was invalid and is withdrawn.**
   *"Measured here: exit 0, 925 rows, 0 stderr lines"* was taken on **GitHub**,
   where `pr_list_report_truncation` returns early when `count < limit`
   (`plot-host.sh:1922`). On Bitbucket that function fires for **any** non-empty
   page with a `--limit` — three rows warn exactly as three thousand would. A
   GitHub run could never have tested a Bitbucket-only warning.
3. **"The `hostSaid` refactor already fixed it."** That landed 2026-09-01 and
   #912 was filed 2026-09-15, with that code in place.

### The banner's TEXT is the truncation warning, and that is why everyone misread it

`said` is `run.stderr.trim()` — **every stderr line, joined** — so on a non-zero
exit the message carries the accumulated warnings, not just the failure. On
Bitbucket the truncation warning is emitted for every non-empty state, so the
banner reads:

```
PR data unavailable (plot-host: bitbucket ignores --limit 1000; … possibly truncated …)
```

The exit was caused by a **failed state**; the text describes a **page-size
warning** from the states that succeeded. That is why #912 was filed against
`--limit`, and why this plan's first draft ruled the mechanism out.

**This plan does not change `said`.** Making the message name the failure rather
than the warnings is a second defect with its own blast radius — every
`hostSaid` caller reads that string — and it is recorded here rather than folded
in.

### What this is NOT

**Not #333.** That is real pagination — `bb` caps at 50 per state — and needs a
cursor or a different call. This plan makes *incomplete* distinguishable from
*nothing* and does not page. #912 says so itself: *"the opposite end of the same
code path"*, at **3 PRs, far below any page limit**.

**Not a change to the failure vocabulary for a total failure.** Exits 3/5/6 keep
their meanings and a run where **no** state answered still fails with the same
code.

**An earlier draft said "every backoff caller behaves as today". That was false,
and it was the load-bearing sentence.** `plot-fleet-scan.sh:675` reads the exit
code **directly** — not through `hostSaid` — and branches on 5/6/4. A partial run
exiting **0** would make `rc -ne 0` false, set `HOST_VERDICT=ok`, and report a
**complete** host reading over a page missing a whole state. The scan captures
stderr into `$host_err` and consults it **only inside the `rc -ne 0` branch**, so
the honesty mechanism would be inert at exactly the caller that produced #912.

Worse, `plot-fleet-scan.sh:663` records that this guard *"until 2026-08-30 never
fired, because `pr-list` swallowed its own failure and exited 0 with empty
stdout"*. Exiting 0 on a partial failure re-creates the state that fix removed.

**So a partial answer gets its OWN non-zero code**, which keeps `rc -ne 0` true
for every existing reader while letting the transport be taught to carry stdout
for that one code. `3`, `4`, `5` and `6` are taken; the slice picks a free one
and names it.

**Not a silent success.** A partial answer must say which states are missing, on
stderr, the way the truncation warning already does. The one thing this must not
do is report a short list as complete — the *"quiet wrong answer this adapter
refuses elsewhere"*.

## Slices

### The arm reports the states that answered (Branch: bug/the-arm-reports-the-states-that-answered, PR: #951)

- `bug/the-arm-reports-the-states-that-answered` — collect across the three Bitbucket states, exit with a distinct PARTIAL code, and teach the transport and the scan to read it

**Done when** a Bitbucket `pr-list --state all` whose second or third state fails
**prints the rows of the states that answered and exits with a distinct partial
code**, pinned by a test with a PATH-stubbed `bb` that fails one state; that code
is **not** 0, 3, 4, 5 or 6, so `rc -ne 0` stays true for every existing reader;
`hostSaid` carries **stdout as well as `said`** for that one code, so the rows
survive the transport; **`plot-fleet-scan.sh` learns the verdict** and reports
the answer as incomplete rather than `ok`, pinned by a test over its
`HOST_VERDICT` and its footer's `host=` field — without this the fix is invisible
at the caller that produced #912; the failed state is named on stderr; a run
where **no** state answered exits with the same code it does today — 3, 5 or 6
by kind — pinned per kind; all **three** loop sites are covered
(`:3118` rich+jenkins, `:3147`, `:3156` plain), not just the one the issue hit;
the **GitHub arm is untouched**, pinned by a test that its behaviour is
byte-identical, because it makes one call and cannot reach this shape; a
single-state call (`--state open`) that fails still exits non-zero, since there
is no partial answer to report; and `pnpm run test:contracts` passes.

## Notes

**This repository is on GitHub**, so the Bitbucket path cannot be exercised
live. Test it the way `the-bitbucket-arm-answers-with-a-merge-commit` did — a
PATH-stubbed `bb` over captured payloads — and say in the PR what was exercised
and what was not.

**The issue's own diagnosis was wrong and its report was right.** #912 says *"the
board turns `prError` into `PR data unavailable` and drops rows it already
holds"*. The board holds nothing to drop: the rows were discarded one layer
down, at the transport, because the adapter exited non-zero having printed them.
Every observation in the report reproduces; only the attribution moves.

**Amended 2026-09-18 after a two-lens panel** (`.plot/panels/2026-09-18-a-partial-page-is-not-an-outage/`):
one `amend`, one `reject`, and the two findings together changed the fix rather
than the diagnosis.

**The mechanism survived the reject.** The reporter lens reproduced the banner
text from an exit-0 run and concluded the cause was absent. The reproduction
showed the warning *printed*, not that it reached `prError` — on exit 0
`hostSaid` returns no `said` at all, and the three `entry.prError` assignments
put the banner one inside the `catch`. A non-zero exit is still required. What
that lens found instead is why everyone misdiagnosed this: the banner's TEXT is
the truncation warning, because `said` joins all stderr.

**The fix did not survive the amend.** Exiting 0 on a partial answer would have
made `plot-fleet-scan.sh` report `ok` over an incomplete page — the plan's own
stated red line, violated by its own remedy, at the one caller that produced the
bug. That is now a distinct partial exit code, with the scan bound in the same
slice.

**A second reading this makes available.** Once a partial answer is expressible,
the caller could say *which* states are missing rather than *whether* the answer
is whole. That is not built here — it needs a shape change in `HostAnswer` and a
consumer that wants it, and #912 needs neither.
