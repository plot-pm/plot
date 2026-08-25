## Implementation brief — the-board-shows-where-the-thinking-happens

- **Plan (canonical):** `docs/plans/2026-08-25-the-board-shows-where-the-thinking-happens.md` on main
- **Approved:** 2026-08-25, Jan Wloka, in-session
- **Branch:** `feature/the-header-names-the-master-agent` (base: `main`)
- **Ends as:** one PR to main
- **Review of the code:** repo convention (CI green + review)

Single wave. Nothing waits on it and it waits on nothing.

### What to build

The Agents tab gains a labelled line above its sections:

```
Plot                                          [Board] [Agents]
──────────────────────────────────────────────────────────────
Master Agent:  ⎇ bug/a-head-counts-its-own-waves

  WAITING ON YOU (10)
  WORKING (4)
```

It names the branch **the main checkout** is on — where a person and the master
agent do the concept work — derived from git, never recorded. And the header's
existing branch chip (`App.tsx:830`, `board.server.branch`) is **removed**.

The concrete failure: an operator on `bug/a-head-counts-its-own-waves` read the
header, saw `main`, and asked why. The header was correct — it names the
SERVER's checkout, and the board server runs in a different worktree. The
question *where am I* had no answer anywhere on the page, and the chip was
answering a question nobody asked while looking like it answered that one.

### The decisions the plan settles — do not re-derive them

**The chip is deleted, not moved or relabelled.** It is accurate. That is what
makes it a defect: an unlabelled branch name in a header gets read as *where am
I*, twice in one session by someone who already knew the difference. Two branch
names in one header is worse than either alone. `ServerInfo.branch` stays in the
payload and simply stops being drawn — measured: `UnreachableOverlay` receives
the whole `ServerInfo` but reads only `restartCommand` and `port`, so after this
the field has **zero render sites**. That is accepted, not overlooked.

**It lives in `AgentList`, not the header.** The header's filters are Board-only
(`App.tsx:860-869`), and the Agents tab is where *who is working, and on what*
is the subject. Placing it in the header gated on `tab === 'agents'` was the
considered alternative and was rejected: the row belongs with the sections that
answer that question, not in the chrome above them.

**The branch rides the FLEET payload, beside `agents`** (`FleetSchema`,
`schema.ts:2861`) — not `ServerInfo`. That is where its consumer is.

**The two branch reads must NOT share an implementation.**
`test/unit/branch-served.test.ts:83` pins that `serverInfo` reads the branch
ONCE — deliberately, because a process serves one worktree for its whole life.
This read needs the opposite: the master agent's branch **changes while the
server runs**, which is the entire premise. Factor out "read a branch" and reuse
it, and you either break that test or silently freeze the row on the branch the
board started with — a defect that looks exactly like the feature working until
someone switches branch. Use the TTL shape from `server-info.ts` (#410), 5 s.

**Resolving the main checkout:** `git worktree list` names it first — the entry
whose path is not a linked worktree. Verified 2026-08-25 on this machine: first
entry is `…/plot` at `bug/a-head-counts-its-own-waves`, the operator's branch.
A board started inside a linked worktree still points at the main checkout;
naming the board's own tree was considered and rejected, because that is the
server's tree again — the conflation this plan exists to undo.

**One silence for every failure.** Detached HEAD, not a git repo, unresolvable
main checkout — all three produce `''`, and `''` renders **no row at all**. Not
the label alone, not a placeholder, not a short SHA. The field is `''` and never
absent: the schema's convention is that absent and empty answer different
questions, and this is the empty one (the board asked and got no answer).

**The link is `branchUrlBase`** (`fleet.ts:243`), already used by branch rows.
It returns `''` for any host whose branch-page shape cannot be known, and the
name then renders with no link. Compose no URL anywhere else — a guess looks
exactly as confident as a correct answer.

**Rules carried over unchanged:** absent is not false; read the exit code, not
the emptiness; the board never invents a lifecycle transition.

### Done when

The plan's `## Done when` list is the specification. Three of its nine exist
because a naive implementation passes without them:

- **Item 2** — the row names the MAIN checkout's branch, not the server's,
  asserted with the two differing. Reusing `serverInfo`'s branch passes every
  other check while rendering the exact value that caused the misreading.
- **Item 4** — the row is on the **Agents tab only**, asserted on the Board tab
  as absence. A header-level implementation passes items 1 and 2 and fails here.
- **Item 6** — the row follows a branch switch, asserted across two polls. This
  is what catches the shared-memoised-read trap above.

**One existing test is an anti-contract and must be rewritten, not deleted:**
`test/integration/branch-served.browser.test.ts` asserts the header SHOWS the
served branch, in both its cases. It documents the behaviour this plan reverses.
Rewrite it to assert `server.branch` is **never** drawn (same stub, absence on
both tabs) and rewrite its docstring to say why the earlier contract was
withdrawn. Note it stubs `/api/board`; the new row rides `/api/fleet` and needs
the Agents tab opened, so the row's own tests are new files.
`test/unit/branch-served.test.ts` is server-side and stays as it is.

Plus the repo's gates: `pnpm test`, `pnpm run test:reconcile`,
`pnpm run test:board`, `pnpm run typecheck`. Run `pnpm build:board` in THIS
worktree and commit the artifact. Add a changeset — a `packages/board` change
uses `'@plot-pm/board': patch` frontmatter, **not** a skills `bumps:` block.
Node 24 (`nvm use`) — pnpm crashes on 26.

### Bookkeeping

When the PR exists, append `→ #<number>` to this branch's line in the plan's
`## Waves` section on main. **Waves plans annotate inside the heading**:
`### Shown (Branch: feature/the-header-names-the-master-agent, PR: #N)` — a
trailing `→ #N` parses as `prs=[]` on a Waves plan. Check
`git branch --show-current` is main before that edit.

Push your first real commit as soon as it exists, and again after any rebase.

### Scope guard

This branch owns: `packages/board/src/app/components/AgentList.tsx`,
`packages/board/src/app/App.tsx` (chip removal only),
`packages/board/src/server/fleet.ts` (payload field),
`packages/board/src/contract/schema.ts` (schema field),
`packages/board/test/integration/branch-served.browser.test.ts`, plus new tests.

**Known collision, verified at dispatch:** `bug/a-finished-row-is-not-active` is
in flight and holds `AgentList.tsx` and `packages/board/test/unit/agent-list.test.ts`.
Expect to rebase. This is a report, not a refusal.

If you find something the plan did not anticipate, report it rather than
improvising outside scope.
