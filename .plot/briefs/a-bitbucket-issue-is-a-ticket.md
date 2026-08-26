## Implementation brief — my-bitbucket-issues-are-in-the-inbox (wave Asked)

- **Plan (canonical):** `docs/plans/2026-08-26-my-bitbucket-issues-are-in-the-inbox.md` on main
- **Approved:** 2026-08-26, Jan Wloka, in-session
- **Branch:** `feature/a-bitbucket-issue-is-a-ticket` (base: `main`)
- **Ends as:** one PR to main
- **Review of the code:** repo convention (CI green + review)

The plan's only wave. Nothing waits on it and it waits on nothing.

### What to build

`plot-host.sh`'s `issue-list` and `issue-view` answer for Bitbucket instead of
exiting 4, by calling `bb issue list` / `bb issue view` and parsing their text.

Today both refuse, with a message that is **false**:

```
plot-host.sh:603  "bitbucket has no issue listing (bb exposes none)"
plot-host.sh:638  "bitbucket has no issue read (bb exposes none)"
```

Measured 2026-08-26 against the installed CLI:

```
$ bb --version
bb version 0.6.0

$ bb issue --help
  list · view · create · update · delete · comment
```

`bb` gained issue support. The refusal was true when written and nobody
re-tested it, so a Bitbucket team with its tracker enabled sees an empty inbox
that reads as *you have no tickets*.

### The decisions the plan settles — do not re-derive them

**Parse the text; do NOT reach for the REST API.** `bb issue list` has
`--state`, `--type`, `--priority`, `--web` and **no `--json`**, so the contract
must be filled by parsing. The REST API was considered and rejected: it would
need a second auth path beside `bb`'s, for one operation, on a host whose CLI is
already installed and already authenticated for every other call. (The Jira plan
chose REST for the opposite reason — Jira has no CLI in this repo.)

**Pin the `bb` version the parse targets.** A format change must fail loudly
rather than mis-read a column. Same discipline the sibling plan
`the-pr-list-join-is-silently` reached for the 50-PR page cap: a constant that is
right today and silently wrong after an upstream release is the dangerous kind.

**Exit 4 narrows, it does not disappear.** A repo whose issue tracker is
DISABLED genuinely cannot be asked, and that is not an empty list. Three
answers stay distinct: 4 = cannot be asked, 3 = call failed, contract otherwise.

### Three measured traps — each is invisible while it works

All measured 2026-08-26 against `bb 0.6.0`. The GitHub arm's shape walks into
every one of them:

**1. `bb` writes errors to STDOUT, colour-coded — not stderr.**

```
$ bb issue list >out 2>err ; echo $?
1
out: "\033[31m:: \033[0m\033[1mAn error occurred: \033[0mAre you sure this is a bitbucket repo?"
err: (empty)
```

The GitHub arm redirects stderr to a temp file and treats stdout as data. Copy
that shape and an ANSI-escaped error message is parsed as an issue title —
Done-when 6 is the assertion that catches it.

**2. Every failure exits 1**, including *"Are you sure this is a bitbucket
repo?"*. So the exit code CANNOT choose between 4 and 3. Match `bb`'s error
text, and **default to 3 whenever the wording is unrecognised** (Done-when 5).

That default is the safety of the whole scheme, and it only falls one way:
guessing 4 renders a silent section that asserts *no tickets*; guessing 3
reports an error. An unrecognised message must therefore be an error, never a
confident emptiness.

**3. `bb issue list` has no `--limit`; `bb issue view` prints no URL or
`createdAt`.** The GitHub arm passes `--limit` through to the CLI — Bitbucket
has nowhere to put it, so honour the caller's limit yourself AFTER parsing
(Done-when 7), and construct the `url` from the repo slug and issue number.

### The request budget is in scope — do not defer it

`fleet.ts:108` counts only `pr-list` for Bitbucket, and says why:

> *"on Bitbucket both cost ZERO requests: `bb` exposes no issue listing
> (`plot-host.sh` exits 4 before touching the network)"*

**This branch makes that false.** Update `PR_REQUESTS_PER_REFRESH.bitbucket`
(currently `3`) and rewrite the comment.

The stake is recorded in that same comment: a board left open one working day
made ~1400 Bitbucket requests and hit `HTTP 429 — Rate limit for this resource
has been exceeded` **account-wide**, breaking every `bb` call from the
operator's own shell. A knowingly-wrong budget against an already-hit limit is
not a follow-up ticket.

Note `bb` has no `all` state, so a Bitbucket `issue-list` may itself fan out —
count what you actually call, and say so in the comment.

### Done when

The plan's `## Done when` list is the specification — all ten items. Four exist
because a naive implementation passes without them:

- **Item 5** — an unrecognised `bb` error exits 3, never 4. Mapping any failure
  to 4 satisfies item 3 and turns every broken call into "no tickets".
- **Item 6** — `bb`'s stdout error text is never parsed as an issue.
- **Item 7** — `--limit N` returns at most N, truncated by the adapter.
- **Item 9** — the fleet's Bitbucket budget counts the now-real calls.

Plus the repo's gates: `pnpm test`, `pnpm run test:reconcile`,
`pnpm run test:board`, `pnpm run typecheck`. Node 24 (`nvm use`) — pnpm crashes
on 26; prefer `corepack pnpm` if the homebrew one misbehaves. Add a changeset —
this touches both a skill script and the board, so it needs the `bumps:` block
for `plot` AND `'@plot-pm/board': patch` frontmatter if you edit
`packages/board`.

**You cannot run `bb` against this repo — it is on GitHub**, and `bb` answers
*"Are you sure this is a bitbucket repo?"*. Test the parse against captured
fixture text, not a live call. Do not add a test that requires Bitbucket auth.

### Bookkeeping

When the PR exists, annotate the wave heading on main — this is a `## Waves`
plan, so the PR goes **inside** the heading:

```
### Asked (Branch: feature/a-bitbucket-issue-is-a-ticket, PR: #N)
```

A trailing `→ #N` parses as `prs=[]`. Check `git branch --show-current` is main
before that edit. Push your first real commit as soon as it exists.

### Scope guard

This branch owns `skills/plot/scripts/plot-host.sh` (the two issue ops) and
`PR_REQUESTS_PER_REFRESH` in `packages/board/src/server/fleet.ts`, plus their
tests.

**Do not change the issue CONTRACT or its exit-code table** — `fleet.ts:1423`
and `idea.ts:587` both map 4 to `unsupported`, and `idea.ts` refuses with
`tracker-unsupported`. This branch makes Bitbucket ANSWER; it does not
renegotiate what the answers mean.

**Do not add issue writes.** `issue-list` and `issue-view` READ; `bb` also
exposes `create`, `update`, `delete` and `comment`, and Plot deliberately does
not use them — a plan referencing an issue is Plot's record, not the tracker's.

The board artifact `skills/plot/scripts/board/board-server.mjs` is generated and
marked `-merge`. Never read its diff — take either side, run `pnpm build:board`,
stage the **rebuild** (not the merge's copy), then commit.

Do not commit `packages/board/test/fixtures/tiny-garden/.plot/state/last-pulse.json`
— every board suite rewrites it, and a dirty copy makes
`plot-resolve-artifact.sh` refuse with `worktree-busy`.

If you find something the plan did not anticipate, report it rather than
improvising outside scope.
