# A degraded scan says why, and an empty answer is not an answer

> `pr_source=degraded` today means «no CLI» whatever went wrong. A rate-limited
> API and an uninstalled `gh` produce the same word, and the section that word
> governs then lists every open PR's branch as an orphan.

## Status

- **Phase:** Delivered
- **Type:** bug
- **Sprint:** the-board-serves-an-enterprise-stack
- **Story:** the-board-is-blank-where-it-matters
- **Review:** pr
- **Impl:** own branches
- **Approved:** 2026-08-26, Jan Wloka, in-session
- **Rounds:** 1
- **Delivered:** 2026-08-28

## Changelog

- `/plot-reconcile` distinguishes a failed git-host call from an absent CLI, and
  says which — a rate-limited or unauthenticated API no longer reports as «no
  git-host CLI available».
- The stale-branch section is suppressed rather than printed from unverified
  input when PR state could not be established.

Board impact: none. This touches `skills/plot/scripts/plot-reconcile-scan.sh`
and its output contract, not the plan format, the template, or the layout the
board consumes.

## Motivation

**Measured 2026-08-26** in a Bitbucket repo with ten open PRs
(`quatico/ewz-leg`). The sweep reported:

```
summary: … stale=12 … pr_source=degraded main=develop

== 3. Stale branches ==
  origin/bug/EWZLEG-841-auszug-wiedervorlage — ahead of develop, no open PR → orphan
  origin/docs/ewzleg-841-plan-konsolidierung — ahead of develop, no open PR → orphan
  … ten more
```

**Nine of those twelve had an open PR.** Cross-checked against `bb pr list`:
only three were genuinely without one. The section named nine live PR branches
as orphans, each with an `inspect:` command inviting a look and, one step later,
a deletion.

### The word was wrong, and that is the harder half

```
PR state: DEGRADED — no git-host CLI (gh/bb) available; using git merge-state only.
```

`bb` **was** installed, at `~/.local/bin/bb`, and the repo **is** Bitbucket, so
the `*bitbucket*` arm was taken. Running the script's own command by hand
returned the expected two-column output. The call inside the script returned
nothing, and the reason only surfaces on stderr:

```
$ bb pr list --state open --json </dev/null 2>&1
error: HTTP 429 — Rate limit for this resource has been exceeded
```

The arm is written as `if out=$(… 2>/dev/null | jq …) && [ -n "$out" ]`. A
rate-limited call exits 0 through the pipe with empty output, so the guard falls
through to the fallback, the fallback fails the same way, and `PR_SOURCE` stays
at its initial value — which the reporter renders as *no CLI available*.

**Three failures collapse into one word**: no CLI installed, CLI installed but
unauthenticated, CLI authenticated but the API refused. Only the first matches
what the message says, and only the first is the operator's to fix by
installing something.

### Why this is a truth defect, not a nuisance

This is the enterprise stack failing in the place it is hardest to notice.
`bb` is wired, authenticated and correct; the sweep still reports as though no
Bitbucket support existed. Section 3 admits rows on a predicate — *no open PR* —
that it could not evaluate, and states the conclusion in the same voice it uses
when it could. A reader cannot tell the two apart from the row.

The existing hedge is a sentence above the section («confirm each before
deleting»), which is exactly the shape the board work has been removing: a
caveat in the header, a confident claim in every row. Twelve rows saying
*orphan (needs judgment)* outweigh one line saying *some of these may be wrong*.

### Its sibling, and why this is not the same plan

[[an-unreachable-host-is-not-an-answer]] states the identical principle — *a
host that cannot be reached must not read as a host with nothing to say* — and
was found the same way, on a spent GitHub quota. It is in this sprint's Should
Have, and this plan does not replace it.

They do not touch the same code. That plan is about `plot-host.sh` and the
**board**: a row taking a verdict computed as though the host had answered.
This one is about `plot-reconcile-scan.sh`, which calls `gh`/`bb` **directly**
in `load_open_pr_branches` and never goes through `plot-host.sh` — so a fix
there does not reach it.

The overlap is the lesson, not the code: two independent consumers of git-host
state, two independent renderings of *silence as an answer*. If the sibling
lands first, this plan should adopt whatever vocabulary it settles on for
*unknown* rather than invent a second one.

## Design

### Approach

**1. Tell the three failures apart.** Capture stderr instead of discarding it,
and set a distinct source per outcome:

| Situation | `pr_source` |
| --- | --- |
| CLI absent | `absent` |
| CLI present, call failed (429, 401, network) | `failed` |
| CLI present, call succeeded, zero open PRs | `gh` / `bb` — *not* degraded |

The third row is the one the current code cannot express, and it is not
hypothetical: a repo with no open PRs is indistinguishable from a rate-limited
one today. Both are «empty output, exit 0».

**An empty result must be a value, not a failure.** The guard `[ -n "$out" ]`
treats «no open PRs» as «the call did not work», which is the same category
error one level down.

**2. Suppress section 3 when PR state is unknown.** When `pr_source` is
`absent` or `failed`, print the reason and the count, and withhold the rows:

```
== 3. Stale branches ==
  (not evaluated — PR state unknown: bb exited 1 «HTTP 429 — Rate limit …»)
  12 branches are ahead of develop; whether any is stale cannot be decided
  without the open-PR list. Re-run once the git host answers.
```

Rows that cannot be verified are not printed at all. `--no-pr` keeps today's
behaviour, because a reader who passed that flag asked for the merge-state view
and knows what it costs.

**3. Keep `stale=` honest.** The summary footer reports `stale=0` when the
section was not evaluated, and the reason travels in `pr_source`. A consumer
counting `stale=12` from an unevaluated section is being told a number that was
never measured.

### Both arms, one mechanism — the exit status of the CLI, not the pipe

**Verified 2026-08-26 in `plot-reconcile-scan.sh:203`.** The two arms fail in
*different* ways, and only one of them was measured:

```sh
# bitbucket arm — TWO 2>/dev/null, and a pipe
if out=$(bb pr list --state open --json 2>/dev/null \
           | jq -r '.[] | "\(.id) \(.source.branch.name)"' 2>/dev/null) \
   && [ -n "$out" ]; then
```

Under a pipeline `$?` is **jq's**, not `bb`'s. A 429 makes `bb` fail, `jq` reads
empty input and exits **0**, so `[ -n "$out" ]` is the only thing that notices —
and it fires identically for a repo that genuinely has no open PRs. That is the
measured incident.

```sh
# github arm — NO [ -n "$out" ] guard at all
if out=$(gh pr list -R "$slug" --state open --json number,headRefName \
           --jq '...' 2>/dev/null); then
  PR_SOURCE="gh"; ...
```

`gh` exits 1 on failure, so today the `if` catches it. **The gh arm is correct
by luck of exit codes, not by design**: it has no emptiness guard, so anything
that made that call exit 0 with empty output — a pipe added later, a `--jq`
filter that swallows an error shape — would set `PR_SOURCE="gh"`, claim the host
answered, and print *every* branch as an orphan. Strictly worse than the
Bitbucket failure, and silent.

So the fix is **one mechanism in both arms**: capture stderr, test the CLI's own
exit status rather than the pipeline's (`PIPESTATUS`/`pipefail` or splitting the
call from the parse), and let emptiness be a value.

Fixing only the measured arm would leave one function with two failure
semantics, and would leave the plan's own rule — *an empty result must be a
value, not a failure* — applied to `bb` and not to `gh`.

### The contract: named states, with the CLI's own words beside them

`pr_source` stays a **named state** (`absent | failed | gh | bb`), because the
scan's footer is machine-countable by design and other tooling greps it. The
CLI's first stderr line travels as human-readable detail *beside* the state, not
instead of it:

```
PR state: FAILED — bb exited 1: «HTTP 429 — Rate limit for this resource has
been exceeded». Section 3 not evaluated.
```

**Verbatim passthrough was rejected.** Emitting only the exit code and stderr is
impossible to render misleadingly, but forces every consumer to parse
CLI-specific prose — and the two CLIs word the same failure differently. A named
state that a machine reads plus a reason a human reads gives both readers what
they need.

### No retry, deliberately

A 429 is transient, so one retry would rescue the common case. Rejected:
`/plot-reconcile` is a fast read-only sweep, and a silent retry **hides the rate
limit rather than reporting it** — the operator whose account is being throttled
is exactly the person who needs to know. A sweep that quietly takes twice as
long under throttling has replaced a visible fault with an invisible one.

The measured incident is the argument: the operator's own `bb` calls were failing
too. Reporting the 429 tells them why; retrying past it does not.

## Done when

1. **A rate-limited call reports `failed`, not `absent`.** The measured case:
   `bb` installed, authenticated and correct, the API returning 429.
2. **An absent CLI still reports `absent`** — the only case the current message
   describes, and the only one the operator fixes by installing something.
3. **A successful call returning zero open PRs reports `gh`/`bb`, never
   degraded.** Today indistinguishable from a rate-limited call; both are
   "empty output, exit 0".
4. **Both arms are asserted, not just the measured one.** The gh arm has no
   emptiness guard and survives on exit codes alone; a test that only covers
   `bb` would pass while leaving the worse failure in place.
5. **The CLI's own error text reaches the reader**, beside the state rather than
   instead of it.
6. **Section 3 prints NO rows when PR state is unknown** — it prints the reason
   and the count. Rows that cannot be verified are not printed at all; a caveat
   in the header does not license a confident claim in every row.
7. **`stale=` reports 0 when the section was not evaluated.** A consumer reading
   `stale=12` from an unevaluated section is being handed a number nobody
   measured.
8. **`--no-pr` keeps today's behaviour.** A reader who passed that flag asked
   for the merge-state view and knows what it costs.
9. `pnpm run validate`, `pnpm run test:reconcile` green.

## Branches

### Diagnosis (Branch: bug/a-degraded-scan-says-why, PR: #475)

- `bug/a-degraded-scan-says-why` — tell the three failures apart, suppress the
  unverifiable section, keep `stale=` honest. One branch: the three parts are
  one function and its one reporter, and splitting them would ship a scan that
  knows the difference but still prints the rows.

## Approval

- **Assignee:** Jan Wloka

## Notes

Found while reconciling `quatico/ewz-leg` on 2026-08-26 — a repo with ten open
PRs, where the sweep named nine of them stale. The operator caught it by
cross-checking with `bb pr list` before deleting anything; the point of this
plan is that the cross-check should not have been necessary.

The first diagnosis was wrong and is worth recording: the obvious reading is
«the script only knows `gh`». It knows `bb` — the arm exists, the pattern
matches, the command is right. Believing the obvious reading would have shipped
a fix for a bug that was not there.

### Interrogated 2026-08-26

One round, and it verified the diagnosis against the source rather than
accepting it — the plan's own Notes warn that the obvious reading of this bug
was wrong once already.

The diagnosis holds, and the code showed the failure is **two different bugs**,
not one. The Bitbucket arm pipes `bb` into `jq` with `2>/dev/null` on both, so
`$?` is jq's and a 429 arrives as "empty output, exit 0" — the measured case.
The GitHub arm has **no emptiness guard at all** and is correct only because
`gh` happens to exit 1; anything that made that call exit 0 empty would claim
the host answered and call every branch an orphan. Hence Done-when 4.

Both open questions are settled:

- [x] **Retry a 429?** No. A silent retry hides the rate limit from the one
      person who needs to see it, and the measured incident had the operator's
      own `bb` calls failing too.
- [x] **Named states or verbatim passthrough?** Named — `pr_source` is
      machine-countable by design and other tooling greps it. The CLI's first
      stderr line travels beside the state as human-readable detail, so a
      machine and a reader each get what they need.

The plan also had no `## Done when` section; it now has nine items.

<!-- CHALLENGE-THE-PLAN-METADATA
{
  "round": 1,
  "questionHistory": [
    {
      "q": "Does the diagnosis hold against the source?",
      "a": "Yes, and it is two bugs: the bitbucket arm pipes bb into jq so $? is jq's, while the github arm has no emptiness guard and is correct only because gh exits 1",
      "category": "technical"
    },
    {
      "q": "Retry a 429 before giving up?",
      "a": "No — a silent retry hides the rate limit from the person being throttled",
      "category": "tradeOffs"
    },
    {
      "q": "Named states or verbatim exit code plus stderr?",
      "a": "Named — pr_source is machine-countable and other tooling greps it; the CLI's stderr travels beside it as human-readable detail",
      "category": "technical"
    }
  ],
  "deferredItems": [],
  "categoriesCovered": {
    "technical": { "stack": true, "architecture": true, "implementation": true },
    "domain": false,
    "ux": { "happyPath": false, "edgeCases": true, "errors": true, "accessibility": false },
    "nonFunctional": { "security": false, "performance": false, "scalability": false },
    "tradeOffs": true
  }
}
END-CHALLENGE-THE-PLAN-METADATA -->
