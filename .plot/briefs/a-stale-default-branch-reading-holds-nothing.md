## Implementation brief — the-channel-closes-its-review-findings (wave 1: Default-branch reading age)

- **Plan (canonical):** docs/plans/active/the-channel-closes-its-review-findings.md on main
- **Approved:** 2026-10-10, Jan Wloka, plan-PR #1497 merged
- **Branch:** `bug/a-stale-default-branch-reading-holds-nothing` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR review, per the plan's `Review: pr`

This is the plan's first wave. Nothing else in the plan touches the files below, so this branch has no slice to wait on. One other branch in a sibling plan reads the same bound this slice introduces — see Scope guard.

### What to build

`defaultBranchRed` (`packages/domain/src/rules/default-branch.ts:104-105`) reads only `reading?.settled?.state === 'red'` and never asks how old the reading is. The caller, `queueWorldForRepo(...).defaultBranchRed` in `packages/fleet/src/server/entry/registryd-main.ts:805-811`, reads `.plot/state/default-branch.json` in every mode and passes the parsed value straight through. Under `--once` nothing refreshes that file first (`defaultBranchWorld` is `null` under `--once`, `registryd-main.ts:1879`), so a red reading written hours or days ago still holds every slice on a one-shot run. Fix: `defaultBranchRed` takes `now` and a `checksWaitMs` bound; a reading older than that bound counts as no reading, so it holds nothing.

Separately, `jenkins_sha_runs` (`skills/plot/scripts/plot-host.sh:1707`) returns every build Jenkins ran for a SHA, oldest and newest mixed, and `foldRuns` (`default-branch.ts:56-61`) tests red first — so an old failed build #41 and a green rebuild #42 of the same SHA fold to red forever. Fix: keep only the newest build per SHA before folding. GitHub Actions already keeps one run id per re-run, so `build-github.ts` (or wherever the GitHub side lives) needs no change — this is a Jenkins-only fix.

Two smaller gaps ride along: the `unaskable` outcome in `default-branch-refresh.ts:86` has no test, and `PENDING_CONCLUSIONS` (`default-branch.ts:10`) is missing three GitHub statuses (`waiting`, `requested`, `pending`) that currently fold to `unknown` instead of `pending`.

### The decisions the plan settles — do not re-derive them

**The bound is `Checks wait`, not a new config key.** The open question in the plan ("which bound ends a reading's hold — `Checks wait`, or a multiple of the `prs` beat?") is answered: use `Checks wait` (3600s in this repo's `## Plot Config`), and the bound must exceed the loop's re-ask interval or a live red reading could expire between asks. `the-controllers-close-their-review-findings`'s merge controller (on `bug/the-merge-reads-what-it-claims`) reads this same bound from the same `rules/default-branch.ts` value — so the age check belongs in the domain rule, not duplicated in the fleet caller, and the two branches must not both add a different age threshold.

**Reuse `readingAge` if the shape fits — don't write a second age helper.** `packages/domain/src/entities/identity.ts:102` already has `readingAge<T>(sample: Reading<T>, now: number): number`. `DefaultBranchReading` (entities/default-branch.ts) isn't wrapped in a `Reading<T>` envelope today — it carries its own `askedAt: string` (ISO-8601) rather than a `measuredAt: number` (epoch ms). Check whether wrapping or adapting is cheap before writing a parallel age calculation; `ageInWords` (`default-branch.ts:136-144`) already does its own `Date.parse` arithmetic for the same field, so a third ad-hoc age calculation in this one file would be the wrong direction.

**The Jenkins fix's location is still open — the plan names the tradeoff and leaves it to you.** Fix `jenkins_sha_runs` in `plot-host.sh`, or fix `build-jenkins.ts` on the adapter side. The adapter keeps the shell smaller, which `scripts/check-shell-lines.sh` rewards (see Done when). Decide based on where "newest build per SHA" reads most naturally — this is implementation judgment the plan deliberately didn't settle.

**`CLAUDE.md` names this file's exception, by design.** `CLAUDE.md`'s "One Answer To 'Did This Land'" section (`:485-487` as cited in the plan; search for "Answers, never verdicts") states the index holds bought answers, never verdicts — except `.plot/state/default-branch.json`, which is explicitly called out as the one hold that reads a non-terminal (`red`, not just `MERGED`) answer, because the next settled-green reading reverses it. #1463 L4 asks you to add language stating this file holds a verdict and why that's safe. Don't treat this as removing the exception or making the file conform to the "answers never verdicts" rule — it's the opposite: document why this file is the sanctioned exception. After editing, run `./scripts/check-agents-md.sh --write` (CLAUDE.md is the source; AGENTS.md is generated from it and a diverging mirror fails CI).

**Carried-over invariant: absent is not false.** A missing, unparseable or wrong-version `default-branch.json` file already means "no reading, hold nothing" (`registryd-main.ts:805-811`'s `held.ok` check). The age fix adds a second way to reach "no reading" (too old) — make sure both paths produce the same `false` from `defaultBranchRed`, not two different falsy shapes that a later refactor could tell apart incorrectly.

### Done when

The plan's `## Done when` is implicit in its per-finding list (`#1463 M1, M3, L1, L2, L4`) — treat each bullet under "Slice 1" in the plan's Design section as a checklist item:

- `defaultBranchRed` ignores a reading older than `Checks wait`. Add a test with a settled-red reading whose `askedAt` is older than the bound — confirms the fix actually changes behavior, since every existing test passes `now` close to `askedAt` today.
- Jenkins keeps the newest build per SHA before folding. Add a test fixture with an old `FAILURE` build and a newer `SUCCESS` build of the same SHA — the naive "take runs as given" implementation passes every existing test and fails only this one.
- `PENDING_CONCLUSIONS` gains `waiting`, `requested`, `pending`.
- The `unaskable` arm in `default-branch-refresh.ts` gets a test (none exists — `grep unaskable packages/fleet/test/unit/default-branch-refresh.test.ts` returns nothing today).
- `CLAUDE.md` states this file's verdict exception, and `./scripts/check-agents-md.sh --write` leaves `AGENTS.md` in sync.

Plus the repo's standing gates: a changeset (`plot` package, patch — this is a bug-fix touching plan-cited issues, not a new skill section) with the description first and `bumps:` block last, naming `plan: docs/plans/active/the-channel-closes-its-review-findings.md` optionally. Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints — it resolves the exact test/typecheck/gate commands for the files you actually changed (`packages/domain/**`, `packages/fleet/**`, `skills/plot/scripts/plot-host.sh` if you touch it). The `CI suites` key's full suites (`test:e2e`, `test:contracts`, `test:board`, domain coverage) run in CI only — do not run them locally as a matter of course.

If you touch `plot-host.sh`: `scripts/check-shell-lines.sh` refuses a PR whose shell under `skills/` grew past its merge base. If the Jenkins fix lands in the shell rather than the adapter, it costs lines there with nothing to offset them — prefer the `build-jenkins.ts` adapter side unless there's a concrete reason the shell needs the fix (e.g., the dedup is naturally expressed in the `jq` pipeline already filtering the Jenkins REST response).

### Bookkeeping

Push the first real commit as soon as it exists. Open the PR through the controller once ready:

```bash
skills/plot/scripts/plot-open-pr.sh          # on this branch
skills/plot/scripts/plot-open-pr.sh --draft  # while still moving
```

Do not run `gh pr create` — it reads the plan's wave heading for the PR title and this branch for the review-findings annotation; a hand-made PR title loses that. Once the PR number exists, append `→ #<number>` to this branch's line under `### Default-branch reading age` in the plan's `## Slices` section.

### Scope guard

This branch owns: `packages/domain/src/rules/default-branch.ts`, `packages/domain/src/entities/default-branch.ts` (if the `Reading<T>` question above needs a shape change), `packages/fleet/src/shared/default-branch-refresh.ts`, `packages/fleet/src/server/entry/registryd-main.ts` **lines 805-811 only**, either `skills/plot/scripts/plot-host.sh` or `packages/domain/src/adapters/build/build-jenkins.ts` (pick one per the open question above), `CLAUDE.md` and its generated `AGENTS.md`, and these files' own tests.

**`registryd-main.ts` is shared territory — touch only 805-811.** The plan's next wave, `bug/the-fleetd-wiring-has-tests` (slice 3), extracts the `prs` beat and desk relay from this same file and explicitly runs after slices 1 and 2 because both touch it. Leave everything else in `registryd-main.ts` alone, including the `indexMonitorOver`, `deskRelayOver` and `prs` beat code near lines 1679-2046 — that's slice 3's territory, not yours, even though it's the same file.

The sibling plan `the-controllers-close-their-review-findings` has a branch `bug/the-merge-reads-what-it-claims` reading the same `Checks wait` bound from `rules/default-branch.ts` — if that branch is in flight concurrently, coordinate on the exact signature of whatever age-aware function you add (`defaultBranchRed(reading, now, checksWaitMs)` or similar), since both callers need to agree on it.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
