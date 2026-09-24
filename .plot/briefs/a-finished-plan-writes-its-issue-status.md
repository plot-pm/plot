## Implementation brief — a-released-plan-tells-its-tracker (wave 2: A finished plan writes its issue status)

- **Plan (canonical):** `docs/plans/2026-09-24-a-released-plan-tells-its-tracker.md` on `main`
- **Approved:** 2026-09-24, in-session review after panel (round 1)
- **Branch:** `feature/a-finished-plan-writes-its-issue-status` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** per repo convention — the PR is reviewed as code; CI is the authority

Wave 2 of 2. It waits on `bug/the-scan-reports-an-open-issue` (wave 1) merging. At dispatch (2026-09-24) wave 1 is claimed and has no PR. The plan's Notes make this wave droppable: if wave 1 shows the case is rare, the plan may mark this branch `deferred:`. Read the plan's `## Slices` on `origin/main` before you start; if this branch carries `deferred:`, stop.

### What to build

A plan names the issue it answers, reaches `Delivered` or `Released`, and the issue keeps its old status. Measured: `docs/plans/2026-09-17-a-gate-matches-an-invocation.md` released in 2.19.0 naming `Issue: #935`, and #935 is still open. A sprint sweep found it; nothing in Plot did.

Every part of the write exists and nothing calls it. `Tracker.statusWrite` (`packages/domain/src/ports/tracker.ts`) has zero production callers. `trackerShell` (`adapters/tracker/tracker-resolve.ts:49`) has zero production callers. `workflows/deliver.ts`, `workflows/release.ts` and `plot-deliver.sh` never mention a tracker.

This branch adds four things:

1. **A domain rule** that decides, from a plan's phase and its `issues[]` and the configured status words, which status writes are owed. Pure, arrow functions, readings as values.
2. **An optional issue address on `StatusWrite`**, which the Jira connector prefers over mining a key out of `prUrl`.
3. **A shell-to-domain entry** that asks the rule and performs the writes through the tracker port.
4. **Two callers**: `plot-deliver.sh` after its push succeeded, and `/plot-release` step 4 after the `Released` write.

The plan is canonical; this brief is orientation.

### Settled decisions — do not re-derive them

**The subject of the write is the issue, carried as an optional field.** `StatusWrite` gains `issue?: string`. `prUrl` stays, because the GitHub connector's real subject is a PR (`tracker-github.ts:90` hands it to `plot-update-board.sh`, which updates a PR's Projects status). The Jira connector's subject is already an issue: `keyIn(write.prUrl)` (`tracker-jira.ts:78`) mines a key out of the URL. With `issue` present, Jira uses it and skips `keyIn`. Do not replace `prUrl` with `issue`: the GitHub arm would lose its only subject, and the tracker-shell tests that pass a `prUrl` would break for no gain.

**GitHub answers `no-target` for an issue-only write, and never calls the script.** The plan's first Open Question asks what a GitHub estate does. For this branch the answer is the plan's first option: Jira-only, and it says so. An `issue`-carrying write with an empty `prUrl` on the GitHub connector returns `no-target` and sets `lastRefusal` to a sentence naming why (the GitHub arm writes a PR's Projects status and has no issue equivalent). It must not call `plot-update-board.sh` with an empty URL. Giving `issue-status` a GitHub implementation is a different plan; `plot-host.sh:4310` already says `issue-status` is Jira-only "deliberately so rather than by omission".

**On this repository the whole path is a no-op, and that is correct.** `plot-config.sh get Tracker` answers nothing here, so `trackerFor` returns `trackerNone`, and every write answers `unaskable`. The expected result of delivering a plan on this estate is a report of `unaskable` and nothing leaving the machine. Do not configure a tracker in `CLAUDE.md` to make the feature visible.

**The status word is configuration, one key per phase, and an absent key is no write.** The plan says the word is the tracker's and asks (second Open Question) whether Delivered, Released or both should write. Two keys answer both questions without the code picking a side: `Tracker delivered status` and `Tracker released status`, read through `plot-config.sh get <key> ''`. Empty means this phase writes nothing. So a team that means *Done* as *shipped* sets only the released key, and a team watching progress sets both. No literal status word appears in the rule or the entry. Document both keys in the `plot-config.sh` header beside `Tracker`, and in `CLAUDE.md`'s `plot-config.sh` row.

**The rule is pure and lives in `packages/domain/src/rules/`.** Inputs: the phase, the `issues[]` list, and the two configured words. Output: a list of `{ issue, status }` — empty when the phase is not `delivered`/`released`, when `issues[]` is empty, or when that phase's word is empty. No port import, no `await`, in line with `CLAUDE.md` ("The domain here takes readings as values, not ports"). It does not read the tracker scheme: whether a tracker exists is the port's answer (`unaskable`), and a second copy of that decision in the rule is a second place for it to drift.

**The entry is its own bundle, not a verb on an existing one.** Name it `skills/plot/scripts/board/plot-issue-status.mjs`, built from `packages/board/src/server/entry/issue-status.ts`. The two alternatives are both refused by their own headers:

- `plot-transition.mjs` (`entry/transition.ts`) "spawns nothing and reads nothing". A status write spawns `plot-host.sh` through the connector, so adding it there breaks the property `plot-deliver.sh` relies on.
- `plot-ask.mjs` is 491 KB and answers `board`/`fleet` by running `plot-fleet-scan.sh`. `plot-slice-pr.mjs` and `plot-panel.mjs` each became their own bundle for this reason (`CLAUDE.md`, helper-script table).

Register it the way `plot-panel.mjs` is registered: `packages/board/build.mjs:308-329` (esbuild entry, copy into `skills/plot/scripts/board/`) and `packages/board/src/contract/bundles.generated.ts:52`. The entry reads the plan's phase and issues on stdin, reads the two config keys, asks the rule, builds the tracker with `trackerShell`, calls `statusWrite` once per owed write, and prints one line per issue: `<issue>\t<written|no-target|unaskable|failed>\t<reason>`.

**Shell never calls `plot-host.sh issue-status` directly.** `CLAUDE.md` says of the tracker ops: "reached only by its connectors". The Jira connector also sets `PLOT_TRACKER` and `PLOT_JIRA_BASE_URL` for the script (`tracker-jira.ts:60-63`); a direct call from `plot-deliver.sh` duplicates that environment and skips the connector's `no-target` versus `written` reading.

**Call the entry every time; do not prefilter in shell.** The rule decides "no issue, nothing to do", so the shell passes `issues[]` through unfiltered. A bundle answers in about 39 ms, and `docs/shell-and-domain.md` settles that a script running once per operator command calls the domain rather than duplicating the rule. `plot-deliver.sh` runs once per delivery.

**A failed write reports and the delivery still succeeds.** The plan: "The plan is delivered; the tracker is a copy." The entry exits 0 on every write outcome, including `failed`. It exits 2 only for input it cannot read (a broken installation, the convention `plot-release-gate.sh` uses). `plot-deliver.sh` treats even exit 2 as a report, not a refusal: it appends `tracker=<outcome>` to its `summary:` line (`plot-deliver.sh:697` and `:703`) and keeps its own exit code. `/plot-deliver`'s skill reads that summary; say in `skills/plot-deliver/SKILL.md` that a `failed` tracker write is reported to the operator and never re-runs the delivery.

**The call goes after the push, not before.** "Add one call at the end of the transition that already succeeded" (plan, *The shape of the fix*). In `plot-deliver.sh` that is after the push or micro-PR fallback has a result. A push that was `rejected` has not delivered the plan on the default branch, so it writes no status: skip the call and report `tracker=skipped`.

**Release has no script, so its caller is the skill.** No script owns `Released` (`skills/plot-release/SKILL.md:406`, and the step uses `plot-state-receipt.sh --unowned`). Add the call to step 4, once per plan, after the commit lands. Invoke it through a thin wrapper `skills/plot/scripts/plot-issue-status.sh <plan file>` that parses the plan with `plot-plan-meta.sh` and pipes phase and issues to the bundle; `plot-deliver.sh` uses the same wrapper. One wrapper, two callers, so the stdin format has one writer.

**It does not close, create, comment, label or backfill.** `plot-host.sh:220-232` draws the line: the status is "the one fact the tracker owns a copy of". #935 stays open until a person closes it. The plan's *What this does NOT do* list is binding.

Rules carried over from this estate:

- **Absent is not false.** An empty config key means "this phase writes nothing", not "write an empty status".
- **Read the word, not the exit code.** Both connectors already separate `written` from `no-target` on clean exits (`tracker-jira.ts:97-100`, `tracker-github.ts:98-106`); keep that separation in the entry's output.
- **`unaskable` is never `written`.** `ports/tracker.ts` states it on `statusWrite`; the entry must print `unaskable`, not swallow it.

### Done when

The plan's `## Done when` list is the specification. The assertions below exist because a naive implementation passes without them.

Domain rule — `packages/domain/test/issue-status.test.ts`:

- **No issues → no writes**, at both phases. Catches a rule that writes on phase alone. This is the path 90% of plans take.
- **Phase `approved`, `draft` or `design` → no writes** even with issues and both words set. Catches a missing phase filter.
- **`released` with only the delivered word set → no writes.** Catches a rule that falls back from one key to the other.
- **A multi-issue plan (`issues: ['1', '2']`) → one write per issue.** Catches a first-issue-only loop.
- **A non-standard word (`'Shipped to prod'`) reaches the write verbatim.** Catches a hardcoded or normalised status.

Connectors — extend `packages/domain/test/tracker-shell.test.ts`:

- **Jira with `issue: 'PROJ-7'` and a `prUrl` naming `PROJ-1` writes against `PROJ-7`.** Catches a connector that still mines `prUrl` first.
- **Jira with no `issue` keeps today's `keyIn(prUrl)` behaviour.** Catches a regression in the existing caller-less path.
- **GitHub with `issue` and `prUrl: ''` → `no-target`, and the `plot-update-board.sh` stub is never invoked** (the stub writes a marker file; assert it is absent). Catches a script call with an empty URL.
- **`trackerNone` → `unaskable`**, already covered; keep it green.

Delivery — a new `test/reconcile/deliver-tells-the-tracker.test.mjs` beside `deliver-phase-takes-effect.test.mjs`, using its sandbox pattern and a stub `plot-host.sh`:

- **No tracker configured → `summary:` ends `tracker=unaskable`, exit 0, plan is `Delivered`.**
- **The stub's `issue-status` exits 1 → `tracker=failed`, exit 0, plan is `Delivered` and pushed.** The regression the plan names: "A failed write reports and the delivery still succeeds."
- **Plan with no `Issue:` → `tracker=none` and the stub is never asked.**
- **Push rejected → `tracker=skipped` and the stub is never asked.**

Plus the repo gates:

```bash
nvm use                       # Node 24; pnpm crashes on 26
pnpm install
pnpm test
pnpm run test:contracts
pnpm run test:board           # rebuilds the artifacts, including the new bundle
pnpm run typecheck
./scripts/check-host-cli-callers.sh
./scripts/check-changeset-packages.sh
```

Do not run `pnpm run test:e2e` locally; CI owns it. Commit the rebuilt `skills/plot/scripts/board/plot-issue-status.mjs` and any other regenerated artifact; CI's no-diff gate fails otherwise.

Docs: a `CLAUDE.md` helper-script row for `plot-issue-status.sh` and one for `board/plot-issue-status.mjs` in the style of `board/plot-panel.mjs`; the `plot-config.sh` row gains the two keys; the `plot-host.sh` row needs no change. Update `skills/plot-deliver/SKILL.md` and `skills/plot-release/SKILL.md` for the new step and their `## Model Guidance` tables (the call is Small tier).

Changeset: `'plot': minor` (a new behaviour in two lifecycle steps) and `'@plot-pm/board': patch` for the bundle, description first, then the block:

```markdown
<!--
plan: docs/plans/2026-09-24-a-released-plan-tells-its-tracker.md
bumps:
  skills:
    plot-deliver: minor
    plot-release: minor
-->
```

### Bookkeeping

- Push the first real commit as soon as it exists.
- Open the PR with `skills/plot/scripts/plot-open-pr.sh` (`--draft` while the work is moving). Do not run `gh pr create`.
- When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section on `main`.
- Do not close #935, and do not write a status to it. The plan says it wants closing by hand.

### Scope guard

This branch owns:

- `packages/domain/src/rules/issue-status.ts` (new) and its test
- `packages/domain/src/ports/tracker.ts` — the `StatusWrite.issue` field and its TSDoc only
- `packages/domain/src/adapters/tracker/tracker-jira.ts`, `tracker-github.ts` — the `statusWrite` arms only
- `packages/domain/test/tracker-shell.test.ts`
- `packages/board/src/server/entry/issue-status.ts` (new), `packages/board/build.mjs`, `packages/board/src/contract/bundles.generated.ts`
- `skills/plot/scripts/plot-issue-status.sh` (new), `skills/plot/scripts/board/plot-issue-status.mjs` (built)
- `skills/plot/scripts/plot-deliver.sh` — the call after the push and the `summary:` field
- `skills/plot/scripts/plot-config.sh` — the header comment for the two keys
- `skills/plot-deliver/SKILL.md`, `skills/plot-release/SKILL.md`, `CLAUDE.md`
- `test/reconcile/deliver-tells-the-tracker.test.mjs` (new), one `.changeset/*.md`

Do not touch `plot-host.sh` (its `issue-status` op is correct as it stands), `plot-update-board.sh`, `plot-plan-meta.sh` (it already parses Jira keys into `issues[]` when `Tracker` is `jira` or `linear`, `plot-plan-meta.sh:316`), `workflows/deliver.ts`, `workflows/release.ts` or `transitions/plan.ts`. Wave 1 owns `plot-reconcile-scan.sh`.

Verified at dispatch (2026-09-24): no PR is open on the repository. The only remote branch whose diff against `main` touches any file above is `origin/feature/one-monitor-watches-the-slice` (`packages/board/build.mjs`), and its PR #741 is merged. No `plot-issue-status` file exists on `main`, and no plan named `a-release-is-a-controller-command` exists yet, so nothing else is moving the `/plot-release` step 4 text.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
