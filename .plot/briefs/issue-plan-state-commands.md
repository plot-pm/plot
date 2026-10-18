## Implementation brief — a-planned-issue-shows-its-plan (wave 2: Lifecycle commands)

- **Plan (canonical):** [docs/plans/2026-10-17-a-planned-issue-shows-its-plan.md](../../docs/plans/2026-10-17-a-planned-issue-shows-its-plan.md) on `main`
- **Approved:** 2026-10-17, Jan Wloka, plan-PR #1985 merged
- **Branch:** `feature/issue-plan-state-commands` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** standard repo PR review

This is the only branch in wave 2 and the plan's last slice. Both wave-1
branches merged 2026-10-18 (#1991, #1992) — nothing blocks this one.

### What to build

Wave 1 built the whole mechanism and wired nothing to it. `Tracker.planStateWrite`
(`packages/domain/src/ports/tracker.ts:350`) exists, `trackerGitHost`'s
`githubPlanStateWrite` (`packages/domain/src/adapters/tracker/tracker-plan-state.ts:67`)
calls `plot-host.sh`'s three new ops (`issue-label`, `issue-comment`, `issue-close`,
all merged and working), and `trackerNone`/`tracker-jira` answer `unaskable`/`no-target`.
**Nothing calls `planStateWrite` yet.** `issue-status.ts`'s `issueStatusWrites`
(`packages/domain/src/rules/issue-status.ts:42`) still only decides `approved`/
`delivered`/`released` *status words* (the Jira path, via `statusWrite`) — it has
no `draft` case and doesn't touch `planStateWrite` at all. The board entry point
`packages/board/src/server/entry/issue-status.ts` only ever calls `tracker.statusWrite`.

This branch wires the four lifecycle commands to the label+comment write:

| Command | Call |
|---|---|
| `plot-idea` step 8 (plan PR opened, `Review: pr` only) | `planStateWrite({ phase: 'draft', planLink: <idea-branch plan URL> })` |
| `plot-approve` step 3 (after approval recorded) | `planStateWrite({ phase: 'approved', planLink: <plan file on default branch> })` |
| `plot-deliver` step 7 (after delivery push) | `planStateWrite({ phase: 'delivered', planLink: <plan file on default branch> })` |
| `plot-release` step 5b (after release record) | `planStateWrite({ phase: 'released', planLink: <plan file on default branch>, version })` — and this call also **closes** the issue (`tracker-plan-state.ts:85` pushes `issue-close` only for `released`) |

Each call is **per issue the plan's `Issue:` line names** — `IssueStatusReading.issues`
already parses this from `plot-plan-meta.sh`'s `issues` field; reuse that, don't
re-derive it. A plan naming no issue makes zero calls, same posture as the
existing status write.

### The decisions the plan settles — do not re-derive them

**This is additive to `issueStatusWrites`, not a replacement for it.** The plan
(Design § Approach) says "extend `issueStatusWrites` … with the draft and
approved phases" — but `issueStatusWrites` answers *status words* (a different
write, `statusWrite`, used only by Jira-style trackers through
`Tracker approved/delivered/released status` config keys). Read the Design table
literally: GitHub gets **no** `Tracker draft status` key — ever — because the
label write doesn't need a configured word; it's the phase name itself
(`planStateLabel`, already in `tracker-plan-state.ts:14`, derives `plan:<phase>`
from the phase alone). Jira has no draft write at all (no label concept) and no
new call for approved beyond what `Tracker approved status` already triggers via
`statusWrite` — `planStateWrite` on Jira answers `no-target` and that's the
expected, unremarkable outcome, not a bug to chase.

So concretely: **extend `issueStatusWrites`'s `approved` branch to also cover
`draft`** (the open question list already settles that `plot-idea` writes and
reports-but-never-blocks on failure, same as the existing writes) — but the
*mechanism* for `draft`/`approved`/`delivered`/`released` as label+comment is
one call to `planStateWrite` per phase, parallel to, not instead of, the
existing `statusWrite` calls that already run at approved/delivered/released for
Jira. Don't merge the two write paths into one function — they're deliberately
separate per the Design note: "`StatusWrite` stays unchanged."

**A failed write is reported and never raised, in every phase** — this was an
explicit open question (plan § Open Questions, decided 2026-10-17): `plot-idea`
follows the exact same rule the delivered/released writes already follow. Don't
add a try/catch that surfaces to the user as a blocking error; thread it through
the same `PortResult` reporting shape `writeStatuses` uses today
(`issue-status.ts:96-114`) — print the outcome line, move on.

**Idempotence is the adapter's job, already done.** `tracker-plan-state.ts`'s
`planStateMarker`/`planStateComment` find-or-edit the one comment per plan slug
(`<!-- plot-plan-state: <slug> -->`) and the label write always *replaces*
(`planStateLabelsToRemove`). Callers don't need their own re-run guards — call
it every time the phase is written, including on a resumed/re-run command.

**The plan link differs by phase, and the plan is explicit about which:** `draft`
(from `plot-idea`) links the plan *on the idea branch* (it has no home on
default yet); `approved`/`delivered`/`released` link the plan file *on the
default branch* (Design § Approach, `plot-approve` row: "the comment changes its
link to the plan file on the default branch"). Don't reuse the idea-branch URL
for later phases — construct each call's `planLink` from where the plan
actually lives at that point in the lifecycle.

**Release closes the issue — this is a new write, not a restoration.** Plot
closes no issue today (Motivation section, `plot-release/SKILL.md:455` currently
says "it closes no issue, creates none and comments on none" — **that sentence
is now wrong and must change** to say the opposite for the plan-state write,
while still being true that it opens nothing new and the *status* write
(`plot-issue-status.sh`) still closes nothing on its own). Similarly
`plot-reconcile-scan.sh:3114`'s advice ("decide: close the issue by hand, or
record why it stays open") is stale once release closes it automatically — update
that line so it doesn't tell a person to do manually what `/plot-release` now does.

**Where each call goes, structurally:**
- `plot-idea` step 8 (`skills/plot-idea/SKILL.md:398-415`): after the draft PR is
  created (the comment needs the PR's branch to exist), call for `draft`.
- `plot-approve` step 3 (`skills/plot-approve/SKILL.md:244`): after the approval
  record lands — this already calls into the plan's state transition; add the
  write alongside it, not before the record is committed.
- `plot-deliver` step 7 (`skills/plot-deliver/SKILL.md:413`), right after (or
  beside) the existing `plot-issue-status.sh` call noted at line 433 — both
  writes happen off the same delivered event, to the same issue, but through
  two different port methods.
- `plot-release` step 5b (`skills/plot-release/SKILL.md:452-455`), same spot the
  existing `plot-issue-status.sh <plan file>` call sits, passing the resolved
  version.

**`Tracker approved status` is a new config key** (Design § Approach: "new
key") — document it in `plot-config.sh`'s key reference comment
(`skills/plot/scripts/plot-config.sh:165,171` list `delivered`/`released`
today; add `approved` beside them) and in `skills/plot/scripts/README.md`'s
`plot-issue-status.sh` row, which currently names only the two existing keys.
This key feeds `statusWrite` (the Jira path) — it is unrelated to whether
`planStateWrite` fires, which happens unconditionally at the `approved` phase
on any tracker that implements it.

### Done when

The plan's `## Done when` isn't written as a separate list in this plan (Status/
Design sections stand in for it) — read the Design § Approach table (line 34-39)
and the Slices line for `feature/issue-plan-state-commands` (line 64) as the
spec: all four commands call the write; release additionally closes the issue
with a version-naming comment; `Tracker approved status` is documented; the two
stale "closes no issue" / "by hand" sentences are corrected.

Lift these assertions because a naive implementation passes without them:
- A plan naming **no** issue makes zero `planStateWrite` calls from any of the
  four commands (parallel to the existing `issueStatusWrites` early return).
- Re-running `/plot-approve` (or any command) on the same plan edits the existing
  comment rather than posting a second — covered by the adapter already, but a
  test should prove the *caller* doesn't itself double-post by calling twice.
- A `failed` outcome from any of the four calls is printed in the command's
  output and does not stop that command's own lifecycle action (the approval/
  delivery/release record is still written even if the tracker write failed).
- `plot-release`'s call passes the actual resolved release version — not the
  plan's slug or an empty string — since `tracker-plan-state.ts`'s
  `planStateComment` only appends the version for `released`.
- On a Jira-configured tracker, all four calls answer `no-target` and every
  command still completes normally (no error surfaced to the operator beyond
  the existing report line).

Plus: run `node ../plot/scripts/board/plot-local-checks.mjs` (path resolved
relative to this skill's directory) before each push, and run what it prints —
it names the tests for whatever file you changed, the related-package tests and
typecheck, and the gate tests and `scripts/check-*.sh` scripts. The suites in
the `CI suites` config key (`pnpm run test:e2e`, `test:contracts`, `test:board`,
domain vitest with coverage, `test/reconcile/*.test.mjs`) run in CI on every PR
— do not run them locally as a matter of course; `test:e2e` especially is CI's
job (see CLAUDE.md § Testing). A changeset is required for this change (bump
`plot`, likely `minor` — new behavior across four skills). `scripts/check-shell-lines.sh`
ratchets the shipped shell's line count against the merge base — this slice is
almost entirely `SKILL.md` prose plus a changeset, so it should touch no `.sh`
file and that gate should be a non-issue; if a shell edit becomes necessary
(e.g. to `plot-issue-status.sh`), its growth must be paid for by removing an
equal number of shell lines elsewhere in the same change.

### Bookkeeping

Open the PR through the controller once the first real commit exists:

```bash
../plot/scripts/plot-open-pr.sh          # on the current branch
../plot/scripts/plot-open-pr.sh --draft  # while work is still moving
```

Never `gh pr create` directly — it mis-titles from the last commit subject and
the gate the plan relies on for PR discovery depends on the controller's title
format. Push the first real commit as soon as it exists, so the branch doesn't
sit silently claimed with no visible work.

When the PR is created, append `→ #<number>` to this branch's line in the
plan's `## Slices` section (`docs/plans/2026-10-17-a-planned-issue-shows-its-plan.md:64`).

### Scope guard

This branch owns:
- `skills/plot-idea/SKILL.md` (step 8 area, ~line 398-415)
- `skills/plot-approve/SKILL.md` (step 3 area, ~line 244-320)
- `skills/plot-deliver/SKILL.md` (step 7 area, ~line 413-433)
- `skills/plot-release/SKILL.md` (step 5b area, ~line 393-455)
- `skills/plot/scripts/plot-reconcile-scan.sh` (the hand-close advice at ~line 3114 only — prose/comment change, not new logic)
- `skills/plot/scripts/plot-config.sh` (key-reference comment only, ~line 165-171)
- `skills/plot/scripts/README.md` (the `plot-issue-status.sh` row's key list)
- A new changeset under `.changeset/`

Both wave-1 branches are merged and gone — nothing else is in flight on this
plan's territory. If you find this branch needs to touch
`packages/domain/src/rules/issue-status.ts`, `packages/board/src/server/entry/issue-status.ts`,
or the tracker port/adapters themselves, that's expected (the `draft` case has
to land in `issueStatusWrites` or an equivalent caller-side decision somewhere,
per "The decisions the plan settles" above) — just keep it to extending what
wave 1 built, not restructuring it.

If you find something the plan did not anticipate, report it rather than
improvising outside scope.
