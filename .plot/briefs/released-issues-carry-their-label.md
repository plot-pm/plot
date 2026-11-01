## Implementation brief — an-issue-shows-its-plan-s (wave 3: Released labels)

- **Plan (canonical):** docs/plans/2026-11-01-an-issue-shows-its-plan-s.md on main
- **Approved:** 2026-11-01, Jan Wloka, plan-PR #2998 merged
- **Branch:** `infra/released-issues-carry-their-label` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** pr

This slice is independent of the plan's other waves — it does not wait on, and nothing waits on, this branch.

### What to build

A one-off backfill plus a prevention gate for a measured labelling gap: 114 of 342 issues named by a Released plan's `Issue:` line are closed and carry no `plan:released` label, even though every other Released-plan issue (228 of 342) does. All 114 are closed, none carries another `plan:*` label, and none is named by a live (Draft/Design/Approved/Delivered) plan — so they are safe to backfill. 82 of the 114 are issue #1000 or higher, meaning this is an ongoing gap, not a one-time historical artifact — which is why a gate matters as much as the backfill.

Three of the 114 (#2697, #2705, #2714) show the cause directly: `docs/plans/2026-10-27-the-reaper-keeps-leftovers-that-no.md` approved, delivered and released naming only #2757 on its `Issue:` line; commit `0e8c71e28` added #2697, #2705, #2714 to that line *after* release, and nothing re-ran the release-phase write for the newly added keys. The gate closes exactly that gap: no commit may add an issue key to an Approved/Delivered/Released plan's `Issue:` line without a receipt proving `plot-plan-state.sh --only-issue <key>` already wrote that issue's phase.

Three pieces, in this order because the gate depends on a port method the backfill also needs:

1. **`released-labels.ts`** (new, `packages/domain/src/rules/`) — pure domain predicate `releasedLabelTargets(plans, issues)`.
2. **`issueLabel` port method** (new, on `Tracker`, `packages/domain/src/ports/tracker.ts`) plus GitHub/fixture/Jira/none adapter implementations, and a `labels` field added to the existing closed-issue read.
3. **The operator entry and reconcile hook** — `plot-released-labels.mjs`, wired through `entry/released-labels.ts`, plus a dry-run-only section in `plot-reconcile-scan.sh`.
4. **The gate** — `issueTransitionOf` in `state-transition.ts`, called from the gate entry, enforced by `plot-state-gate.sh`. (This is the "Added issues" slice's territory per the plan's `## Slices`, but re-read the plan: the gate for gap 2 specifically is listed under *this* slice's motivation section, while the state-transition rule and receipt machinery live in the sibling branch `bug/an-added-issue-owes-its-phase`. If `state-transition.ts` does not yet exist when you start, build only what gap 2 (released-labels backfill) needs here — the receipt/gate machinery is `bug/an-added-issue-owes-its-phase`'s own slice. Confirmed before writing this brief: `packages/domain/src/rules/released-labels.ts` does not exist yet, and `issueLabel`/`issueListClosed` are not yet on the Tracker port — this slice starts clean with no drift since approval.)

### Decisions the plan settles — do not re-derive them

**Label-only, one-off, not a standing writer.** The plan rejected a standing writer that keeps closed issues labelled going forward: "the released write also closes the issue and removes other `plan:*` labels" (safety juror, Decisions §Gap 2) — a standing writer duplicating that logic risks fighting the real release writer. Instead: a one-off migration entry (`--yes` to write, dry-run by default) plus a reconcile section that only *reports* drift and prints the `--yes` command — it writes nothing. Do not build a cron-style or auto-triggered label sweep.

**The predicate takes phases and issue rows, not git or host calls.** `releasedLabelTargets(plans, issues)` is pure: plans' phases + issue numbers in, tracker rows with state and labels in, `{ write, skip }` out. `skip` entries carry a reason (`open`, `live-plan`, `already-labelled`) — this is what the Done-when table's acceptance test checks line-by-line, so do not collapse `skip` into a plain filtered-out list.

**Rejected and Superseded plans do not block the backfill.** The plan explicitly tests this: `#333` and `#912` are each named by both a Released and a Rejected plan, and both belong in `write`. Only Draft, Design, Approved or Delivered co-naming blocks (`live-plan` skip reason).

**No new `gh` caller.** `plot-released-labels.mjs` must read plans through the existing `planMetasAtDefault` parser call (built by the sibling "Plan source" slice, `bug/an-issue-reads-its-plan-from-main` — check whether it has landed; if not yet merged, say so in the PR rather than duplicating a plan reader) and closed issues through the Tracker port's `issueListClosed`. `scripts/check-host-cli-callers.sh` is a real gate (see CLAUDE.md "`plot-host.sh` is the ONE place that talks to the host CLI") — adding a second `gh` invocation site outside `plot-host.sh` fails CI. The `labels` field is added to the *existing* `gh_json` string at `plot-host.sh:5484` (the closed-issue read, `gh_state != open` branch) — it is one field added to an existing call, not a new call.

**`issueLabel(issue, add, remove)` reuses the existing shell op, does not duplicate it.** `plot-host.sh:5756-5770` already implements `issue-label` exactly as the plan describes: `gh issue view` (read carried labels) → `gh label create` (idempotent, tolerates "already exists") → `gh issue edit --add-label --remove-label`. The TypeScript port method's GitHub adapter shells to this existing op with `planStateLabelsToRemove('released')` for the `remove` set (from `tracker-plan-state.ts:29` — read that function, it already encodes which `plan:*` labels are mutually exclusive). Do not write a second `gh` call path.

**Refuses `PLOT_UNATTENDED=1` — a human judgment gate, not a git gate.** Both the backfill entry and (per the sibling slice) `plot-plan-state.sh --only-issue` refuse under `PLOT_UNATTENDED=1` with exit 2. This mirrors `../plot/docs/unattended.md`'s pattern for irreversible tracker writes that need a person naming the issue list, not a default branch.

**Budget-aware, stops rather than partial-writes past the connector limit.** Measured host-call cost: the read is 9 pages for 842 closed issues (2026-11-01 measurement — expect drift by the time you run it; re-measure, don't hardcode "9"). Each write is 3 `gh` invocations (`view`, `label create`, `edit`), so ~342 calls for the current 114 candidates. The core budget is 5000/hour, shared with fleetd. Stop and print the unwritten rest when the connector's `limit()` reports fewer than 1000 requests left — do not silently truncate.

### Done when

The plan's `## Done when` table rows tagged "Released labels" are the specification (lines in `docs/plans/2026-11-01-an-issue-shows-its-plan-s.md`):

- `releasedLabelTargets` test: exact `write`/`skip` partition over the #1/#2/#3/#4/#333 fixture, including the `already-labelled`/`open`/`live-plan` skip reasons by name — a test that only checks set membership and drops the reason string passes a naive implementation it shouldn't.
- Entry test: `--yes` over a target issue makes exactly one `issueLabel` call and zero comment/close calls — this catches an implementation that piggybacks on the plan-comment or close machinery by accident.
- Dry-run test: prints both sets with reasons and the call count the `--yes` run *would* make, writes zero — the call-count prediction is the part a lazy dry-run skips.
- Unattended test: exit 2, zero tracker calls under `PLOT_UNATTENDED=1`.
- Reconcile test (`test/reconcile/reconcile-released-labels.test.mjs`): one drifted issue → section prints `1` and the `--yes` command, writes nothing.

Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. List no full suite — the `CI suites` config key's suites run in CI; a failure there comes back as a correction.

`scripts/check-shell-lines.sh` refuses a PR whose shell under `skills/` grows past its merge base. This slice adds a reconcile section to `plot-reconcile-scan.sh` (3547 lines as of 2026-11-01) — pay for that growth in the same change (remove shell elsewhere, or push the logic into the domain rule and call it through a bundle). The gate counts commands, not lines — joining with `;`/`&&` or folding `fi`/`done` onto the prior line is not a payment.

### Bookkeeping

Open the PR through the controller, not `gh pr create`:

```
skills/plot/scripts/plot-open-pr.sh          # current branch
skills/plot/scripts/plot-open-pr.sh --draft  # while still moving
```

Push the first real commit as soon as it exists. When the PR is created, append `→ #<number>` to this branch's line under `### Released labels` in the plan's `## Slices` section.

### Scope guard

This branch owns:
- `packages/domain/src/rules/released-labels.ts` (new)
- `packages/domain/src/ports/tracker.ts` (`issueLabel` addition; `labels` on `ClosedIssues`/`IssueRead`)
- `packages/domain/src/adapters/tracker/tracker-github.ts`, `tracker-fixture.ts`, `tracker-jira.ts`, `tracker-none.ts` (implement `issueLabel`)
- `skills/plot/scripts/plot-host.sh:5481-5484` (add `labels` to the existing closed-read `gh_json`)
- `packages/board/src/server/entry/released-labels.ts` (new) built to `skills/plot/scripts/board/plot-released-labels.mjs` (built artifact — do not hand-edit the `.mjs`, and do not commit a rebuilt bundle per CLAUDE.md's board-artifact rule)
- `skills/plot/scripts/README.md` (new row for `plot-released-labels.mjs`)
- `skills/plot/scripts/plot-reconcile-scan.sh` (new reporting section)

Other branches in this plan, verified at this writing (none hold a remote ref yet — only two of six branches have started):
- `bug/an-issue-reads-its-plan-from-main` (started) and `bug/the-plan-comment-has-one-writer` (started) — both touch `fleet.ts`/`tracker-plan-state.ts`/`plot-host.sh`, disjoint from this slice's files except that this slice's `plot-released-labels.mjs` entry calls the `planMetasAtDefault` helper the "Plan source" slice builds. If that slice's PR (#3003) has not merged when you reach the entry, note it as a known dependency in your PR body rather than reimplementing a plan reader.
- `bug/an-added-issue-owes-its-phase` (not started, waits on `bug/the-plan-comment-has-one-writer`) — owns `state-transition.ts` and the receipt/gate machinery for gap 2's *prevention* half. This slice (Released labels) owns the *backfill* half only. Do not build the gate here if it is not yet present; coordinate via the plan file instead.
- `bug/settled-finding-tickets-close`, `bug/a-slice-row-reads-its-head-s-checks` (not started) — unrelated files, no overlap.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
