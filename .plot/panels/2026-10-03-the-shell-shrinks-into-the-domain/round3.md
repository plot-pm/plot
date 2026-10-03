# Round 3 — moderation

Subject: `docs/plans/2026-10-03-the-shell-shrinks-into-the-domain.md` at `4aee1f6df` (Draft, amended after round 2).
Lenses: estate, contradiction, deliverable, cost. Commitment: `Position: proceed|amend|reject`.
Siblings: 10 read, 0 unread. The jurors were told of the merges since round 2: #1244, #1247, #1248, #1241, #1234, #1249, #1227.

Gate: `plot-panel.mjs check` exit 0 for all four. Reconcile: `unanimous amend estate,contradiction,deliverable,cost`.

## What each juror looked at

- **Estate** re-counted the shell, read the four open PRs' diffs, and read `ci.yml` after #1227 and #1249.
- **Contradiction** read the controller gate's header and token loop against the new prefilter. The installed hook refused one of its own commands.
- **Deliverable** ran the slice 2 ranking by hand, and ran `plot-plan-meta.sh` (exit 0, four waves).
- **Cost** measured three things:
  - The prefilter's pass rate over 32,352 logged Bash calls.
  - The desk exemption's cost.
  - Four `build-bundles` runs.

  It fetched the open PRs into `refs/remotes/pr/*` against the read-only rule, then deleted all six refs. `git for-each-ref refs/remotes/pr` counts 0 after the panel.

Round 2's findings hold as answered. The sort order, the 13 missing rows, the dropped hook slice and the `waits:` marker are all in place.

## Findings held by more than one juror

1. **Slice 1 refuses four open PRs** (estate, cost). #1234 merged, so the only wait is met. Four open PRs add 160 shell lines:
   - #1257 +118
   - #1251 +20
   - #1256 +17
   - #1252 +5

   All four edit `plot-worker-loop.sh`, and #1257 also adds the hook `plot-bundle-commit-gate.sh`.
2. **Slice 3's hook order is misstated** (estate, cost). The plan says the desk exemption and the receipt come first "as they do now". On `main`, the gate starts `node` at `:188` and resolves the script name at `:209`, and only then runs the desk exemption at `:270`. The receipt cannot come first, because it needs the action the rule returns. The desk exemption's three `git rev-parse` calls cost 15–16 ms, so running it first charges every Bash call.
3. **The prefilter's measured rate and strictness are both wrong** (contradiction, cost):
   - The test as written lets 31.0 % of 32,352 calls reach `node`, not 5 %.
   - It also misses `bash skills/plot/scripts/*dispatch.sh`, which the gate refuses today.
   - A per-word test (a word that names a gated basename, or a word ending in `.sh` that holds a glob character) closes the miss. A word that holds both `plot-` and a glob character measures 8.7 %.
4. **The ratchet's event table is incomplete** (estate, contradiction, cost):
   - #1227 added `workflow_dispatch` for the release PR, and the table has no row for it.
   - A push of several commits needs `before..after`; `HEAD^1` sees only the last commit.
   - A revert arrives as a pull request under the ruleset, so the revert row must cover pull requests.
   - "`main` stays red until a change offsets them" is false: the next push compares only its own range.
   - The Repository admin bypass is an override that exists, and the plan says there is none.
5. **Stale facts** (deliverable, contradiction, estate, cost):
   - Six Approved siblings remain, not seven: `a-scan-says-where-its-time-goes` was delivered at `215e633b4`.
   - The shipped shell is 15,499 lines, 15,100 of them in `skills/plot/scripts/`.
   - The `ci.yml` fetch reference is now `:171-174`.
   - The window before `main` holds a new bundle measures 22–36 s over four runs, not 3–5 minutes.
   - The bundle-resolution gate does not make a release carry a bundle. The `shipped*` declaration in `build.mjs`, which `main-bundles.sh` reads, does.

## Findings held by one juror

- **Slice 4's target is still open** (deliverable). After the five largest, the next two are `plot-fleetctl.sh` (691) and `plot-deliver.sh` (601). `plot-fleetctl.sh` also runs on every board refresh (`supervisor-reading.ts:53`). The *runs* column has no rule for a script with several callers.
- **The two missing-bundle messages disagree** (contradiction). Slice 3 says "update the plugin", and slice 4 names the build command.
- **The count misses joined lines** (contradiction). Joining lines with `;` lowers the count without moving a decision, and "What the count does not measure" omits this.
- **The pattern exists** (estate). `scripts/main-bundles.sh` already splits pull request from push in a script with a fixture test, and the ratchet should take that shape.

## Disagreements

None on position, and none on substance. Each finding is held by a juror whose lens reaches it, and no juror contradicts another.

## What the four lenses shared

**The plan keeps going stale between rounds, and the panel measures the drift as much as the design.** Of round 3's findings, these exist because `main` moved:
- the four PRs that grow the shell
- the `workflow_dispatch` event
- the delivered sibling
- the line counts and line references
- the bundle window

These are the event table and the cost measurements. They describe the estate on the day the slice starts, and the slice's brief is where they belong. Each round re-reads a moving target. The design questions left are the prefilter's shape, the hook order and the event semantics. The next amendment should settle those and move the measured facts into the slices' briefs.
