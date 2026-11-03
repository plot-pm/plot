## Implementation brief — plot-fleetctl-stop-unloads-another-checkout

- **Plan (canonical):** docs/plans/2026-11-03-plot-fleetctl-stop-unloads-another-checkout.md on main
- **Approved:** 2026-11-03, Jan Wloka, plan-PR #3094 merged
- **Branch:** `bug/plot-fleetctl-stop-unloads-another-checkout` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR, per `Review: pr` in the plan's Status block

This plan has one slice and one branch — no wave ordering to track.

### What to build

`plot-fleetctl.sh --stop` boots out whatever supervisor holds the resolved
label with no check on which checkout that job serves. Measured 2026-11-03 on
two macOS checkouts sharing the default label (`com.plot-pm.fleetd`): running
`--stop` from `ewz-leg` printed `supervisor unloaded` and killed `websmith`'s
supervisor, while `ewz-leg`'s own job (loaded under
`com.plot-pm.fleetd.ewz-leg`) kept running untouched. `--start` already
refuses this case (`refuse_label`, `plot-fleetctl.sh:1102-1109`); `--stop`
(`:1252-1405`) never calls the same check.

The fix adds the domain rule for the `stop` verb, routes it through the
existing bundle and shell caller, and makes `--stop` read the owner twice:
once before signalling any agent, and once more immediately before
`unload_supervisor` to close the race where another checkout's `--start`
loads the same label while this run's agent loop is still waiting.

### Decisions the plan settles — do not re-derive them

**One rule, both verbs, same file.** `old-label-migration.ts` already answers
this exact shape of question for the *old* label (`oldLabelAction`, reading →
verb → action). The new rule, `labelAction(reading, verb)`, is its sibling in
the same file, over the same `OldLabelReading` shape, answering `proceed` or
`refuse` for verbs `start`, `start-default`, `stop`. Do not fold it into
`oldLabelAction` — that rule's `retire`/`status` verbs and its `unload-and-remove
| leave | refuse | note` vocabulary serve the migration, not this refusal; a
shared signature does not imply a shared function.

**The table is the whole rule, and it's already decided:**

| verb | `this <dir>` | `another <dir>` | `unknown` |
|---|---|---|---|
| `start` | refuse | refuse | refuse |
| `start-default` | refuse | proceed | proceed |
| `stop` | proceed | refuse | refuse |

`start`/`start-default` are today's `refuse_label` behaviour at
`plot-fleetctl.sh:1107-1109`, moved verbatim into the rule — not changed.
Only `stop`'s column is new behaviour.

**The bundle owns the verbs and all three refusal texts.**
`plot-old-label.mjs` (built from `packages/board/src/server/entry/old-label.ts`)
gains verbs `start`, `start-default`, `stop`, `serves`, plus four arguments:
label, platform, read command, and the root the reading was compared against.
`start`/`start-default`/`stop` print the rule's word on stdout and, on
`refuse`, the refusal text on stderr. `serves` prints today's `--status` line
(replacing `serves_line`, `plot-fleetctl.sh:252-258`). Keep `retire` and
`status` as they are (one-argument form) — they are `oldLabelAction`'s verbs,
untouched by this plan.

**`refuse_label` (`plot-fleetctl.sh:1102-1106`) is removed, not hoisted.** Its
three texts move into the bundle word-for-word (`this` → `--start`'s refusal,
`another` → `--stop`'s new refusal, `unknown` → both, reading `$plat` which
only `--start`/`--status` set). `--stop` gets its own text from the bundle,
e.g.:

```
plot-fleetctl: 'com.plot-pm.fleetd' serves ANOTHER checkout (/Users/x/websmith), not this repository (/Users/x/ewz-leg) — it was not unloaded.
  Run --stop in that checkout, or give this checkout its own label — skills/plot/units/README.md
```

**`old_label_action` (`plot-fleetctl.sh:607-613`) becomes the one shared shell
caller for every verb** — `start`, `start-default`, `stop`, `serves`, `retire`,
`status` all pipe `supervisor_checkout` through it into the bundle. It keeps
its `supervisor_loaded` guard (a label that isn't loaded is never asked) and
its two `broken_install` refusals (missing bundle, bundle gives no answer). A
failed call reads as refusal, never as `proceed`. `supervisor_checkout` takes
an optional root argument to compare against, defaulting to `$repo_root`.

**Root comparison differs by verb, and this is deliberate, not an
inconsistency to fix.** `--start` and `--status` keep comparing against
`$repo_root` (`--start` writes `WorkingDirectory=$repo_root` into the unit;
`--status` only prints `$repo_root`). `--stop` compares against
`plot_repo_root` (from `plot-desk-root.sh`) because `resolve_wt_root` already
accepts `--stop` from a desk under the estate (#1439) — a desk's `$repo_root`
is the desk, not the main checkout the supervisor actually serves.

**`--stop` reads the owner at two points, and both matter:**
1. After `resolve_wt_root` (`plot-fleetctl.sh:1253`), before the agent loop —
   only when `supervisor_loaded` says 0. No supervisor loaded → today's
   behaviour unchanged (stop this checkout's agents, print "supervisor was
   not loaded", exit 0). On `refuse`: signal no agent, write no stop record,
   unload nothing, keep the start marker, print the refusal plus every
   supervisor on this machine that *does* serve this checkout as a ready
   `PLOT_FLEET_LABEL=<label> --stop` command, exit 1.
2. Immediately before `unload_supervisor` (`:1363`), inside the existing
   `if supervisor_loaded` block (`:1340`) — same refusal shape, sets
   `sup_unconfirmed=1` instead of a bare exit so the existing agent-summary
   printing isn't skipped. This is the race window: another checkout's
   `--start` can load the same label while this run's agent loop (up to
   `--wait` seconds per branch) is still in progress.

**`plot_processes_block` (`:381-485`) gets a second mode, not a new
function.** With a second argument (the comparison root), it prints, for each
row whose working directory matches and whose label is known, a ready
`PLOT_FLEET_LABEL=<label> plot-fleetctl.sh --stop` line — nothing else. The
existing first argument (pid to skip) still excludes the refused label's own
job. On Linux, a row carries `unit <name>` (not a label) and prints no
command — name the unit, print nothing runnable. With no matching row, the
refusal says no supervisor serving this checkout was found.

**No receipt, no `State:` line.** `plot-fleetctl.sh` is not a controller
action under "The Master Agent Uses The Controllers" — no gate names it, and
this refusal writes nothing for `plot-state-gate.sh` to check.

**Exit codes: both refusals exit 1** (matches `--start`'s refusal-4 exit 1 and
today's failed-stop exit 1). Exit 3 stays reserved for an estate refusal — do
not reuse it here.

### Done when

The plan's `## Design` and `## Slices` sections are the specification. Lift
these because a naive port of `refuse_label`'s logic would pass without them:

- The nine-case domain table above is asserted directly in
  `packages/domain/test/old-label-migration.test.ts` (one test per cell) —
  the domain's 100% coverage gate requires this, not just the three verbs
  `--stop` exercises.
- `test/reconcile/fleetctl.test.mjs`'s `askOldLabel` cases get every new verb
  × reading combination, plus exit 2 for a missing argument and a changed
  unreadable-verb fixture (the old one used `stop`, which is now valid).
- The `--stop` test matrix in the plan's Slices section (7 new cases:
  `another`, `unknown`, `another`-with-own-supervisor-visible, `this`,
  `this`-via-symlink, `this`-from-a-desk, owner-changes-between-reads) — each
  names exactly what it asserts and why it fails on unpatched `origin/main`.
  Reuse `holdLabel` and the existing stub fixtures; three of them
  (`stubUnload`, `stubSystemd`'s `show`) need a `WorkingDirectory`/`working
  directory` answer added so they keep reading `this` rather than flipping to
  `unknown` under the new check — the plan's Slices section names exactly
  which lines.
- Docs: `skills/plot-fleet/SKILL.md` §4 and §5, `skills/plot/scripts/README.md`
  (both the `plot-fleetctl.sh` and `board/plot-old-label.mjs` rows),
  `skills/plot/units/README.md:79`.

Plus the repo's standard gates: run
`node skills/plot/scripts/board/plot-local-checks.mjs` before each push and
run what it prints — do not run a full suite by hand. `pnpm build:board`
before testing locally if the bundle needs rebuilding; restore the generated
bundle path before pushing (`scripts/check-no-bundle-diff.sh` refuses a
committed bundle diff).

**Shell-lines budget is tight and tracked in the plan's own table.** The net
estimate is about 10 counted commands *fewer* than today, but
`scripts/check-shell-lines.sh` decides, not the table. If it reports growth,
move more text into the bundle — do not remove unrelated shell elsewhere to
compensate.

**Changeset:** package `plot`, patch. Description first, then the comment
block with `plan: docs/plans/2026-11-03-plot-fleetctl-stop-unloads-another-checkout.md`
and `bumps: skills: plot-fleet: patch, plot: patch` (the `plot` skill because
its scripts README changes).

### Bookkeeping

Open the PR through the controller once there's a commit to push:

```bash
../plot/scripts/plot-open-pr.sh          # ready for review
../plot/scripts/plot-open-pr.sh --draft  # while still moving
```

Never `gh pr create` directly. When the PR exists, append
`→ #<number>` to this branch's line in the plan's `## Slices` section, and
set it to "Ready" on the project board if one is configured (none is, per
this plan's Status block — skip).

### Scope guard

This branch owns:
- `skills/plot/scripts/plot-fleetctl.sh` (the `--stop`, `--start`, `--status`
  arms named above, and `plot_processes_block`)
- `packages/domain/src/rules/old-label-migration.ts` (new `labelAction`
  export, alongside unchanged `oldLabelAction`)
- `packages/domain/test/old-label-migration.test.ts`
- `packages/board/src/server/entry/old-label.ts` (the bundle `old-label.mjs`
  builds from)
- `test/reconcile/fleetctl.test.mjs`
- `skills/plot-fleet/SKILL.md`, `skills/plot/scripts/README.md`,
  `skills/plot/units/README.md`

This is the plan's only slice and only branch — no sibling branch holds any
of this territory, and no wave ordering applies.

If you find something the plan did not anticipate, report it rather than
improvising outside scope. Two things are explicitly out of scope and
already filed or noted: `--stop --dry-run` (#3099), and the desk-specific
`--status`/start-marker quirks named in the plan's Notes section (not filed).
