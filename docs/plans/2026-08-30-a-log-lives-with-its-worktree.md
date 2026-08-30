# A log lives with its worktree

> Agent logs move into `.worktrees/` with their path resolved in one place instead of 22, the reap rule becomes a domain concept, and the script takes a log with the worktree it belonged to.

## Status

- **Phase:** Approved
- **Type:** infra
- **Sprint:** the-domain-is-one-implementation
- **Issue:** <!-- optional -->
- **Story:** plot-board
- **Review:** in-session
- **Impl:** own branches
- **Approved:** 2026-08-30, Jan Wloka, in-session
- **Started:** <!-- YYYY-MM-DD, who, `branch` -->
- **Delivered:** <!-- YYYY-MM-DD -->
- **Released:** <!-- YYYY-MM-DD, version -->

## Approval

- **Assignee:** Jan Wloka

## Changelog

- Agent logs live under `.worktrees/` beside the checkouts they describe with their path resolved in one place; `reapable.ts` decides which worktrees may be removed and `plot-reap.sh` performs it, taking the log with the worktree.

<!-- Board impact: the log path changes, so the board's log links change with it.
     No payload field is added or removed. -->

## Motivation

**Measured 2026-08-30: 190 log files, 2.6 MB, beside the repository** — 103
`plot-resolve-*`, 78 `plot-dispatch-*`, the rest approve, idea and their
`.state` companions. The oldest was from 2026-08-17. **Not one belonged to
live work**: all five active worktrees had none.

**Nothing has ever removed one.** `plot-reap.sh` removes a worktree and its
registry manifest — in that order, deliberately — but the log beside the repo
survives every reap, so a finished agent leaves a file nobody will ever open
again.

**The location was a considered decision and it is half right.**
`dispatch.ts:145` resolves `path.join(path.resolve(repoRoot, '..'), …)`, and a
log inside the repository would be an untracked file every `git status` reports
and every worktree inherits. **But "not in the repo" was implemented as "in the
parent directory"**, which is a directory Plot does not own — it holds whatever
else the operator keeps beside their checkouts.

**`.worktrees/` is the answer that was not available before.** It arrived with
the `Worktree root` key on 2026-08-30: Plot's own directory, ignored by git,
holding exactly the things a dispatch creates. A log belongs beside the checkout
it describes.

**And the decision is currently made 22 times.** Nine modules —
`dispatch.ts`, `deliver.ts`, `approve.ts`, `idea.ts`, `resolver.ts`,
`reslice.ts`, `implement.ts`, `story.ts`, `commission.ts` — each hard-code
`path.resolve(repoRoot, '..')`. **Moving the logs means editing 22 call sites,
or moving the decision to one.** The second is the same rule this sprint applies
everywhere else.

## Design

### One resolver, nine callers

```
packages/board/src/server/agent-log.ts     where does the log for <kind>/<slug> live
```

Every module asks it. **The `Worktree root` key is already resolved by
`plot-config.sh` and by `plot-dispatch.sh`'s `resolve_wt_root()`** — the
resolver reads the same key, so a project that configured a different root gets
its logs there too, and one that configured none keeps today's behaviour.

**The fallback is the current location, not an error.** A repository with no
`Worktree root` has no `.worktrees/`, and inventing one because a log needs
somewhere to go would create a directory the operator never asked for.

### The reap rule becomes a domain concept, and the script becomes its adapter

**`plot-reap.sh` decides, and deciding is what the domain is for.** Adding a
third thing for it to remove would grow a rule that lives in shell where nothing
can test it — the shape this sprint exists to remove, and the same answer the
changeset rule got.

**Measured 2026-08-30: 286 lines carrying 26 decision markers.** The five
refusals are the reason it exists:

| refusal | measurement |
|---|---|
| a live worker pid | the process table |
| uncommitted changes | the tree |
| a `PLOT-BLOCKED*` marker | the tree |
| sitting on the default branch | the checkout |
| no merged PR | the host |

**Every one is a measurement, and none of them is shell-shaped.** *May this
worktree be removed?* is a lifecycle question of the same family as *is this
plan deliverable* — which already lives in `packages/domain/src/rules/`.

```
packages/domain/src/rules/reapable.ts   may this worktree be removed, and why not
skills/plot/scripts/plot-reap.sh        gathers the readings, calls the rule, acts
```

**The script keeps everything that touches the world**: `git worktree remove`,
deleting the manifest, deleting the log. Those are adaptation — they perform
what the rule decided.

**Named refusals, not a boolean.** The script already prints a reason per
worktree; the rule returns that reason as a value rather than the script
inferring it from which check failed. **That is what makes the refusals
testable**: `reapable.ts` at 100% means every one of the five is triggerable
against fixtures, including the ones a real estate will not produce on demand —
a marker and a live pid at once, a host that cannot be asked.

**`mergedAt`, never `state`, never ancestry** — the rule carries that with it. A
merged PR reports `CLOSED`, and squash-merge leaves a branch ahead of main
forever. `plot-pr-merged.sh` is the reading; the rule is what decides.

### What the reaper removes, and in what order

```
worktree  →  manifest  →  log
```

**The order matters for the first two and the script says why**: worktree first,
because the reverse leaves a live worktree with no manifest. **The log goes
last because it is the only one that is pure cleanup** — a missing log breaks
nothing, while a missing manifest orphans an agent.

**A missing log is not a refusal.** The five refusals are about work that might
be lost; a log describes work that is already merged. `rm -f` semantics: if it
is not there, that is the desired state.

### What a log is not

**It is not the transcript.** `.plot-worker.log` lives inside the worktree and
goes with it; this is the dispatcher's own record of what it started. The two
are different files with different lifetimes, and CLAUDE.md already distinguishes
them.

**It is not history worth keeping.** Every log removed here belongs to a
worktree whose PR merged — the work is in the repository, described by its
commits and its plan. **If a log matters after the work lands, that is an
argument for putting its content somewhere durable, not for keeping the file.**

## Slices

**The Deciding slice depends on nothing that is not already merged.** Two of the
five refusals read the world — a live pid from the process table, a merged PR
from the host — and those are `Processes` and `Host`, **on `main` since #530**.
`reapable.ts` takes readings and returns a refusal; who fetches them is the
caller's business, which is what makes the rule pure.

**So it does not wait on the sandbox plan.** That plan expresses workflows
against the same ports; this one expresses a rule. Neither needs the other, and
holding this behind it would be waiting for a pattern rather than a dependency.

**The four are otherwise independent**: the resolver, the move, the rule and the
log removal each land on their own, and only Moving needs Resolving first.


### Resolving (Branch: infra/one-place-decides-where-a-log-lives)

`agent-log.ts`, and the nine modules asking it instead of resolving themselves.

**Readers count too, and the plan first missed them.** The 22 call sites are
writers; `auto-deliver.ts` and `auto-dispatch.ts` **read** these logs and were
not in that list. **A missed reader is worse than a missed writer**: the writer
puts a file somewhere unswept, while the reader looks in an empty directory and
reports nothing wrong.

**One grep covers both**, which is why they are not counted separately — two
lists drift, one expression does not.

**Done when** `grep -rn "resolve(repoRoot, '\.\.')" packages/board/src/` returns
**nothing**, every log path — read or written — comes from the resolver, and the
board's log links still open the right file.

**The grep is the assertion.** 22 call sites is exactly the kind of change where
one gets missed, and the missed one keeps writing to the old location where
nothing will ever clean it.

### Moving (Branch: infra/a-log-lives-under-worktrees)

The resolver returns a path under the configured worktree root; the fallback
stays the parent directory.

**A path guard joins the slug guard on `/api/dispatch-log`.** That route serves
these files to a browser, and its existing guard validates the SLUG against
`SLUG_RE` — it is directory-independent and already excludes `../`, so the move
does not break it. **The second check asserts the resolved path sits under the
configured root**, which is the invariant the resolver now owns and the one a
future caller could violate without touching the slug. Two lines, and the slug
guard is unchanged.

**The route's comments describe the old location and are corrected**, because
prose that names a path is prose that goes stale silently.

**Old logs are moved once, on the first dispatch after this lands.** The 190
found on 2026-08-30 were trashed by hand, but any other checkout has its own,
and leaving them means a directory that is never cleaned by anything.

**The risk is stated: a dispatch that touches files in the parent directory does
more than it says.** So it is bounded to exactly what Plot wrote — files
matching `plot-<kind>-*.log`, `.state` and `.prompt.md`, and nothing else — it
moves rather than deletes, it runs once (a marker in `.worktrees/` records that
it has), and **a failure to move is not a failure to dispatch**. The migration
is convenience; the dispatch is the job.

**Done when** a dispatch in this repository writes its log under `.worktrees/`;
a repository with no `Worktree root` key still writes beside the repo; existing
`plot-*` logs are moved once and the second dispatch moves nothing; a move that
fails leaves the dispatch working; the path guard rejects a resolved path
outside the root; and `pnpm run test:board` passes unedited.

### Deciding (Branch: infra/one-rule-decides-what-is-reapable)

`reapable.ts` in the domain; `plot-reap.sh` reduced to gathering readings,
calling it, and acting on the answer.

**Done when** the five refusals are named values returned by the rule, each
individually triggerable against fixtures; **`reapable.ts` is at 100%
coverage**; the script contains no `if` about whether a worktree may go; and
**`--dry-run` output is byte-identical before and after on the same estate**.

**That last assertion is what makes this safe.** The reaper removes checkouts,
and its refusals are the only thing standing between a cleanup and losing work —
two of them saved changesets on 2026-08-30. A rewrite that changes one refusal
by accident is a rewrite that deletes something.

### Reaping (Branch: bug/a-reaped-worktree-takes-its-log)

The script removes the log after the manifest.

**Done when** reaping a worktree removes its log, a reap whose log is already
gone still succeeds, `--dry-run` names the log it would remove, and the e2e
suite passes unedited.

## Notes

**The 190 already there were trashed on 2026-08-30**, before this plan existed —
they belonged to worktrees reaped the same day. **This plan is about the next
190 not accumulating**, which is why it is worth writing for a defect that has
already been cleaned up once by hand.

**Why `infra` and not `bug`:** nothing is broken. Logs are written where they
were designed to be written, and read correctly from there. What changes is
where that is and who cleans up.
