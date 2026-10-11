## Implementation brief — the-gates-are-launchers (wave: the state gate)

- **Plan (canonical):** `docs/plans/2026-10-10-the-gates-are-launchers.md` on `main`
- **Approved:** 2026-10-10, Jan Wloka, plan PR #1494 merged
- **Branch:** `feature/the-state-gate-is-a-launcher` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** pr

Two waves of this plan are merged: the scaffold and bundle-commit gate
(PR #1520), and the brief-name gate (`the-brief-name-gate-is-a-launcher`, PR
#1529). `GATES` in `packages/board/src/server/entry/gate.ts` currently holds
two rows, `bundleCommitGate` then `briefNameGate`, in that order. This wave
adds the third. The decision-count ratchet (`scripts/check-decision-count.sh
pr`) currently reads **50 at merge base, 50 now** — confirm against your own
branch's merge base before you push, but the plan's target for this wave is
**50 → 49**, and your PR's diff is what has to carry that -1. The controller
gate (`feature/the-controller-gate-is-a-launcher`, 49→48) and the phase gate
(`feature/the-phase-gate-is-a-launcher`, 48→47) are both unclaimed siblings —
not in flight, nothing to collide with yet.

### What to build

Convert `skills/plot/scripts/plot-state-gate.sh` (218 lines) into a launcher
that `exec`s `board/plot-gate.mjs` with the gate name `state`, mirroring
`plot-brief-name-gate.sh` and `plot-bundle-commit-gate.sh` exactly. The
decision — refuse a commit that **changes** a `State:`/`Phase:` line in a
plan or sprint file's `## Status` section unless a matching receipt clears
it — moves into a new pure rule, `stateTransitionRefusal`
(`packages/domain/src/rules/state-transition.ts`), registered as the third
row in `gate.ts`'s `GATES` table, right after `briefNameGate`.

This is the one gate in the plan that needs new domain infrastructure beyond
a rule file: `effectivePaths` (what a `git commit` will actually carry) and a
receipt-spend operation (read-compare-and-delete against
`.plot/state/state-receipts/`). Neither exists in TypeScript yet — the
**write** side already does (`entry/ladder.ts`'s `recordStateReceipt`,
exercised against the shell by `packages/domain/corpus/state-receipt.corpus.test.ts`),
but that corpus test only proves the two sides write identical bytes. Nothing
reads or spends a receipt from TypeScript today; that's new, and it's this
wave's main work.

### Decisions already settled — do not re-derive them

**`effectivePaths` must reproduce the shell's four-source union, not just
read the index.** `plot-state-gate.sh:78-97`'s `effective_paths()` combines:
staged paths (`git diff --cached --name-only`); unstaged modified files when
the command carries `-a`/`--all`/`-am` (`git diff --name-only`); and, when the
command string contains `git add`, a hand-parse of every `&&`/`;`/`|`-chained
`add` segment, resolving `-A`/`--all`/`-a`/`.`/`-u`/`--update` tokens via
`git status --porcelain` and literal path tokens directly. This exists because
`git add -A && git commit -m x` stages **after** the hook fires — the index
alone is not what the commit will contain. `state-gate.test.mjs`'s "a commit
that stages for itself is still read" is the test that would fail silently if
you read only `Refs.stagedPaths()`. Build this the same way `briefNameRefusal`'s
`ask()` already composes `Refs.untrackedPaths`/`Refs.showPrefix` for the
chained-`git add` case in the brief-name gate — same problem, same port
methods, same reason.

**The receipt-spend operation is a NEW primitive — it is not
`recordStateReceipt` read backwards.** The shell's `receipt_clears(rel_path,
staged_value)` (`plot-state-receipt.sh`) reads the file at
`.plot/state/state-receipts/<oid>` where `oid = gitBlobOid(relPath)`
(reuse the already-exported `gitBlobOid` from `entry/ladder.ts` — do not
reimplement the hash a third time), compares its stored value against the
value being staged, and **deletes the file on a match** — one approval
licenses exactly one commit (`state-gate.test.mjs`: "a receipt is spent when
it clears" asserts the *second* commit against the same receipt is refused).
A receipt for a different value does not clear and is not spent (same file:
"a receipt for another value does not clear"). No existing port covers
`.plot/state/` — this needs a new port method (or a new small port) and an
adapter that does the filesystem read+delete. Keep the read+compare+delete as
one atomic port operation (matching the shell's one function) rather than
splitting read from delete across two calls — two calls invites a caller that
reads, decides, and forgets to spend.

**The named escape (`--unowned`) must clear identically to an owner's
receipt.** `plot-approve.sh` step 3b (`Review: in-session`/`ballot`),
`plot-release` writing `Released`, and `plot-reject` running the lifecycle
backwards have no owning script; `plot-state-receipt.sh --unowned <path>
<value> <reason>` writes the exact same receipt format plus a line to
`.plot/state/unowned-state-writes.tsv`. Your receipt-spend operation must not
special-case or exclude escape-written receipts — the file on disk is
byte-identical to an owner's, and the gate rule can't tell (and must not try
to tell) the difference. Four tests in `state-gate.test.mjs` cover this
("the named escape clears a write no script owns", "...records the gap it
names", "...refuses without a reason", "...is spent like any other receipt")
— the refusal-without-a-reason case and the TSV logging stay in the shell
(`plot-state-receipt.sh` itself is explicitly out of scope for this slice);
only the read+spend path needs a TS equivalent.

**`state_value()` is scoped to the `## Status` section — do not read the
first `State:` line in the file.** Several plans quote a status block in
their prose to illustrate the format; `plot-approve.sh:358`'s own reasoning
applies here. The shell's `awk` tracks which `## ` heading it's under and
only matches inside `status`. `state-gate.test.mjs`'s "a State line outside
the Status section is prose" is the regression test for this — reproduce the
section-scoping, not a bare regex over the whole file. Reads both `State:`
and legacy `Phase:` keys (pre-2026-09-07 plans still carry the old name).

**Four-way skip logic, in this order, all pure in the rule:** (1) no `HEAD`
version of the file → **creation**, not an edit, always passes (a plan or
sprint written from a template carries its opening state) — read via
`Refs.showFile('HEAD', path)` returning absent/error, never from
`StagedPath.status`, which has no `deleted`/`created` discriminator and
wouldn't tell you what `HEAD` held anyway; (2) no `State:` value in the
staged content → a **deleted** line is not a transition, passes; (3) before
== after → **unchanged**, passes (the common case — a plan gains a `Started:`
line or a Notes paragraph on nearly every commit, and the state line rides
along in the diff hunk); (4) only then is it a transition, and only then does
the receipt get asked.

**Plan-vs-sprint slug cutting is asymmetric, and getting it wrong only shows
up in the refusal text.** A plan is `YYYY-MM-DD-<slug>.md` (cut 3 dash-tokens);
a sprint is `YYYY-Www-<slug>.md` (cut 2). `slug_of()` at
`plot-state-gate.sh:168-175` calls this out as "measured while writing this
gate's test" — using the plan's cut count for a sprint turns `2026-W01-s`
into the whole basename, and the refusal then names a command (`/plot-sprint
2026-W01-s …`) that nothing answers to. `owning_command`/`sprint_verb` (lines
130-157) are straightforward value→command string maps; port them as pure
functions alongside the slug logic, keyed the same way.

**Fail-open on machinery, fail-closed on a seen transition — this asymmetry
is the point of the gate, not a bug to smooth over.** No git, unreadable
`HEAD`, unparseable hook JSON → allow, same as the phase gate. A transition
the rule *can* see with no clearing receipt → refuse. Don't let `onError:
'allow'` in `gate.ts` swallow a legitimately-detected refusal; that error
boundary is only for the rule's own machinery failing, same contract as
`bundleCommitGate`/`briefNameGate`.

### Done when

The plan's `## Done when` list is the specification. Lift these assertions
from `test/reconcile/state-gate.test.mjs` because a naive port would pass
without them: creation-not-transition for both a new plan and a new sprint;
unchanged-State-line-passes-while-rest-of-plan-changes (the dominant real
case); State-line-outside-Status-section-is-prose; deleted-State-line-is-not-
a-transition; stages-for-itself-via-chained-git-add; Approved→Delivered names
`/plot-deliver` and not `/plot-approve` (the owning-command map, not just
"some command"); a hand-written sprint transition names `/plot-sprint <slug>
<verb>` with the correct verb; a state no lifecycle admits is still refused
by name (the gate judges the WRITER, not the word); the receipt clears once
and is spent on the second commit; a receipt for another value does not
clear; the named escape clears identically to an owner's receipt.

The existing shell test file stays as the gate's contract test (it spawns
`plot-state-gate.sh` directly and must keep passing once that script is a
7-ish-line launcher) — write the new TypeScript unit tests for
`stateTransitionRefusal`/`effectivePaths`/the receipt-spend port alongside it,
not instead of it.

Plus: register `state` as the third `GATES` row in `gate.ts`. Drop
`plot-state-gate.sh`'s own entry from `hooks/hooks.json` (currently line 13,
`"${CLAUDE_PLUGIN_ROOT}/skills/plot/scripts/plot-state-gate.sh"`, immediately
after the phase gate's and before the controller gate's) — it's superseded by
the shared `plot-gates.sh state` dispatch the way the brief-name and
bundle-commit gates already are. Re-run `plot-install-hooks.sh --verify` to
prove the launcher still answers through the real hook path. Update
`skills/plot/scripts/README.md`'s `plot-state-gate.sh` row: `Kind` from
`decision` to `launcher`, `Replaced by` to `board/plot-gate.mjs`, and the
description to the "Launcher only, since `the-state-gate-is-a-launcher`"
phrasing the two merged rows already use (see their rows for the exact
shape — name where the decision now lives, what it still refuses, and that a
missing bundle allows and prints UNVERIFIED). Run
`node skills/plot/scripts/board/plot-local-checks.mjs` before each push and
run what it prints; the suites in the `CI suites` config key run in CI.

Name the shell-lines ratchet in the same breath: `scripts/check-shell-lines.sh`
refuses a PR that grows total shell line count under `skills/` versus the
merge base. This conversion should net-reduce it substantially — the
brief-name gate went from 185 shell lines to about 7 — so you have headroom
in this change, not a budget to spend elsewhere.

A new corpus test is needed: the state-receipt corpus file already proves
entry-write and shell-write agree on bytes, but nothing yet proves a TS
read+spend agrees with `receipt_clears`. Add that comparison to
`state-receipt.corpus.test.ts` (or a sibling file next to it) following its
own pattern — neither side authoritative, a disagreement stops the branch
rather than being adjusted away, named via `describingAs` with `rule=`/`shell=`.

### Bookkeeping

Open the PR through the controller, never `gh pr create`:

```bash
skills/plot/scripts/plot-open-pr.sh          # the current branch
skills/plot/scripts/plot-open-pr.sh --draft  # while the work is still moving
```

When the PR is created, append `→ #<number>` to this branch's line under the
plan's `## Slices` section, on `main`. Push the first real commit as soon as
it exists.

### Scope guard

**Owned by this branch:** `skills/plot/scripts/plot-state-gate.sh` (becomes
the launcher); a new `packages/domain/src/rules/state-transition.ts` and its
unit test; the receipt-spend port/adapter addition (new port method or new
small port, plus adapter) and its corpus-test pair; the new third row in
`packages/board/src/server/entry/gate.ts`'s `GATES` array; the one dropped
line in `hooks/hooks.json`; the `plot-state-gate.sh` row in
`skills/plot/scripts/README.md`.

**Not owned here, and not touched:** `plot-state-receipt.sh` itself (the
shell receipt writer/escape stays as-is — out of scope per the plan); the
separate action-receipt mechanism in the same file (`record_action_receipt`,
`action_receipt_clears`, used by the controller gate's still-unclaimed
sibling branch, a different question entirely — don't conflate the two); the
already-merged `bundleCommitGate`/`briefNameGate` rows; the controller gate
(`feature/the-controller-gate-is-a-launcher`) and phase gate
(`feature/the-phase-gate-is-a-launcher`) branches, both unclaimed as of this
writing — verify at dispatch time, not from this brief, if that has changed.

If you find something the plan did not anticipate, report it rather than
improvising outside scope.
