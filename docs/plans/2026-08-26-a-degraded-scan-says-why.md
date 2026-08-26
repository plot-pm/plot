# A degraded scan says why, and an empty answer is not an answer

> `pr_source=degraded` today means «no CLI» whatever went wrong. A rate-limited
> API and an uninstalled `gh` produce the same word, and the section that word
> governs then lists every open PR's branch as an orphan.

## Status

- **Phase:** Draft
- **Type:** bug
- **Sprint:** the-board-serves-an-enterprise-stack
- **Story:** the-board-is-blank-where-it-matters
- **Review:** pr
- **Impl:** own branches

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

### Open Questions

- [ ] Should `failed` be retried once before giving up? A 429 is transient by
      definition. Argues for: a single retry costs one call and rescues the
      common case. Argues against: `/plot-reconcile` is read-only and fast, and
      a retry loop hides the rate limit rather than reporting it.
- [ ] Is `absent` vs `failed` the right split, or should the exit code and the
      first stderr line simply be passed through verbatim? Verbatim is harder to
      consume programmatically but impossible to render misleadingly.

## Branches

### Diagnosis

- `bug/a-degraded-scan-says-why` — tell the three failures apart, suppress the
  unverifiable section, keep `stale=` honest. One branch: the three parts are
  one function and its one reporter, and splitting them would ship a scan that
  knows the difference but still prints the rows.

## Notes

Found while reconciling `quatico/ewz-leg` on 2026-08-26 — a repo with ten open
PRs, where the sweep named nine of them stale. The operator caught it by
cross-checking with `bb pr list` before deleting anything; the point of this
plan is that the cross-check should not have been necessary.

The first diagnosis was wrong and is worth recording: the obvious reading is
«the script only knows `gh`». It knows `bb` — the arm exists, the pattern
matches, the command is right. Believing the obvious reading would have shipped
a fix for a bug that was not there.
