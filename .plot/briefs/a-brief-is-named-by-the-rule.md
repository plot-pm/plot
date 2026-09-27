## Implementation brief — a-brief-is-named-by-the-rule

- **Plan (canonical):** `docs/plans/2026-09-26-a-brief-is-named-by-the-rule.md` on `main`
- **Approved:** 2026-09-26, Jan Wloka, in-session after panel (round 1)
- **Issue:** #1013
- **Branch:** `infra/a-brief-is-named-by-the-rule` (base: `main`), claimed 2026-09-27 by ref push
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** the PR, per repo convention; CI is the authority

A single-slice plan. Nothing waits on this branch and it waits on nothing.

### What to build

A fourth `PreToolUse` gate, `skills/plot/scripts/plot-brief-name-gate.sh` (the name is yours to choose; keep the `plot-*-gate.sh` shape), that refuses a `git commit` whose index **adds or renames** a file under `.plot/briefs/` to a name that starts with a configured branch prefix followed by `-` — `feature-x.md`, `bug-x.md`, `infra-x.md`. The refusal names the path `brief-path.ts` computes: the same name with the prefix dropped.

The observed failure: 25 briefs written under `<prefix>-<slug>.md` across 21 commits, 2026-08-24 to 2026-09-26, rising (7 in August, 18 in September). Each one held its slice on `no-brief` while the file sat committed on `origin/main`. On 2026-09-26 one dispatch reported `handed=0 … no-brief=1` with three agents idle; renaming the file gave `handed=1` on the next tick. The most recent case is today's commit `0375b024`, which renamed `bug-a-claim-is-released-not-deleted.md`.

The plan is canonical. This brief is orientation.

### A finding the plan did not name: the writer is a skill instruction

The plan says *"No code wrote them … a master agent types the filename by hand."* That is true of code and false of prose. **`skills/plot-implement/SKILL.md:183` instructs the writer to use "the branch name with `/` flattened to `-`"** — the exact name `brief-path.ts:17-21` calls *"a file no reader computes"*. Every agent that follows `/plot-implement` step 4 as written produces a misnamed brief. That explains the rising rate: fleet volume runs through that step.

**Correct that one sentence in this slice.** The gate alone would refuse the output of the repo's own command on every run. The corrected wording states the rule `brief-path.ts` states: the branch name after its last `/` (`feature/x` gives `.plot/briefs/x.md`), or the plan slug for a `same-branch` plan. This does not change who writes briefs, which the plan keeps out of scope. It changes what the writer is told. Bump `plot-implement` as a patch in the changeset. Name this in the PR body as the one change beyond the plan's text.

`skills/plot-dispatch/SKILL.md:168` also says "flattened". That line describes worktree paths (`plot-wt-<flattened>`), not briefs. Leave it alone.

### Decisions the plan settles — do not re-derive them

**Shape, not membership.** The gate cannot know the branch set: a brief is written before its branch exists, and that is the normal case. So it refuses one shape only — a leading `<prefix>-` where `<prefix>` is one of `Branch prefixes` with the `/` removed. A name that does not start that way passes untouched. The plan measured **zero false positives over the whole estate** with this rule. Do not widen it to "the name must match an existing branch" or "the name must match a plan slug". Both refuse the legitimate brief-before-branch case.

**Read the prefixes from config, never hardcode them.** `bash "$HERE/plot-config.sh" get "Branch prefixes" "<default>"`. The value arrives as `idea/, feature/, bug/, docs/, infra/` (plot-config strips backticks and parenthetical prose, and normalises separators to `, `). Pick a default for a repo without the key and state it in the header comment. `plot-config.sh:20` documents `idea/`, `feature/`, `bug/` as the base set.

**The reading is the index, with `-M`.** `git diff --cached --name-status -M`. A plan juror prototyped this and measured it: an add is `A <path>`, and a `git mv good.md feature-good.md` arrives as `R100 <old> <new>` and must be judged by the **destination**. A `--name-only` reading of a rename lists the new path too, but it loses the add/rename/modify distinction, and a **modify** of an existing misnamed file is not what this gate refuses. The estate holds none today (`git ls-tree origin/main .plot/briefs/` shows 0), but an adopting repo may, and refusing every edit to a legacy file would block its repair.

**Take the command the way `plot-state-gate.sh` takes it.** `.tool_input.command` decides only *is this a `git commit`* (`plot-state-gate.sh:57-61`). Then read the index. `plot-state-gate.sh:71-95` (`effective_paths`) handles the case where `git add -A && git commit` in one command stages after the hook runs. Reuse that reasoning for the add half, or state why a brief name does not need it. A brief written and committed in one chained command is the common master-agent shape, so this case matters here.

**Fail open on its own machinery, refuse what it can see.** `trap 'exit 0' ERR`, no `jq`, not a git repo, unreadable config → exit 0. A misnamed add or rename it can read → exit 2, message on stderr. That is the split both shipped gates make (`plot-state-gate.sh:44-49`).

**The readers stay as they are.** `packages/board/src/server/brief-path.ts` and `brief_path()` at the shell dispatch script's line 501 are both right, agree, and `test/reconcile/briefpath.test.mjs` proves it. Do not make a reader accept both names. A reader that accepts a name no writer should produce makes the rule unenforceable.

**Registration is one line in `hooks/hooks.json`.** `plot-install-hooks.sh:66` reads the gate set from that file and never hardcodes it. Add the entry beside the three existing gates and the installer registers it. Do not add a list to the installer.

**Refusal text: name the path.** The plan leaves the wording open. Name the computed path, because the operator's next action is one `git mv`. Print the command, for example `git mv .plot/briefs/infra-x.md .plot/briefs/x.md`, the way `plot-state-gate.sh` names the command that owns a write.

Rules carried over unchanged:

- **Absent is not false.** A missing `Branch prefixes` key falls back to the default. It never means "no prefixes, refuse nothing".
- **Read the exit code, not the emptiness.** A `git diff` that fails and prints nothing must not read as "no briefs staged". The ERR trap covers this only when the failing command is not inside a pipeline or `$(...)`. Check it.

### Done when

The plan's `## Done when` list is the specification. These assertions exist because a naive implementation passes without them:

- **The `git mv` case, tested as a rename.** A test that only stages new files passes an implementation reading `--diff-filter=A`. Stage a real `git mv` and assert exit 2.
- **A brief for a branch that does not exist passes.** This catches a membership check. Use a scratch repo with no such branch.
- **A modify of an existing misnamed file passes.** This catches a check that reads every staged path under `.plot/briefs/`. It is not in the plan's list, and it is what keeps a legacy repo repairable.
- **A name that contains a prefix word without the dash passes**, for example `.plot/briefs/bugfix-parser.md` or `.plot/briefs/feature.md`. This catches a `startswith(prefix)` match that forgot the `-`.
- **Fail-open is proved through the gate, not assumed.** Drive it with invalid JSON on stdin and from outside a git repo, and assert exit 0 in both cases.
- **`--verify` proves the gate.** `plot-install-hooks.sh --verify` reports each registered gate `verified`, `unverified` or `unprobed`, and the `probe_for` case (around line 311) maps a gate to its prober. A new gate with no prober reports `unprobed … no self-contained guarded condition is known`. That is honest, but this gate needs no remote, so write `probe_brief_name_gate`: a scratch repo, a staged `.plot/briefs/feature-x.md`, and exit 2 expected. Add the script to `gateScripts` in `test/reconcile/install-hooks.test.mjs:272`, or `repoWithGates` never copies it.
- **`current` on a second install run.** The plan asks for this directly, and `install-hooks.test.mjs` already has the shape.

The tests go in `test/reconcile/<name>-gate.test.mjs`, beside `state-gate.test.mjs` and `controller-gate.test.mjs`. Copy their hook-JSON driver.

Plus the repo gates:

- `nvm use` (Node 24), then `pnpm test`, `pnpm run test:contracts`, and `pnpm run typecheck`. Board code does not change, so `test:board` is not required. Run it only if you touch `packages/`.
- Do **not** run `test:e2e` locally. It belongs to CI.
- A changeset in the repo's format: description first, `plan: docs/plans/2026-09-26-a-brief-is-named-by-the-rule.md` and `bumps:` last, with `plot: minor` (new gate) and `plot-implement: patch`. Run `./scripts/check-changeset-packages.sh`.
- Add a row for the new gate to the Helper Scripts table in `CLAUDE.md`, beside `plot-state-gate.sh`. Mention it in the `plot-install-hooks.sh` row only if that row's wording names the gate count.

### Bookkeeping

- Push the first real commit as soon as it exists. The ref is already claimed.
- Open the PR with `skills/plot/scripts/plot-open-pr.sh` (`--draft` while the work is moving). **Do not run `gh pr create`.**
- When the PR exists, change the plan's slice heading on `main` to `### A brief is named by the rule (Branch: infra/a-brief-is-named-by-the-rule, PR: #N)`. Leave the branch name without backticks: `plot-plan-meta.sh` reads no branch from a backticked `(Branch: \`x\`)` heading, and this plan parsed `branches: []` until commit `8b6d5901` removed them.
- No project board is configured.

### Scope guard

This branch owns:

- the new gate script under `skills/plot/scripts/`
- `hooks/hooks.json` (one entry)
- `skills/plot/scripts/plot-install-hooks.sh`: the prober and the `probe_for` case only
- `test/reconcile/install-hooks.test.mjs` (`gateScripts`) and the new gate test file
- `skills/plot-implement/SKILL.md`: the one sentence at line 183
- `CLAUDE.md` (the Helper Scripts row), and a `.changeset/` file of its own

In flight at dispatch (2026-09-27, checked against `origin/main`):

| branch | touches |
|---|---|
| `bug/the-index-is-read-once` | `plot-reconcile-scan.sh`, `test/reconcile/index-read-once.test.mjs` |
| `infra/a-decision-reads-rather-than-asks` | **`CLAUDE.md`**, `plot-reconcile-scan.sh`, `test/reconcile/scan-index.test.mjs` |
| `feature/one-monitor-watches-the-slice` | `packages/board/**` (holds a `PLOT-BLOCKED.md`) |
| `infra/a-corpus-test-says-what-it-verifies` | `packages/domain/corpus/branch-state.corpus.test.ts` |
| `bug/a-claim-is-released-not-deleted` | nothing yet |

`CLAUDE.md` is the one shared file. Keep your edit to one new table row, so a rebase conflict stays one hunk. No other branch touches `hooks/hooks.json`, `plot-install-hooks.sh` or `plot-implement/SKILL.md`.

The gate's own trigger surface is `git commit`. Every agent in the fleet commits through it once the hook ships. A bug that refuses a legitimate commit blocks the whole fleet, which is why the pass cases above carry as much weight as the refusals.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
