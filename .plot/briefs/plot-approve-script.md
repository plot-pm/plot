## Implementation brief — approve-needs-no-agent, wave 1 (Script)

- **Plan (canonical):** `docs/plans/2026-08-17-approve-needs-no-agent.md` on `main`
- **Approved:** 2026-08-17, jwloka, plan-PR #163 merged (four interrogation rounds)
- **Branch:** `feature/plot-approve-script` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR review per repo convention; CI `validate` must pass

### What to build

`plot-approve.sh` — the mechanical half of approving, as a script the board can
call directly. And `plot-approve/SKILL.md` calls it instead of describing it.

The question that produced this: *if you can approve a plan, why can a button
not?* Measured — `Start work` calls `plot-dispatch.sh`, a script Plot ships, and
works out of the box. `Approve` spawns `<Approve command> "<prompt>"`, needs an
agent, and renders disabled without config. **The difference is not that
approving needs an agent; it is that approving has no script.**

### Seven steps, not five

The first draft of the plan listed five and missed two. All seven are writes
with no decision in them:

| # | Step | Uses |
|---|---|---|
| 1 | Read `Review:` / `Impl:` and the PR state | `plot-plan-meta.sh`, `plot-host.sh pr-state` |
| 2 | **Merge the plan PR** | `plot-host.sh pr-merge` |
| 3 | Flip `**Phase:** Draft` → `Approved` | awk |
| 4 | Fill the `Approved:` record | awk |
| 5 | Clear `.plot/hold` for the plan's branches | awk |
| 6 | Update the sprint annotation | awk |
| 7 | Commit and push | `plot-push-main.sh` |

**Five of seven would be a half-approval**, which is worse than none: an
approval leaving the hold in place still blocks, and one skipping the annotation
makes `/plot-sprint status` wrong.

### Six decisions the plan settles — do not re-derive them

**Almost nothing here is new.** `plot-host.sh` already has `pr-state`,
`pr-merge`, `default-branch`. `plot-push-main.sh` already performs the
protected-branch push **and reports what happened to it** — `clean`, `bypassed`
(naming the waived rules and the checks that did not run), or `unknown`. A bare
`git push` cannot say that: a protected-but-unenforced repo waves the push
through with exit 0 and only a stderr notice. And `plot-dispatch.sh:423`'s
`append_started_line()` is the awk pattern for steps 3–4 — same Status block,
same shape, and it was repaired on 2026-08-17 after appending below `Delivered:`
instead of filling the placeholder. **Read that function before writing yours.**

**IT MUST BE IDEMPOTENT.** Step 2 writes irreversibly to GitHub and everything
after it is local, so an interruption strands a merged PR against a `Draft`
plan — the state the skill names as never to allow. The skill already contains
the answer: *"Already merged: the approval already happened — skip to step 4 to
make sure it's recorded."* So `plot-approve.sh <slug>` may run any number of
times, and **re-running is the repair** for every interruption.

Each step tests the source it would have written — `pr-state` for the merge,
`plot-plan-meta.sh` for the phase and record, the hold file, the annotation.
**Never a progress file of its own:** that is a second source of truth which
disagrees with the repository exactly when someone intervened by hand between
runs, which is the case it would exist for. Git and the files **are** the state
(Principle 1).

Reordering to put the merge last was considered and rejected: it trades a
recoverable half-state for a lying one — the plan would read `Approved` while
its PR is still open, and the `Approved:` record would name an unmerged PR.

**The hold is keyed by BRANCH, not by plan.** `plot-phase-gate.sh:121` matches
`$1 == b` against the branch name, and a plan names several branches. Read the
plan's `## Branches` section and clear the entry for each. **Entries for
branches this plan does not name stay** — approving one piece of work must not
release someone else's gate. There is no `.plot/hold` in this repo at all, so
the absent path is the common one; handle it anyway.

**It must survive the repo's own gate.** `plot-phase-gate.sh` is a PreToolUse
hook that blocks commits *while the governing plan is Draft* — and this script
commits exactly then, because rewriting the phase **is** the transition. The
gate lets plan-file-only commits through, so this should work; the `Done when`
list turns that assumption into a check.

**Three refusals, each checkable without judgement:**

- **Phase is not `draft`** — nothing to approve.
- **`Review:` is not `pr`** — `in-session` and `ballot` need a human in the
  room. Measured: **every plan in this repo declares `Review: pr`**, so this
  fires for nothing that exists today, and it is still load-bearing. A script
  treating an unfamiliar `Review:` as `pr` would approve a plan nobody discussed
  — silently, with a commit indistinguishable from a legitimate one.
- **The PR is a draft, closed, or absent** — the existing preconditions, moved
  from prose into an exit code.

Refusing is the script's job; **explaining is its output**. The board surfaces a
failing command's own words on the card (#161), so a refusal reaches the reader
without the board learning the rules.

**The skill calls the script — there is no second path.** `Approve command`
survives as a demoted option: with it set, board → agent → `SKILL.md` →
`plot-approve.sh`; without it, board → `plot-approve.sh`. **One implementation
of the mechanics, two entrances.** Otherwise demotion reintroduces the
duplication this plan removes, as a configuration option.

### Done when

The plan's `## Done when` list is the specification. The assertions that exist
because a weaker implementation passes without them:

- **A board with no `Approve command` can approve.** Assert against this repo's
  own config, which declares none — the state that produced the question.
- **The script refuses a Draft-phase plan, `Review: in-session` and
  `Review: ballot`**, each with its reason reaching the caller.
- **`Approved:` fills the placeholder rather than appending after the list.**
  Assert the line lands above `Delivered:` — `append_started_line()` had exactly
  this bug, and a second implementation would repeat it.
- **The `.plot/hold` entry for EACH branch the plan names is removed**, and a
  third unrelated entry stays. A missing hold file is not a failure.
- **The sprint annotation is updated**, and a plan in no sprint is a no-op
  rather than an error.
- **The push reports `clean` / `bypassed` / `unknown` verbatim** and falls back
  to a micro-PR under branch protection.
- **A second run after a completed one changes nothing and fails nothing.**
- **A run interrupted between the merge and the push is repaired by re-running
  it.** Assert the exact half-state — PR merged, plan still `Draft` — reaches
  Approved on the second run. A test that only re-runs a *successful* approval
  passes without this.
- **The script commits successfully while `plot-phase-gate.sh` is active and the
  plan is still Draft** — the state it always runs in.
- **The skill still owns what it judges**: the tracer heuristic, the ceremony
  questions and the `in-session` walkthrough are unchanged. This moves a
  mechanism, not a decision.

Plus: `pnpm run test:reconcile`, `pnpm run test:board`, `pnpm run typecheck`,
`pnpm run validate` all pass; a changeset is present. macOS bash 3.2 — **no
`declare -A`**.

Bump the `metadata.version` of every skill you change, and the plugin version in
all three metadata files. Update the `## Model Guidance` table of any skill
whose steps you change.

### Bookkeeping

When the PR is created, append `→ #<number>` to this branch's line in the plan's
`## Branches` section on `main`. **Push your first real commit as soon as it
exists.**

### Scope guard

`skills/plot/scripts/plot-approve.sh` (new), `skills/plot-approve/SKILL.md`,
their READMEs, and the skill/plugin version metadata.

**Do NOT touch `packages/board/`.** The board half — dropping the
`Approve command` requirement from `approveAvailability()` and moving
`ApproveButton` off the native `disabled` attribute — is wave 2
(`bug/approve-button-needs-no-config`), which rebases onto you.

**Two other branches are in flight**, both with open PRs: #166
(`bug/test-boards-die-with-their-run`) and #167
(`feature/dispatch-reports-no-worker`). The second edits
`skills/plot-dispatch/SKILL.md` and `plot-dispatch.sh` — **you read
`append_started_line()` from that file but must not change it.**

**Note on CI:** this repo saw two flaky failures tonight on branches containing
no code, both in suites that start real servers on real ports. If CI fails on a
test you did not touch, check whether it passes locally before assuming you
caused it — and say so in your report.

If you find something the plan did not anticipate, report it rather than
improvising outside scope.
