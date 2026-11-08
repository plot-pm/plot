## Implementation brief — tickets-for-the-release-and-loose (wave: Identity and reads)

- **Plan (canonical):** [docs/plans/2026-11-08-tickets-for-the-release-and-loose.md](../../docs/plans/2026-11-08-tickets-for-the-release-and-loose.md) on `main`; the design it carries is `docs/superpowers/specs/2026-11-08-delivery-tab-design.md`
- **Approved:** 2026-11-08, Jan Wloka, plan-PR #3250 merged
- **Branch:** `feature/the-issue-index-reads-assignee-and-release` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** `plot-review` GitHub App, required on `main`

This slice is the second of two in the wave "Identity and reads". It does not wait on `feature/people-carry-a-tracker-identity` (that branch edits `packages/domain/src/entities/person.ts` only) and the three "Tickets on the board" slices wait on this one and on `feature/delivery-tab-sections`.

### What to build

Today the issue index cannot say which release a ticket is planned for, so the board cannot narrow **You › Input to the fleet** to the sprint's target release or count the release's tickets. `tracker-github.ts:158` states that GitHub models no milestone, and `versionRead` answers `unaskable` there. Add the release to what the tracker reads and what `issues.json` holds, through the one writer.

**The assignee is already read and indexed — do not rebuild it.** Measured on `origin/main` 2026-11-08: `Issue.assignees` (`packages/domain/src/entities/issue.ts:73`), `IssueIndexRowSchema.assignees` (`entities/issue-index.ts:54`) and `issueIndexRowOf`'s `assignees` line (`packages/fleet/src/shared/issue-refresh.ts:106`) exist. `plot-host.sh issue-list` emits it on both vendors: Jira as `emailAddress // accountId`, GitHub as the `login`. The plan's "reads assignee" is therefore satisfied by checking that the open, changed, closed and inbox reads all carry it, and by a test that pins it. The new work is the release.

1. **One new read, one name: a ticket's planned releases.** Add `releases?: readonly string[]` to `Issue`, with the same standing as `assignees`: a read of what the tracker stated, never mirrored back. GitHub states the issue's one milestone title as a one-element list. Jira states every `fixVersions[].name`. Bitbucket and a repository with no tracker state nothing.
2. **`plot-host.sh issue-list` emits it.** GitHub: add `milestone` to `gh_json` (the base list at `plot-host.sh:5455`) and map `.milestone.title` in the `jq` below it. Jira: add `fixVersions` to `fields` (`plot-host.sh:5329`) and map `.fields.fixVersions[]?.name` in the `jq` at ~`:5418`. `RawIssue` and `issueOf` in `adapters/tracker/tracker-shell.ts` read the new key.
3. **`IssueIndexRowSchema` gains `releases`** (optional string array, no `.default()` — the schema's own rule at `issue-index.ts:28-31`). `issueIndexRowOf` writes it. `refreshIssueIndex` stays the only writer of `issues.json` (`one-issue-index-writer.test.ts` holds that).
4. **`ISSUE_INDEX_VERSION` moves from 1 to 2.** `IssueIndexSchema.v` is a literal, so a v1 file fails `decodeIssueIndex` and decodes to `null`, which is the contract: one full read, never an empty list. Nothing migrates a v1 file. The four `v: ISSUE_INDEX_VERSION` write sites in `issue-refresh.ts` (`:453`, `:488`, `:541`, `:566`) follow the constant.
5. **The question is a pure domain rule: `releaseOf`.** Put it in `packages/domain/src/rules/` as an arrow function, taking an index row and a release version and answering whether the ticket is planned for that release: the version equals one of `releases`, compared as a name, exactly. It reads the row and spawns nothing. The release line (a later slice) and the Sprint filter (a later slice) call it, so the rule must answer for all three row states below.

### Decisions the plan settles — do not re-derive them

- **A ticket is planned for a release when any of its Jira fix versions, or its one GitHub milestone, has the release version as its name.** Settled in the plan. Compare names, not ids and not prefixes: `2.32` does not match `2.32.0`.
- **The board makes no second read.** The fields ride the read `fleetd` already makes (design spec, Non-goals). A board-side `gh`/Jira call for the release is the rejected alternative and fails the layering rule: a controller calls the domain and never spawns.
- **Do not make `versionRead` answer on GitHub.** `versionRead` is the per-version Jira read the sprint release gate calls (`packages/board/src/server/entry/sprint-release-gate.ts:246`), and it answers `unaskable` on GitHub by design. A GitHub milestone read through it would change that gate's answer for every GitHub repository. The per-ticket `releases` field is the new seam and `versionRead` stays as it is.
- **Do not put the release in the tracker read's own port as a new method.** The port already returns `Issue` rows; the field rides them, as `assignees` does. A second method makes a second read.
- **Three row states stay distinct, and the rule must tell them apart.** `releases` present and non-empty: planned. `releases: []`: the read asked and the tracker named none, which the release line will count as untriaged. `releases` absent: the row was not asked for it (Bitbucket, a tracker with no release concept, or a closed or inbox row) and counts as neither. Write `[]` into the index row whenever the tracker was asked and answered none. Collapsing absent into `[]` is what turns every Bitbucket ticket into "untriaged". This distinction is the brief's call; the plan states the three counts and not the encoding, so say so in the PR if you change it.
- **A delta must carry the release.** `issueListChanged` is the incremental read (`issue-refresh.ts:437`). GitHub moves `updatedAt` when an issue is milestoned and Jira moves `updated` when a fix version changes, so a retargeted ticket appears in the next delta. Verify that the changed read asks for the new field on both vendors; a delta row without it would overwrite a full row's release with nothing.
- **Rules carried over unchanged.** The index holds bought answers and no verdicts (`CLAUDE.md`, "A Decision Reads The Index"): `releaseOf` is derived fresh from the row and never stored. Absent is not false: a row with no `releases` never answers "not planned". An older-version, unparseable or missing file means ask again.

### Done when

The plan's `## Done when` is its Changelog: *the Delivery tab lists tickets by release.* This slice's share is the read and the rule, and the assertions a naive implementation would pass without:

- `releaseOf` unit tests (`packages/domain/test/`): a Jira ticket with two fix versions matches either; a GitHub ticket matches its milestone; `2.32` does not match `2.32.0`; `releases: []` is not planned and is distinguishable from an absent field. Without the last case, Bitbucket tickets read as untriaged.
- `IssueIndexRowSchema` round-trips `releases`, `[]` and absent through `encodeIssueIndex`/`decodeIssueIndex` (`packages/domain/test/issue-index.test.ts`). A strict schema rejects an unknown key, so a missing schema change fails the parse of the writer's own output.
- A v1 file decodes to `null` (`issue-index-file.test.ts`). Without it, a schema that accepts both versions would hand the board rows with no release as "none planned".
- `packages/fleet/test/unit/issue-refresh.test.ts`: the row built from an `Issue` with `releases` carries it; after a delta read, a row whose milestone moved holds the new value, and a delta row with no `releases` does not erase a held one.
- `test/reconcile/host.test.mjs` (names you touched only, never the whole file — it stalls under load): `issue-list` emits `releases` for a GitHub issue with a milestone and for a Jira issue with two fix versions, and emits no key for a Bitbucket one.
- The assignee is pinned on each read: open, changed, closed and inbox rows carry `assignees` into the index.

Plus: no board bundle in the diff (`scripts/check-no-bundle-diff.sh`; `main` builds it), and a changeset in `.changeset/` with the description first and the `bumps:` block last, package `plot`, naming the plan in its `plan:` line (the sibling branch's `.changeset/people-carry-a-tracker-identity.md` is the shape). Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` key run in CI and a failure there comes back as a correction; do not run `test:e2e` locally.

**Shell gate.** This slice touches `plot-host.sh`. `scripts/check-shell-lines.sh` refuses a pull request whose shell under `skills/` is longer than at its merge base, and counts commands, not lines. Add `milestone` to the existing `gh_json` string, `fixVersions` to the existing `fields` string, and one key to each existing `jq` object, so no command is added. If a new command is unavoidable, remove an equal number of commands elsewhere in the same change; the gate has no override. Joining statements with `;` or `&&` is not a payment.

### Bookkeeping

- Open the PR through the controller: `../plot/scripts/plot-open-pr.sh` (`--draft` while the work moves). Do not run `gh pr create`.
- When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section and push it to `main` (`Impl:` is own branches).
- Push the first real commit as soon as it exists.
- Read `.plot/state/fixer-attempts/<pr>.json` for `inFlight` before any hand fix of a PR.

### Scope guard

This branch owns:

- `packages/domain/src/entities/issue.ts`, `entities/issue-index.ts`, a new `rules/release-of.ts`, and their tests
- `packages/domain/src/adapters/tracker/tracker-shell.ts` (`RawIssue`, `issueOf`) and `tracker-fixture.ts` if the fixture must state a release
- `packages/fleet/src/shared/issue-refresh.ts` and `packages/fleet/test/unit/issue-refresh.test.ts`
- `skills/plot/scripts/plot-host.sh`'s `issue-list` arm, `test/reconcile/host.test.mjs`, and the `.changeset/` file

Siblings in flight, verified 2026-11-08 against `origin`: `feature/people-carry-a-tracker-identity` holds `entities/person.ts`, `test/person.test.ts` and `skills/plot/scripts/README.md`; no overlap. `feature/the-release-row-approves-itself` holds `rules/release-approvable.ts` and `rules/pr-index.ts`; no overlap. The Delivery tab slices (`feature/delivery-tab-sections`, `feature/delivery-placement-rule`) place rows and are not started on the issue index; if either shows a diff in `issue-index.ts` or `issue-refresh.ts`, report it rather than improvising around it.

Out of scope: the Sprint filter, the release line counts, "opened by sprint" and the loose-end controllers — each is its own slice. This slice stops at "the index holds the release and `releaseOf` answers from it".

If you find something the plan did not anticipate, report it rather than improvising outside scope.
