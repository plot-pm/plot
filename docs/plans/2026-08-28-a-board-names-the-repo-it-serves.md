# A board names the repo it serves

> `serverInfo()` tells a reader the port and the branch, and not the repository. A stray board serving a one-plan fixture on the usual port was indistinguishable from the real board for two hours on 2026-08-28 — and the field that would have settled it in one glance is one line of an object that already ships on every response.

## Status

- **Phase:** Released
- **Type:** bug
- **Sprint:** the-published-board-works
- **Issue:** <!-- optional -->
- **Story:** <!-- optional -->
- **Review:** in-session
- **Impl:** own branches
- **Approved:** 2026-08-28, Jan Wloka, in-session
- **Started:** 2026-08-28, Jan Wloka, `bug/a-board-names-the-repo-it-serves`
- **Delivered:** 2026-08-28
- **Released:** 2026-08-29, v2.11.1

## Approval

- **Assignee:** Jan Wloka

## Changelog

- The board header names the repository it is serving, so two boards on one machine are told apart at a glance.

<!-- Board impact: one field on ServerInfoSchema, set in serverInfo(), rendered
     in the header. The schema change is the contract touch — see Notes. -->

## Motivation

**The design instinct was already right, and solved for the wrong discriminator.**
`ServerInfoSchema.branch` carries a docstring that describes today's failure
almost exactly:

> *"With 22+ worktrees on this repo a reader who sees a layout they changed and
> concludes the fix failed may simply be looking at another branch's artifact;
> this names which one so the two are told apart."*

**Branch was the right idea for the wrong axis.** The confusion that actually
happened was not two branches of one repo — it was **two repositories**, one of
them a temporary fixture, and the stray board's branch was perfectly plausible.

### Measured

**2026-08-28.** A board left running by a test held
`/private/var/folders/…/plot-smoke-0oMvVS/repo` as its working directory —
a scratch estate with one plan — and served it on **:7777**, the usual port.

What the reader had to work with:

| shown | said |
|---|---|
| port | `7777` — the expected one |
| branch | plausible |
| sprint | *No active sprint* |
| footer | *1 branches across 1 plans* |

**The two facts that would have settled it were both absent**: which repository,
and that it was not this one. The conclusions drawn instead were *the sprint is
empty*, *the board shows nothing*, and finally *we cannot ship the release* —
none true, and each an hour apart.

**The footer already carried the tell.** *"1 branches across 1 plans"* against a
repo with 71 branches across 38 plans is decisive **if you know both numbers**.
Nobody reads a footer for identity; they read a header.

### Why 2.11.1

**Multiple boards is about to become ordinary.** The same sprint carries
`one-cap-holds-across-boards`, and a user who runs a second board for a second
project has no way to tell the tabs apart. **Identity is the cheapest of the
three fixes and the one that makes the other two diagnosable.**

## Design

### Approach

**One field, and the object it joins already ships on every `/api/board`
response.**

```
ServerInfoSchema {
  restartCommand  … already there
  port            … already there
  branch          … already there
  repo            ← the repository root the server is serving
}
```

**The header renders the basename, and carries the full path as a title.** A
reader scanning two tabs needs `plot` vs `plot-smoke-0oMvVS`, not two long
paths; the path is there for whoever looks twice.

**`repoRoot` is already on `BuildBoardOptions`** and is what every helper spawn
is resolved against — this reports a value the server already holds, rather than
computing a new one.

### What it must not do

**It must not fabricate a name.** An unreadable root renders no element, exactly
as `branch` does for a detached HEAD — *"which the header renders as no element
rather than a fabricated name."* The same rule, for the same reason.

**It must not be a `git` call.** `branch` is memoised as a startup fact
specifically to keep a fork off the request path; the repository root is a
startup fact too, and is already resolved before the first response.

## Slices

### Named (Branch: bug/a-board-names-the-repo-it-serves, PR: #505)

`repo` on `ServerInfoSchema`, set in `serverInfo()` from `opts.repoRoot`,
rendered in the header beside the branch.

**Done when** the header shows the repo's basename with the full path as its
title; an unreadable root renders nothing rather than a placeholder; and a test
asserts two servers on different roots report different values.

## Notes

**This is a contract touch, and the schema is where it belongs.** The client
casts `board` rather than parsing it, so a field the server emits without a
schema entry is `undefined` in the renderer — the estate has measured that
before. **`ServerInfoSchema` gets the field, defaulted to `''`,** so an older
server yields no element rather than a broken header.

**One field, three touchpoints:** the schema, `serverInfo()`, the header. Small
enough that the argument above is longer than the diff — which is the right
shape for a fix whose value is entirely in a reader's first glance.
