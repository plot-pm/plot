# Round 2 — moderation

Subject: `docs/plans/2026-10-03-the-shell-shrinks-into-the-domain.md` at `ec0e001e1` (Draft, amended after round 1).
Lenses: estate, contradiction, deliverable, cost. Commitment: `Position: proceed|amend|reject`.
Siblings: 10 read, 0 unread (as round 1).

Gate: `plot-panel.mjs check` exit 0 for all four. Reconcile: `unanimous amend estate,contradiction,deliverable,cost`.

## What each juror looked at

- **Estate** re-ran every Motivation count, read `ci.yml`'s checkout and fetch steps, and searched briefs and plans for `check-shell-lines`.
- **Contradiction** read the four hooks and the controller gate's header. It reached its slice 3 and slice 4 findings by reading the scripts, not by running the hooks.
- **Deliverable** ran `plot-plan-meta.sh` and ran the three commit hooks on #1245's commands. All three exit 0 on main today.
- **Cost** measured hook time per commit, the share of Bash calls that pass each prefilter (36,960 calls), the shell growth over three days, and where the hooks run from (the plugin cache, 2.22.2).

Round 1's findings hold as answered, except where noted below.

## Findings held by more than one juror

1. **Slice 4 fixes nothing #1245 lists and has its own costs** (deliverable, contradiction, cost). The three commit hooks prefilter on `git commit`, so all three exit 0 on #1245's commands before slice 4 changes a line. Each costs something different:
   - **State gate:** "none expands a glob" weakens `plot-state-gate.sh`, which counts every file a glob could cover (`:74-77`). Read literally, `git add docs/plans/*.md` fails `[ -f ]` at `:181` and lets a hand-edited `State:` line through (contradiction).
   - **Latency:** a `node` start in each hook would raise a commit's hook time from about 230 ms to 300–410 ms. `set -f` costs 0 ms (cost).

   Resolution: drop slice 4. #1245 closes at slice 3.
2. **The wait on #1234 is prose, and #1244 no longer needs one** (deliverable, contradiction, cost). #1244 nets 0 shell lines. #1234 nets +37 and has no merge date. Slice 1 needs a `<!-- waits: -->` marker, or a sentence saying #1234 pays its own offset if it lands after the gate.
3. **"Their briefs name the gate" is false, and the sibling list is short** (estate, contradiction, cost). No brief, template or slice line mentions `check-shell-lines`. Two more Approved siblings grow shell: `a-scan-says-where-its-time-goes` and `a-branch-carries-no-built-bundle`. The second adds a fifth hook. The ratchet hits `plot-worker-loop.sh` first: it grew 287 lines in three days, and this plan gives it no path to JS.

## Findings held by one juror

- **Slice 1 lacks the ref it reads** (estate). The `validate` job does not fetch `origin/main` (`ci.yml:86-90` records why the `corpus` job does). The slice must add the fetch and say what an unreadable merge base does.
- **A revert is refused** (cost). With no override, reverting a broken slice 5 restores the `.sh` body and grows the count. The plan must say whether a revert pays like any change, or is compared against the reverted commit's parent.
- **Slice 3, four points** (contradiction, cost):
  - The prefilter misses a glob invocation such as `bash …/plot-disp*.sh`, which today's gate refuses.
  - The desk exemption still runs after the `node` start.
  - The refusal names `pnpm build:board`, which a repository that installs the plugin cannot run.
  - The fix reaches sessions only through a plugin release, because hooks run from the plugin cache.

  On the failure direction, contradiction reads the gate's header (`:61-67`, fail-open on its own machinery) as forbidding a refusal. The header's second half, closed on the case it exists for, covers a command the prefilter matched. The disagreement is about wording, and the amendment should cite both halves.
- **The precedent is miscited** (contradiction). `check-script-names.sh` stores a number. Only its allowance test, which refuses slack, is the precedent.
- **Slice 5's ranking is incomplete** (deliverable, estate):
  - It names no sort order, so it can pick a script the plan reserves for its own plan.
  - 13 of the 58 scripts have no README row, `plot-worker-loop.sh` among them.
  - Four JS entries already run with no `.sh` file (`plot-panel.mjs`, `plot-local-checks.mjs`, `plot-ask.mjs`, `plot-registryd.mjs`). That is a precedent for when a launcher is needed at all.
- **Slice 3 should name `loopWord`** (`rules/start-command.ts:48`), the third matcher (estate).

## Disagreements

None on position. Contradiction's fail-open reading is answered above.

## What the four lenses shared

**All four judged a pull-request gate, and none asked what it does on a push to `main`.** On a push event, `git merge-base HEAD origin/main` is `HEAD` itself, so the comparison always passes. This session pushed four commits straight to `main` past branch protection (`acb9d2bda`, `d69488423`, `ec0e001e1` and the round-1 record), and `plot-approve.sh` reports `push: bypassed` routinely. A gate that only sees pull requests misses every direct push. On `push`, the comparison must be `HEAD` against `HEAD^1`, and a growing push is reported on `main` the way the lag check in `a-branch-carries-no-built-bundle` reports a stale build.
