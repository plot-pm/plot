## Implementation brief — parallel-release-calls-exhaust-their-push (wave 5: Release outcomes)

- **Plan (canonical):** docs/plans/2026-10-28-parallel-release-calls-exhaust-their-push.md on main
- **Approved:** 2026-10-28, Jan Wloka, plan-PR #2816 merged
- **Branch:** `docs/release-step-5b-reads-each-outcome` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention — PR review (`Review: pr`)

This is the last of five slices and is docs-only: it describes the behaviour
slices 2 and 3 implement, so it should merge after both. As of this brief,
slices 1–4 (`bug/booking-branches-carry-no-upstream`, `bug/the-push-lock-
spans-the-booking`, `bug/one-release-job-per-plan`,
`bug/shared-issue-reads-the-post-push-tree`) are `Started:` but none has
pushed a branch yet (no remote ref for any of the five slice branches as of
this writing) — check `gh pr list` / the plan's `→ #N` annotations before you
start, because this slice's text describes APIs those slices are about to
change under you.

### What to build

Update `/plot-release` step 5b (`skills/plot-release/SKILL.md`, "5b. Record
the Release in the Plans", currently lines 430–489) so that after sending one
`POST /api/release` (or `plot-deliver.sh --release`, via the controller-gate
receipt path on the no-board side) call per plan, it reads back each plan's
real outcome instead of just counting calls sent. Concretely:

- For a board-run sweep: call `GET /api/release/<slug>` per plan
  (`packages/board/src/server/index.ts:766`, handler `releaseStatus` in
  `packages/board/src/server/release.ts:89`). That already returns
  `{ state: 'unknown'|'running'|'done'|'failed', message, log }` — `message`
  is the log's last lines (`lastLines`, `release.ts:82`) and is already
  exactly the text you want to print per failed plan. Poll until every plan
  reaches `done` or `failed` (the route answers 202 and returns before the
  script finishes — same shape `/api/approve/<slug>` already uses, so follow
  whatever polling idiom step 4 or `/plot-approve` already uses for that
  route, don't invent a new one).
- For the no-board path (`plot-deliver.sh --release <version> <slug>` run
  directly): read the bundle's own exit code and its `summary:` footer line
  (the convention named in `skills/plot/scripts/README.md` for every bundle
  of this shape) rather than assuming success because the call returned.
- Print **one line per plan that did not release**, carrying that plan's own
  message/summary — not a bare count. A sweep where 3 of 53 plans failed
  should name those 3 slugs and what each one said, not just "50 released."

### The decision this slice settles — do not re-derive it

**Drop the false claim at `SKILL.md:451`** ("the route the board's own
button calls"). `release.ts:17` states explicitly: *"It has NO AGENT ARM,
unlike `/api/deliver`... So this route calls the SCRIPT directly."* There
is no board button wired to `POST /api/release` — it exists only for
`/plot-release` step 5b itself to call. Re-wording that sentence (to
something like "the route this step calls directly") is part of this
slice's done-when, not a drive-by cleanup: the plan's Design section names
dropping this claim as one of the five slice's explicit jobs ("It drops the
claim at `SKILL.md:450-451` that a board button calls the route").

**Why read-back instead of a count:** the whole plan exists because a count
of calls sent told the operator nothing about outcomes. The 2026-10-28
incident (Motivation section) was 53 POSTs where 24 jobs failed after
exhausting retries and 18 more were unaccounted for because per-call log
truncation destroyed the evidence (`release.ts:166-167`, fixed in slice 3).
A step 5b that only counts "N calls sent" reproduces exactly that blindness
even after slices 1–4 make the calls themselves safe to run in parallel —
this slice is what turns "safe to run in parallel" into "and you can see
what happened."

**It states that back-to-back calls are safe.** Once slices 1–4 land, say so
plainly in the step's prose — that's new text this slice adds, not just the
read-back mechanism.

### Done when

The plan's `## Done when` has no dedicated list; the relevant line from
`## Changelog` is the spec: *"`/plot-release` prints one line per plan that
did not release, with the reason from that plan's job."* Concretely:

- Step 5b's text in `skills/plot-release/SKILL.md` reads each slug's outcome
  (via `GET /api/release/<slug>` or the bundle's exit code + `summary:`
  line) rather than only counting POSTs sent.
- A failed plan's line in the output carries that plan's own message/reason,
  not a generic "failed" with no detail.
- The false claim that a board button calls `POST /api/release` is removed
  from `SKILL.md:450-451` (or wherever it lands after your edit).
- Per the plan's own test note for this slice: **"skill text; checked in the
  manual lifecycle walkthrough with at least 5 plans."** There is no
  automated test for this slice — validate by reading the updated prose
  against the actual `releaseStatus` return shape in `release.ts`, and if
  practical, a manual walkthrough per `skills/plot-release/README.md`'s
  documented test runs.

Plus the repo's standing gates: run
`node skills/plot/scripts/board/plot-local-checks.mjs` before each push and
run what it prints — the suites named in the `CI suites` config key run in
CI, not here. This slice touches only a `.md` file, so `plot-local-checks.mjs`
is likely to print little or nothing beyond the repo-wide `**` checks; run it
anyway rather than assuming.

**Shell-line gate:** `scripts/check-shell-lines.sh` refuses a PR whose shell
under `skills/` grows past its merge base. This slice is prose-only (a
`SKILL.md` edit), so it should not touch this gate at all — flag it if your
diff somehow adds shell.

### Bookkeeping

Open the PR through the controller once you have a first commit:

```bash
../plot/scripts/plot-open-pr.sh          # or --draft while still moving
```

Do not run `gh pr create` by hand. Once the PR exists, append `→ #<number>`
to this branch's line in the plan's `## Slices` section, under "### Release
outcomes":

```
- `docs/release-step-5b-reads-each-outcome` — step 5b reads `GET /api/release/<slug>` per plan and prints one line per failed plan; the false board-button claim goes → #<number>
```

Push your first real commit as soon as it exists — don't hold a prose change
back waiting for a "final" draft.

### Scope guard

**This branch owns:** `skills/plot-release/SKILL.md` (step 5b's text,
roughly lines 430–489 as currently numbered — line numbers will drift once
slices 2/3 land, so locate by heading "5b. Record the Release in the Plans"
rather than by line number).

**Other branches in flight on this plan** (per the plan's `## Slices`
section — verify against `gh pr list` / remote refs at dispatch time, since
none had pushed as of this brief):

- `bug/booking-branches-carry-no-upstream` (slice 1) — `trees-git.ts`
  `addBranch`/`resetBranch`, `--no-track`. No file overlap with this slice.
- `bug/the-push-lock-spans-the-booking` (slice 2) — `ladder.ts`,
  `plot-push-main.sh`, `plot-push-lock.mjs`. No file overlap, but this
  slice's prose describes slice 2's behaviour (the lock span, exit 6, the
  no-progress wait) — if slice 2's actual shipped behaviour differs from the
  plan's Design section by the time you write this slice's prose, describe
  what slice 2 actually shipped, not what the plan proposed.
- `bug/one-release-job-per-plan` (slice 3) — `release.ts`'s POST handler
  (refusing a second concurrent call). This is the slice most likely to
  change `release.ts` under you; re-read it before describing `releaseStatus`
  behaviour if it has merged by the time you start.
- `bug/shared-issue-reads-the-post-push-tree` (slice 4) — `deliver.ts`'s
  sibling-issue read. No overlap with this slice's file.

The plan's own ordering note: "Slices 1, 3 and 4 touch separate files and
can merge in any order... Slice 5 describes the behaviour of slices 2 and 3
and merges last." Confirm slices 2 and 3 have actually merged (or at least
settled their final shape) before finalizing this slice's prose — if they
haven't, you may be documenting behaviour that is still moving.

If you find something the plan did not anticipate, report it rather than
improvising outside scope.
