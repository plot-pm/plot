## Implementation brief — bitbucket-pr-rows-run-per-row (wave 4: Tests and wording)

- **Plan (canonical):** docs/plans/2026-10-24-bitbucket-pr-rows-run-per-row.md on main
- **Approved:** 2026-10-24, Jan Wloka, plan-PR #2514 merged
- **Branch:** `docs/one-pr-reader-plan-figures` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** pr

This branch waits on `bug/pr-refresh-rotation-keeps-green` (PR #2634), already
merged — confirmed via `plot-host.sh pr-state` on 2546/2617/2634, all three
read `MERGED`. It is eligible now. Its sibling in the same wave,
`bug/bitbucket-bind-coverage-and-docs`, edits `plot-host.sh` and test files
under `test/reconcile/` and `packages/domain/`; this branch edits only
`docs/plans/2026-10-23-one-pr-reader-per-machine-and.md`. No file overlap.

### What to build

The plan this slice edits — `one-pr-reader-per-machine-and` — is **Approved**,
not Design, and its one slice (`feature/one-pr-reader-per-machine-and`, PR
#2436, currently OPEN with failing checks) has already **implemented one of
the plan's four candidate proposals**. The plan text still reads as if Design
were still choosing among them. Fix the text to match what shipped: name one
reader scope, keep one proposal as the approach, and make every spender
figure in the Motivation consistent with each other and with the issue they
come from.

Three things are true right now and the plan text does not say any of them:

1. **Proposal 1 shipped; 2, 3 and 4 did not.** `feature/one-pr-reader-per-machine-and`
   carries two implementation commits: `c17840960` adds
   `packages/domain/src/rules/reader-election.ts`, the `reader-lock` port
   (`packages/domain/src/ports/reader-lock.ts`) and its file/fixture adapters
   — a pure election rule for "one reader per (connector, account, repo) per
   machine," proposal 1 verbatim. `7b9faff96` wires `packages/board/src/server/fleet.ts`
   and `pr-refresh.ts` to that lock: a losing board reads the shared PR index
   store instead of asking the host again. Neither commit touches budget
   scheduling/jitter (proposal 2), event-driven refresh (proposal 3), or
   conditional requests (proposal 4). Those three are not scheduled anywhere
   else in this plan — its `## Slices` section names exactly one slice.
2. **The account segment is `budget_account`, not `Host.account()`.** The
   wiring commit's own message says why: `Host.account()` refuses outright on
   Bitbucket, where spend-rate already has a free, local fallback that works
   on both backends. If the plan's Design section still frames the account
   key as an open question, it has an answer now and should say so.
3. **The lock key is per `(connector, account, repo)`, not per account alone.**
   The Approach section (proposal 1) already says this correctly
   ("per host account and repository"); the Motivation's "44 spenders on one
   Bitbucket account" framing and the Design constraints both talk about
   "the account" without the repo dimension, which reads as a narrower scope
   than what was built and than what the lock key actually is. Make the two
   sections agree.

### Decisions already settled — do not re-derive them

**This is an editing slice over the plan's own Motivation, Design and Open
Questions sections — not a code slice.** Nothing under `packages/` or
`skills/` belongs to this branch. Resist the urge to "verify" the
implementation by reading test output; the two commits above are the
ground truth for what shipped, and `plot-host.sh pr-state` on the branch
(or `gh`/equivalent on PR #2436) is the ground truth for what's still open.

**"Spender figures that add up" means arithmetic, not prose polish.** The
Motivation states "44 spenders... two boards... and about 38 Claude
processes" (2 + 38 = 40, not 44). Before rewriting, re-derive the real count
from issue #2386 rather than inventing a correction — the discrepancy may be
the issue's own imprecision ("about 38") rather than a plan transcription
error, in which case the fix is to say "about" consistently rather than
implying false precision elsewhere in the same sentence. Read the issue text
(`https://github.com/plot-pm/plot/issues/2386`, cited in the plan's Notes) if
you have a way to fetch it; if not, say in the PR that the figure could not
be re-verified against source and was only made internally consistent.

**Open Questions 2 and 4 are answered by the implementation; Open Questions
1, 3 and 5 are not.** Reading the two shipped commits:

- *"How does a reader elect itself, and what happens when the lock holder
  dies?"* — answered. `reader-election.ts` is the rule; `reader-lock-file.ts`
  implements the file adapter, publishing a claim via scratch-write then
  `link()` (the atomic-publish pattern from `slots-file.ts`, not mkdir-as-lock
  — the commit message names the earlier draft it replaced and why: mkdir
  left a window where a second process could observe a claimed name before
  its content was written). `7b9faff96`'s message says an unreadable lock
  falls back to the prior per-process overlay rather than blocking, which is
  the dead-holder answer.
- *"Which of the four proposals ships first..."* — answered: proposal 1,
  alone, is what the one slice in `## Slices` implements.
- *"Does Bitbucket return ETags..."*, *"Does the cache extend the existing
  PR index or replace it?"*, and *"Does the same design apply to the GitHub
  connector..."* — still open. `7b9faff96`'s message says the board "folds
  the host's answer into the shared PR index store" (extends, not replaces),
  which may already answer the third bullet too — check
  `packages/board/src/server/fleet.ts`'s diff in that commit before deciding
  whether to close it or leave it open; do not guess.

**Do not touch `## Slices`.** That section already names one slice
correctly. The drift is in Motivation, Design (Approach + Open Questions),
and Status — not there.

**Consider whether `## Status` needs a word, not a line.** The plan's
`State:` is Approved and its one slice has a Started record and an open PR;
no lifecycle transition belongs to this slice. If the Motivation or Design
text implies the work is still being decided ("Four proposals... Design
decides which stay"), reword to past tense for the one that shipped — do not
add, remove or touch any `State:`/`Started:`/`Approved:` line. `plot-state-gate.sh`
refuses an unowned write to those fields and this slice has no controller
call that would legitimately produce one.

### Done when

The plan's slice line is the spec: *"plan `one-pr-reader-per-machine-and`
names one reader scope, one proposal and spender figures that add up"*.
Concretely:

- The Approach section reads as describing one adopted design (proposal 1),
  not four candidates awaiting a Design decision — reframe 2/3/4 as rejected
  or deferred-and-unscheduled, whichever the plan's own Slices section
  implies (it schedules only 1, so unscheduled is the accurate word; "rejected"
  would overstate what the plan actually decided).
- Open Questions 2 and 4 are either removed (answered) or rewritten to state
  the answer, not left phrased as questions the implementation already
  settled.
- The Motivation's spender arithmetic is internally consistent, and the PR
  description says whether it was re-verified against issue #2386 or only
  made self-consistent.
- The account-key and lock-scope wording in Motivation/Design matches the
  Approach section's "per host account and repository," not a narrower "per
  account" framing.

Plus: a changeset (`plot: patch` — this is a wording/figures fix to a plan
file, not new plan behavior) naming this plan via the optional `plan:` line.
Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push
and run what it prints — a plan-file-only change likely triggers none of the
package-scoped checks, but the repo-wide `**` checks (including
`check-plan-headings.sh` and `check-decision-count.sh`) still run against
this file. Do not run the `CI suites` config-key suites locally.

No `scripts/check-shell-lines.sh` concern here — this branch touches no
`.sh` file.

### Bookkeeping

Open the PR through the controller once there's a real commit:
`skills/plot/scripts/plot-open-pr.sh` (or `--draft` while work is still
moving). Do not use `gh pr create`. When the PR exists, append `→ #<number>`
to this branch's line under the plan's (`bitbucket-pr-rows-run-per-row`)
`## Slices` → "Tests and wording" heading — the line starting
`` `docs/one-pr-reader-plan-figures` ``.

### Scope guard

This branch owns exactly one file: `docs/plans/2026-10-23-one-pr-reader-per-machine-and.md`.

Its sibling in this wave, `bug/bitbucket-bind-coverage-and-docs`, owns
`test/reconcile/bitbucket-mergeable.test.mjs`, `test/reconcile/host.test.mjs`,
`packages/domain/test/jenkins-pr-checks.test.ts`, `skills/plot/scripts/plot-host.sh`,
`skills/plot/scripts/README.md`, and doc/comment-only edits in three
`packages/domain/src` files and one `packages/board/src` file — no overlap
with this branch's one file. The three prior-wave branches on the plan this
brief's own parent plan (`bitbucket-pr-rows-run-per-row`) tracks are already
merged into `main`.

Do not edit `feature/one-pr-reader-per-machine-and` or PR #2436 itself — that
branch is someone else's open implementation work, still mid-review with
failing checks. This slice only corrects the prose of the plan that branch
implements; it does not touch the branch, the PR, or any file under
`packages/` or `skills/`.

If, while re-deriving the spender arithmetic or re-checking the Open
Questions against the shipped commits, you find the plan's scope is wrong in
a way bigger than wording (e.g. the implementation diverged from the Design
in a way that changes what "done" means for PR #2436), report it in the PR
rather than expanding this slice to fix it.
