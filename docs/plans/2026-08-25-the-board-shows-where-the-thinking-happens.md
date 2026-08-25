# The board shows where the thinking happens

## Status

- **Phase:** Approved
- **Type:** feature
- **Sprint:** the-board-tells-the-truth-in-every-section
- **Issue:** <!-- optional -->
- **Story:** <!-- optional -->
- **Review:** in-session
- **Impl:** own branches
- **Approved:** 2026-08-25, Jan Wloka, in-session
- **Started:** <!-- YYYY-MM-DD, who, `branch` -->
- **Delivered:** <!-- YYYY-MM-DD -->
- **Released:** <!-- YYYY-MM-DD, version -->

## Changelog

The Agents tab names the branch the master agent is working on, in a labelled
line above its sections. The branch chip beside the title — which named the
SERVER's checkout and was read as the operator's — is removed.

## Motivation

### The measurement

An operator on `bug/a-head-counts-its-own-waves` looked at the board's header,
saw `main`, and asked why. The header was right, and that is the problem: it
names the branch the SERVER is serving from, and that server runs in a
different worktree.

```
main worktree (…/plot)   bug/a-head-counts-its-own-waves   ← the operator
board worktree           main                              ← the server
```

Two facts, one chip, and the chip shows the one nobody asked about.

**The concept work on this repo happens in the main checkout, on branches with
no worktree and no dispatched worker** — a person and the master agent, moving
between branches as the thinking moves. That is where plans get written,
interrogated and approved: the work this whole tool exists to track, and the
only work the board cannot see.

`.plot/agents/` holds dispatched workers only — `plot-dispatch.sh` is its sole
writer — so a session nobody dispatched has no manifest. Measured 2026-08-25:
**35 of 52 worktrees on this machine have no registry entry**, in three groups
(the main checkout, ~9 scratchpad directories, orphaned `plot-wt-*` trees). Only
the first is a desk anyone sits at.

### Why the earlier plan was right to decline, and why that has changed

`the-board-says-which-branch-it-serves` (#337) named this exact idea and
deliberately did not build it, under **What this is NOT**:

> *Which branch the master agent is working on — not recorded anywhere. […] It
> additionally has no stable answer: the master agent switches branches
> constantly, so its `branch` would frequently and correctly be `''`.*

Both halves have moved.

**"Not recorded anywhere" was about the REGISTRY, and the registry is not the
only source.** A worktree's branch is `git branch --show-current` — exactly what
`serverInfo` already runs for the server's own checkout. Reading it for one
other directory is the same call, one `cwd` over.

**"Switches constantly" was an estimate, and it is wrong here.** Measured on the
main worktree, 2026-08-25: **4 branch changes in the last 40 reflog entries.** A
session settles on a branch for as long as the work takes — tens of minutes on
this estate. That is the cadence a displayed value wants.

## Design

### One labelled line, at the top of the Agents tab

```
Plot                                          [Board] [Agents]
──────────────────────────────────────────────────────────────
Master Agent:  ⎇ bug/a-head-counts-its-own-waves

  WAITING ON YOU (10)
  WORKING (4)
```

A labelled row, not a chip in the title bar. **The label is what makes it
answerable**: the removed chip was unlabelled, so a reader supplied their own
meaning for it — and the meaning they supplied was this one.

**It lives inside `AgentList`, not the page header**, and appears on the Agents
tab only. The Agents tab is where *who is working, and on what* is the subject;
this row is that question's missing answer, and it belongs with the sections
that answer it for everyone else rather than in the chrome above them. The
header keeps its own job — title, tabs, board filters — and gains nothing.

The label reads `Master Agent:` — this project's own term, kept rather than
softened to `This session`. A newcomer learns one word, and it is the word the
rest of the estate uses.

The branch is carried on the **fleet** payload, beside `agents`, not on
`ServerInfo`. That is where its consumer is, and it is the same payload the
registry rows already ride. `ServerInfo.branch` keeps answering its own
question — which checkout serves this page — and simply stops being drawn.

The branch name links to the branch on the git host, built with
**`branchUrlBase`** (`fleet.ts:243`), which the board already uses for its
branch rows. It returns `""` for any host whose branch-page shape cannot be
known, and the link is then not rendered — the same refusal, reused rather
than re-derived. A branch with no honest URL still shows its name.

### The server's chip is removed, not moved

`board.server.branch` stops rendering in the header (`App.tsx:830`).

**Deleting it is the fix, not collateral.** #337 added it to answer *which
checkout is this artifact from*, which is a real question for a repo with 50+
worktrees. But the measurement is that a reader looking at an unlabelled branch
name in a header reads it as *where am I* — twice in one session, by someone who
already knew the difference. A field that reliably answers a question other than
the one it was built for is not informative; and two branch names in one header
is worse than either alone.

**The field stays in `ServerInfo`, and after this it has no render site.**
Measured, not assumed: `UnreachableOverlay` receives the whole `ServerInfo` but
reads only `restartCommand` and `port` — the header at `App.tsx:830` is the
only place `server.branch` is drawn.

**So the question #337 built it for goes unanswered on the page, and that is
accepted.** *Which worktree's artifact am I looking at?* is a real question —
it is how a rebuilt board that looks unchanged gets diagnosed. But the
measurement is that readers ask *where am I*, and the person who hits the stale
artifact is the person who just built it, who knows which tree they were in.
Rendering a rarely-wanted answer where a frequently-asked question lands is
what caused the misreading twice.

The field is kept in the payload rather than deleted: it is correct and cheap,
and if the artifact question ever needs a home, `UnreachableOverlay` is where
*which server was this* is genuinely being asked. Reviving it there is a later
plan's work, not this one's.

**Two tests assert the behaviour being removed**, and they are rewritten, not
deleted:

- `test/integration/branch-served.browser.test.ts` — asserts the header SHOWS
  the served branch, in both its cases. This is the anti-contract case: the
  test is not incidentally broken, it documents the behaviour this plan
  reverses. It becomes the assertion that `server.branch` is **never** drawn —
  the same value stubbed, now expected absent on both tabs — and its docstring
  is rewritten to say why the earlier contract was withdrawn. Note it stubs
  `/api/board`; the new row rides `/api/fleet` and needs the Agents tab opened,
  so the row's own tests are new work rather than edits to this file.
- `test/unit/branch-served.test.ts` — server-side, and stays as it is. It pins
  `serverInfo`'s read, which this plan does not change.

### Only the main checkout

Not every registry-less worktree — the measured 35 include scratchpads and
orphans, and a list of 35 answers a different question than *where is the master
agent*. **One directory: the repo the board was started from.**

The board server resolves it as the main worktree of its own repository
(`git worktree list` names it first; it is the one whose path is not a linked
worktree), then reads that directory's branch. Verified 2026-08-25 on this
machine: the first entry is `…/plot` at `bug/a-head-counts-its-own-waves` —
the operator's branch, and the value the header should have been showing.

**A board started inside a linked worktree still names the main checkout.** The
alternative — name the tree the board itself runs in — was considered and
rejected: it makes the row mean different things in different setups, and the
thing it would name is the *server's* tree, which is the conflation this whole
plan exists to undo. The master agent runs in the main checkout wherever the
board happens to be served from, so the row names one place and always the same
place.

### Derived, never recorded

No manifest, no writer, no new file. The board asks git two questions it already
knows how to ask.

**This is what makes it honest.** A recorded value needs someone to update it on
every checkout, and the update is what breaks — the failure
`the-registry-drops-a-settled-worker` exists to reconcile. A derivation cannot
go stale.

It is read on the board poll, not memoised for the process's life: unlike the
server's own checkout, **this branch changes while the server runs** — that is
the entire premise. The existing TTL cache (`server-info.ts`, #410) is the
established shape for exactly this, and the same 5 s TTL applies.

**The two reads must not share an implementation.** `serverInfo`'s branch is
memoised for the process's life *on purpose* — `branch-served.test.ts:83` pins
it as "reads the branch ONCE — a later checkout does not change what it
reports", because a process serves one worktree forever. This read requires the
opposite. An implementer who factors out "read a branch" and reuses it will
either break that test or silently freeze this row on the branch the board
started with — which is a defect that looks exactly like the feature working,
until the operator switches branch and nothing moves.

### One silence for every failure

`git branch --show-current` prints nothing for a detached HEAD. Nothing is also
what a board outside a git repo can say, and what a board whose main checkout
cannot be resolved can say. **All three send `''`, and `''` renders no row at
all** — not the label alone, not a placeholder, not a short SHA.

This is a deliberate collapse of cases the server *could* distinguish. The
argument is the client's: a reader looking at `Master Agent:` followed by
nothing learns only that the board wanted to tell them something and could not,
which is what an absent row already communicates without occupying a line. The
distinctions — detached, no repo, unresolvable — differ in cause and not in
what a reader should do, and none of them is *where the thinking happens*.

It is the same rule `serverInfo` states for its own empty answer, and the same
one `CardPrSchema` states for a PR with no URL: render nothing rather than
render a guess or a stub. The field is `''`, never absent, because the schema's
convention is that absent and empty answer different questions — and this is
emphatically the *empty* one: the board asked, and got no answer.

### Not chosen: marking a branch change

The row changes under a reader when the master agent switches branch, and two
richer treatments were considered — a visual mark on change, or naming the
branch it switched from. Both rejected.

The row is **context, not a control**: nothing is acted on from it except the
host link, and a link to the branch you just left is not harmful. Marking a
change would also add state to a row this plan defines as purely derived, which
is the property that makes it unable to go stale. And the measurement argues
against optimising for it at all — 4 changes in 40 reflog entries is a rare
event, and the cost of handling it is paid on every render of the common case.

Show what is true now. When it stops being true, show what is true then.

### Not chosen: a session row in WORKING

The first draft put it there, as a row beside the agent rows. Rejected: WORKING
lists what the fleet is doing, and its rows are filtered — by sprint, and (since
`working-lists-the-workers-that-are-working`) by `LIVE_STATES`, which a
manifest-less session has no state to satisfy. A row that must bypass a
section's filters to appear is not a member of that section.

It would also couple this to that plan's three open waves. Above the sections —
inside `AgentList` but outside every section — it depends on nothing in flight.

### Not chosen: a manifest for the master agent

The obvious symmetry — give the session a `.plot/agents/` entry. Rejected
because it needs a writer, and the only honest writer is the session itself,
which would have to notice its own checkouts. `plot-dispatch.sh` writes a
manifest because it CREATES the worktree and knows the branch at that moment;
nothing has that moment for a session that was always there.

## Waves

### Shown (Branch: feature/the-header-names-the-master-agent)

The fleet payload carries the main checkout's branch and its host link, derived
from git on the poll's own clock; `AgentList` renders the `Master Agent:` row
above its sections; and the server's own branch chip is removed from the
header.

**One wave, deliberately — this was drafted as two.** A payload wave and a
render wave is this estate's standard split, and it was rejected here on the
question *what does main look like between them?* The answer is: carrying a
field with no consumer AND still showing the misread chip. Neither half is
useful alone — the field is invisible, and the chip's removal without the row
leaves the header answering nothing at all. A split whose first half cannot be
read and whose second half is the entire user-visible change is a split that
only adds a place to stall.

## Done when

1. With the main checkout on a branch no plan names, the Agents tab's `Master
   Agent:` row names that branch. Asserted against a fixture whose branch is
   absent from the plan estate — the case that makes it invisible today.
2. **The row names the MAIN checkout's branch, not the server's**, asserted with
   the two differing. This is the assertion a naive implementation fails:
   reusing `serverInfo`'s branch passes every other check here while rendering
   the exact value that caused the misreading.
3. `server.branch` no longer renders anywhere. Asserted by absence on BOTH tabs
   — the page contains one branch name for the session and none for the server.
4. The row appears on the **Agents tab only**. Asserted on the Board tab as
   absence, so a header-level implementation — which passes items 1 and 2 —
   fails here.
5. **A detached main checkout renders NO row** — not the label alone, not a
   SHA. Asserted as absence, over all three empty cases (detached, not a repo,
   unresolvable), because a happy-path-only test passes an implementation that
   shows a bare `Master Agent:` forever.
6. **The row follows a branch switch.** Asserted by changing the checkout's
   branch between two polls and reading the row again: it names the new branch.
   This is the assertion that catches sharing `serverInfo`'s memoised read —
   which passes every other item here and then freezes the row on whatever
   branch the board started with.
7. The branch links via `branchUrlBase`; a host it cannot resolve renders the
   name with no link. No URL is composed anywhere else.
8. Nothing is written. Asserted on the filesystem: no new manifest, no state
   file, `.plot/agents/` unchanged after a render.
9. `pnpm test`, `pnpm run test:reconcile`, `pnpm run test:board` green.

## Notes

### The question was asked twice before it was heard

Once as *"why does the header say main when I am on a bug branch?"* and once as
*"wollten wir nicht den Branch vom Master-Agent anzeigen?"*. The first reading
treated it as a header defect and confirmed the header was right — which it
was, about a fact nobody had asked for. The second made the actual gap visible.

**The chip answering correctly is what made it wrong.** A field that is accurate
and consistently misread is a worse failure than a broken one, because nothing
in the output says so.

### It belongs to this sprint's subject

*The board tells the truth in every section.* An unlabelled branch name that a
reader reliably resolves to the wrong subject is a section not telling the
truth — not by being false, but by answering a question it was never asked.
