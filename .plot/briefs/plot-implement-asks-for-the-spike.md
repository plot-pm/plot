## Implementation brief — board-readings-take-the-domain-answer (wave: Spike implement)

- **Plan (canonical):** `docs/plans/2026-11-21-board-readings-take-the-domain-answer.md` on main, Design › Slice 6
- **Approved:** 2026-11-21, Jan Wloka, plan-PR #3613 merged
- **Branch:** `bug/plot-implement-asks-for-the-spike` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR review (`Review: pr`)

This is the last slice of the spike wave. It waits on no unmerged branch: `licensedSpike` already exists (`packages/domain/src/rules/spike.ts`), and slices 3 to 5 of the wave change other files.

### What to build

`/plot-implement` decides the approved spike of a Design plan in skill prose (`skills/plot-implement/SKILL.md:71`): the agent reads `spike_approved_raw` and each branch's `spike` flag and applies the rule by hand. Four spike readers decided this outside `licensedSpike` (#3122), and the skill prose is the one a master agent runs. Replace the prose with one bundle question.

Add `plot-ask.mjs spike <slug>`. `questionFrom` (`packages/board/src/server/entry/main.ts`, the `board`/`fleet`/`deliverable` line) stays as it is for the three questions it admits; `release-claim`, `merge`, `release-approve` and `repair-pr` are separate `argv[0]` branches in `run`, and `spike` is a fifth beside them. It reads the plan through the plan store and answers from `spikeBranchOfRecord` (`packages/board/src/server/entry/gate.ts:590`), which wraps `licensedSpike(record.spikeApprovedRaw, record.slices)`. Reuse it. Do not call `licensedSpike` with a second parse.

| Answer on stdout | Exit |
|---|---|
| `licensed <branch> <record date>` | 0 |
| `unlicensed <reason> <record date or ->` | 1 |
| `unaskable <why>` (no plan, or a plan that does not read) | 2 |

The record date is the first comma-separated field of `Spike approved:`. `-` stands where the record is absent (`spike-record-absent`) or has no date.

Then edit `skills/plot-implement/SKILL.md`:

- **`:71`** replaces the prose rule with the call. The stop message for an unlicensed record names the reason and `plot-approve-command.mjs --spike --who <handle> <slug>`. It never names `plot-approve.mjs`, which the controller gate refuses with no receipt.
- **`:87`** keeps the age reading and takes the date from the answer's third field.
- **`:49`**, the Model Guidance row for step 1, names the call.
- Add a changeset that bumps `plot-implement` (minor, new behaviour). Description first, `bumps:` block last.

Also name `spike` in the `plot-ask.mjs` row of `skills/plot/scripts/README.md`, and in the question list of `CLAUDE.md` (*The Master Agent Uses The Controllers*: "`plot-ask.mjs` answers the questions `board`, `fleet`, `deliverable` and `release-claim`"). Run `./scripts/check-agents-md.sh --write` to regenerate `AGENTS.md`.

### Settled decisions — do not re-derive them

- **The bundle answers, the skill does not.** Skill prose cannot be tested: 0 tests cover SKILL.md:71 today, and three other readers of the same record already drifted from `licensedSpike`. A bundle question puts one cell under each answer.
- **A new verb on `plot-ask.mjs`, not a new bundle.** `plot-ask.mjs` already carries `repair-pr`, `merge` and `release-approve` as `argv[0]` branches; its callers resolve it already. A new bundle adds a launcher and a README row for no gain. Use the `repair-pr` branch of `run` as the shape.
- **Exit 1 versus exit 2 is the contract.** `unlicensed` is an answer about a plan that read. `unaskable` is a plan that did not. Do not fold an unreadable plan into `spike-record-absent`: the gate's own helper does that for a scratch parse (`licensedSpikeOf`, `gate.ts`), where refusing is the safe default, and a caller that asks should know the difference.
- **Absent is not false.** An unreadable plan answers `unaskable`, never `unlicensed`. A caller that treats `unaskable` as "no spike" would start nothing and say nothing.
- **Read the exit code, not the emptiness of stdout.** The skill's call must branch on the exit code.
- **The wire words are `licensedSpike`'s.** Print `reason` verbatim (`spike-marker-moved`, `spike-branch-renamed`, and the rest). Do not reword them in the bundle; the card and the pulse (slice 3) print wording of their own from the same words.
- **The `implement` workflow is out of scope.** `workflows/implement.ts` reads `spikeBranch` and has no production caller. The plan names it as a follow-up. Leave it.

### Done when

The plan's slice line is the specification: `plot-ask.mjs spike <slug>` with the record date and exit codes 0, 1 and 2; `skills/plot-implement/SKILL.md:71,:87,:49` call it; the README row and the `CLAUDE.md` list; one unit cell per answer.

Tests go in `packages/board/test/unit/ask-spike.test.ts`, beside `ask-repair-pr.test.ts` (copy its harness: it imports `run` from `entry/main.js` and stubs the domain workflow). One cell each for:

- a licensed record: exit 0, `licensed <branch> <date>`. It catches a date taken from the wrong field.
- `spike-branch-renamed`: exit 1, the reason named, the date present. It catches a reason lost on the way out.
- `spike-record-absent`: exit 1 with `-` as the date. It catches an empty date that shifts the fields a shell caller splits on.
- an unreadable plan, and a slug with no plan: exit 2, `unaskable`. It catches an unreadable plan answered as `unlicensed`.

Plus: this slice changes `.sh` files for none, so `scripts/check-shell-lines.sh` has nothing to count. Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. Do not run `test:e2e` locally. Do not commit a rebuilt `board-server.mjs` or `plot-ask.mjs` bundle: `main` builds them (`scripts/check-no-bundle-diff.sh`). Run `pnpm build:board` only to test, then restore the generated paths. New functions are arrows.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (`--draft` while the work moves), never `gh pr create`. When it exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists.

### Scope guard

This branch owns `packages/board/src/server/entry/main.ts`, `packages/board/test/unit/ask-spike.test.ts`, `skills/plot-implement/`, the `plot-ask.mjs` row of `skills/plot/scripts/README.md`, the question list in `CLAUDE.md` with the regenerated `AGENTS.md`, and one changeset.

Other slices of this plan in flight: `bug/the-spike-card-names-its-reason` (card and pulse, `entities/card-facts.ts`, `fleet.ts`, `plan-walk-assembly.ts`, `skills/plot-pulse/`), `bug/the-plan-store-corpus-checks-both-lists` (#3670, the plan-store corpus) and `bug/the-verdict-line-drops-the-spike-columns` (#3674, `verdicts.ts`). None edits `entry/main.ts` or `skills/plot-implement/`. A collision with any of them is new information: report it.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
