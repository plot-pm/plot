## Implementation brief — controller-gate-fires-on-a-script

- **Plan (canonical):** docs/plans/2026-10-24-controller-gate-fires-on-a-script.md on main
- **Approved:** 2026-10-24, Jan Wloka, plan-PR #2472 merged
- **Branch:** `bug/controller-gate-fires-on-a-script` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per plan Review: `pr`

Single-branch plan — no waves, nothing else to coordinate against.

### What to build

The controller gate refuses commands that only *mention* a gated script's
name in data it never runs. Issue #2440: `git commit -m "plot-deliver.sh
flipped only the Status block"` was refused with `plot-deliver.sh is a
controller-owned action`, though the command runs no script at all — the
name appears solely inside the commit message text. Three shapes still do
this (table in the plan's Motivation), measured against
`plot-controller-gate.sh` on `origin/main` (84b1638e4):

| command shape | gate |
|---|---|
| `git commit -m "plot-deliver.sh flipped only the Status block"` | refuses |
| `git commit -F - <<EOF` with the name in an unquoted body | refuses |
| `plot-state-receipt.sh --unowned-action deliver <slug> "plot-deliver.sh flipped …"` | refuses |

Two shapes already pass and must keep passing: single-quoted heredoc
bodies (the `a-gate-matches-an-invocation` fix, #935, Released 2.19.0),
and every real invocation shape in that plan's corpus.

The fix is a reader addition, not a rewrite: strip the *data* argument of
specific message-carrying sinks before `controllerInvocation` reads the
command, the same way `withoutQuotedHeredocs` already strips single-quoted
heredoc bodies before that reading.

### The decisions the plan settles — do not re-derive them

**The strip is sink-aware, not position-aware.** The plan's panel (feeding
`a-gate-matches-an-invocation`) measured that matching by command
*position* misses a loop body — `for s in a b; do plot-dispatch.sh $s;
done` still has to refuse. So this fix cannot be "the last argument of any
command is data." It has to name specific *programs* whose argument is
message text their process never executes: `git commit -m`/`--message`,
`git commit -F -`'s stdin-from-heredoc, and
`plot-state-receipt.sh --unowned-action`'s third positional (the reason
string). Anything that *runs* its quoted text — `sh -c '<script>'`, `bash
<script>`, `xargs` — keeps that text tokenised, because for those programs
the quoted span is the command.

**An unquoted heredoc body is not automatically data.** It can carry a
`$(...)` substitution or a backtick, and that substitution can itself
invoke a gated script (`git commit -F - <<EOF` with a line that reads
`$(plot-deliver.sh ...)`). The plan leaves open (see Open Questions below)
who decides this and where, but the invariant that must hold regardless:
**a heredoc body containing `$(` or a backtick is never stripped.** Pin
this with its own fixture — the plan names it explicitly: "A commit whose
message holds a `$( plot-deliver.sh … )` substitution still refuses."

**Where the strip runs.** `controllerInvocation`
(`packages/domain/src/rules/ci-suite.ts:208`) is the single reader; it is
called from exactly one production site,
`packages/board/src/server/entry/gate.ts:558-595`
(`controllerGateOf`'s `ask`), which already runs `withoutQuotedHeredocs`
before it. The new strip is a peer step in that same pipeline — either a
new exported function in `controller-gate.ts` beside
`withoutQuotedHeredocs`, called at `gate.ts:558` alongside it, or folded
into `controllerInvocation`'s own segment-splitting loop in `ci-suite.ts`
(that function already removes comments and `for`-loop data lists via
`withoutDataLists`/`withoutComments` before splitting on `&&|\|\||[;|\n]`).
The plan leaves this as an Open Question — pick one and say which in the
PR, but do not invent a third call site. `plot-controller-gate.sh` itself
is a thin launcher (see `skills/plot/scripts/plot-controller-gate.sh:5`)
and holds none of this logic — it is not where the fix goes.

**The existing corpus is the regression backstop, and it is large.** The
`#935` invocation corpus already pins: a plain call, `./relative`, an
absolute path, `bash <script>`, `sh -c '<script>'`, `env FOO=1 <script>`,
`for`/`while`/`if` bodies, `{ }`, `( )`, `$( )`, `source`, `.`, `xargs`,
`find -exec`, and the single-quoted heredoc case. None of these may start
refusing differently. Run the full existing
`test/reconcile/controller-gate.test.mjs` file, not just new cases — it is
804 lines and the fix sits directly in its shared reading path.

**The rule carried over unchanged:** `controllerInvocation` returns
`null`, not `false` or empty — absence of a match is a distinct value from
"this command is a read." `isReadSegment` and the `READERS` set (`ls`,
`cat`, `git grep`) already encode "reads its operand, never runs it"; the
new sinks (`git commit -m`, the receipt's reason argument) are the same
shape one level up — a program whose *argument* is text, not a script to
execute — so model them consistently with how `READERS` already carves
out script-reading programs, rather than inventing a second mechanism.

### Open Questions the plan left for implementation to settle

- Is the sink list (`git commit -m/--message/-F -`, the receipt reason)
  closed enough, or does `gh pr create --body`, `gh issue create --body`,
  `git tag -m` need to join it now? (#935's report already found `gh issue
  create` passes today — confirm it still does after this change, it is
  not nothing-to-do.)
- Does an unquoted heredoc body with no `$(` and no backtick count as
  data — and is that decided by the strip itself or left to
  `controllerInvocation`'s existing reading? Pick one; say which in the PR
  body.
- Whether `plot-state-gate.sh` / `plot-phase-gate.sh` show the same shape
  is explicitly out of scope — #935 did not check them because nobody
  reported it there. Do not widen into those files on this branch.

### Done when

The plan's `## Done when` (Slices section) is the specification:

- The three refusing rows in Motivation pass, each pinned by a fixture
  using the reporter's own message text from #2440.
- The single-quoted heredoc row keeps passing (no regression on #935's fix).
- Every invocation shape in the #935 corpus still refuses — run the whole
  `test/reconcile/controller-gate.test.mjs` file.
- A commit message holding a `$( plot-deliver.sh … )` substitution still
  refuses — this is the case most likely to get silently broken by an
  overly broad strip; write it as its own fixture, don't assume the
  general corpus run catches it.
- `pnpm run test:contracts` passes.
- `node skills/plot/scripts/board/plot-local-checks.mjs` (resolve the path
  from this repo's root) lists nothing unrun — run before each push, not
  just once at the end.

This branch's own commit messages must not name a gated script
(`plot-deliver.sh`, `plot-approve.sh`, `plot-dispatch.sh`) until the fix
ships — the plan notes this explicitly, since until the fix lands this
branch's own commits are exactly the shape being fixed and would self-trip
the gate.

`scripts/check-shell-lines.sh` refuses a PR whose shell under `skills/`
grew past its merge base. This fix is TypeScript in `packages/domain/src`
and `packages/board/src`, not shell, so it should cost nothing there —
confirm rather than assume if the change touches `plot-controller-gate.sh`
itself.

### Bookkeeping

Open the PR through the controller, not `gh pr create`:

```bash
skills/plot/scripts/plot-open-pr.sh          # current branch
```

It reads the plan, titles the PR from its wave heading, and refuses a
branch with no commit beyond a `PLOT-BLOCKED` marker. When it returns the
PR number, append `→ #<number>` to this branch's line in the plan's
`## Slices` section.

Push the first real commit as soon as it exists — a branch with no PR and
no pushed work is invisible to `/plot-pulse`.

### Scope guard

This branch owns: `packages/domain/src/rules/ci-suite.ts`,
`packages/domain/src/rules/controller-gate.ts`, and
`test/reconcile/controller-gate.test.mjs`. It should not need to touch
`packages/board/src/server/entry/gate.ts` beyond the one call-site change
if the new strip becomes a separate exported function (see the Open
Question on placement above).

No sibling branch is in flight for this plan — it is a single-branch bug
fix with no wave structure. If you find the fix wants to touch
`plot-state-gate.sh`, `plot-phase-gate.sh`, or any file outside the three
named above, stop and report rather than widening scope — the plan
explicitly deferred that question.
