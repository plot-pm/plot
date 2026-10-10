## Implementation brief — the-gates-are-launchers (wave 1: One entry reads the hook)

- **Plan (canonical):** docs/plans/2026-10-10-the-gates-are-launchers.md on main
- **Approved:** 2026-10-10, Jan Wloka, plan-PR #1494 merged
- **Branch:** `feature/one-entry-reads-the-hook` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR (per plan's `Review: pr`)

This is wave 1 of 6. No gate is registered through it yet — the five gate
slices that follow (bundle, brief-name, state, controller, phase, in that
order) each add their gate's row to `plot-gate.mjs`'s table and flip their
`.sh` script to a launcher over it. This slice must not pre-empt any of
that: it builds the entry and the plumbing around it, with an empty gate
table.

### What to build

Today, five `.sh` scripts (`plot-phase-gate.sh`, `plot-state-gate.sh`,
`plot-brief-name-gate.sh`, `plot-bundle-commit-gate.sh`,
`plot-controller-gate.sh`) each run as their own PreToolUse hook on every
Bash call, each reading the hook JSON from stdin and each paying its own
`bash`+`jq` start cost. Measured on `main` at `c9d63311d`: 70.5 ms wall /
59 ms CPU summed for an `ls -la` (no commit, no gated script) across all
five, versus 33.9 ms wall / 28 ms CPU for one `bash`→`exec node` launcher
over a small bundle. Five separate launchers would cost 140–310 ms CPU per
non-commit Bash call against 59 ms today — worse, not better. **One**
launcher over **one** bundle that answers every gate is the only shape
that costs less than what it replaces.

Build that one entry and its scaffolding now, with no gate logic moved
yet:

- `packages/board/src/server/entry/gate.ts` — builds to
  `skills/plot/scripts/board/plot-gate.mjs` (declare it in
  `packages/board/build.mjs`'s `shipped*` list, the existing
  `bundles.generated.ts` contract `plot-reap.mjs` already uses). Reads the
  hook JSON from stdin **once**. Takes gate names on its command line, or
  runs every gate it knows under `--all`. Add `--list`, which prints the
  gate names it knows (for `plot-install-hooks.sh`, below) — with an empty
  table today, this prints nothing and exits 0. Exits 2 when any named
  gate refuses, printing each refusal to stderr; exits 0 otherwise. No
  registered gates yet means `--all` always exits 0 — this slice proves
  the plumbing, not a refusal.
- `plot-gates.sh` — a new launcher, the `plot-reap.sh` shape exactly (read
  it: resolve the bundle beside the script, `exec node "$bundle" --all
  "$@"`, missing-bundle message on stderr + exit 2 if the bundle is
  absent). This is the row `hooks/hooks.json` will register as the single
  PreToolUse hook — **not yet**: registering it is this slice's call,
  since nothing refuses through it until wave 2 lands. If you register it
  now, say so explicitly in the PR body, because it changes
  `plot-install-hooks.sh`'s `written`/`current`/`present` read for every
  session from this slice onward.
- `plot-install-hooks.sh` — teach it to expand `plot-gates.sh` through
  `plot-gate.mjs --list` when `hooks/hooks.json` names the one-hook form,
  so `--verify` can still drive each per-gate probe. With an empty gate
  table, `--list` prints nothing — keep the four existing per-gate probes
  (`state`, `controller`, `brief-name`, `bundle-commit`) working against
  the **existing** per-gate `.sh` scripts in this slice, since none of
  them is converted yet. The phase gate stays `unprobed` with its present
  reason, as today.
- `scripts/measure-gates.mjs` — commit the measurement instrument this
  plan used (currently a throwaway script in `/tmp`) so each later gate
  slice can re-run the same comparison at its own load and report the
  figure in its PR, per the plan's acceptance criterion ("no more CPU
  than the five shell gates at the same load" — not a fixed millisecond
  number, because load average was 18.0 on 16 cores when this plan's
  figures were taken).
- `docs/shell-and-domain.md` §1 — record the one-start-replaces-five
  case. §1 as written only covers "a script reached once per agent per
  pass belongs in shell, because a bundle start is cheap enough" — it
  names no case where one `node` start legitimately replaces several
  `bash` starts. Add that case, citing this plan's measurement: it is
  within the *purpose* of the cost rule (less CPU per call than what it
  replaces) while being outside the *letter* (no "fan-in" case existed
  before).

### Decisions already settled — do not re-derive them

**One hook, not five.** The plan's own Open Questions settled this
2026-10-10: five registered per-gate launchers would keep
`plot-install-hooks.sh` unchanged but cost 81–251 ms more CPU per Bash
call than today's five shell scripts — strictly worse. Don't propose
registering `plot-gates.sh` as five separate hook entries "for
incrementalism"; the plan explicicitly rejected that shape on cost
grounds, not on taste.

**A missing bundle allows the call and says so — it does not refuse.**
This is looser than the controller gate's own #1245 rule ("refuse when a
rule can't be asked") for exactly this one case. The reason: a hook that
exits 2 on *every* Bash call when its bundle is missing leaves the agent
no Bash call left to repair the install with — it would be locked out by
the thing meant to protect it. `plot-gates.sh` and every per-gate launcher
print `plot-gates: board/plot-gate.mjs is missing — the gates went
UNVERIFIED` (or equivalent per-script wording) and exit 0. Confirmed by
jwloka 2026-10-10 — don't harden this into a refusal later without
re-opening that question.

**The `.sh` names stay, permanently, not as a transitional shim.** Every
`plot-<name>-gate.sh` keeps its path and keeps working as its own
launcher, because adopting repositories hold per-gate entries in their
own `.claude/settings.json` (written by an earlier `plot-install-hooks.sh`
run) and `test/reconcile/*-gate.test.mjs` drives each gate by its path
today. A "clean up now that there's one entry" pass that deletes the
per-gate `.sh` files breaks both. Each per-gate script becomes a launcher
of this same `plot-reap.sh` shape — `exec node board/plot-gate.mjs
<name>` — one at a time, in the later slices. **This slice does not touch
any of the five `plot-*-gate.sh` files at all** — they keep running
exactly as they do today, independently of the new entry.

**The entry must not load git adapters on a call that doesn't need
them.** A Bash call naming no `git commit` and no gated script must cost
no more than reading stdin and asking a pure domain predicate "which
gates need readings for this command" — only then loading adapters for
those gates. With an empty gate table in this slice there is nothing to
gate on yet, but the dispatch shape (ask first, load adapters lazily)
needs to exist now so wave 2 onward adds a gate without reintroducing the
eager-load cost. The plan leaves the exact mechanism (dynamic import vs.
split build) to this slice's judgment — pick one and note the choice in
the PR, since the later slices build on top of whichever you choose.

**The hook contract itself does not change.** Input: hook JSON on stdin,
only `tool_input.command` read, cwd is the hook's own. Output: exit 2
blocks (stderr reaches the agent), any other exit allows. Each gate keeps
its own failure direction (phase/state/brief-name/bundle-commit fail
open on their own machinery; controller refuses per #1245 when its rule
can't be asked) — **one gate's exception in the entry must not decide
another gate's answer**. With zero gates registered this slice has no
exception-isolation case to prove yet, but the dispatch loop (iterate
named gates, catch per gate, collect refusals) should already be written
so a later gate's bug can't silently flip an earlier gate's exit code.

**Decision count stays at 52.** `check-decision-count.sh` counts rows by
README `kind`. This slice adds `plot-gates.sh` as a new *launcher* row —
it doesn't convert any existing *decision* row, so the count is unchanged
at 52 (15 decision, 32 readings, 4 → 5 launcher, 1 paired). Each of the
five following slices drops the count by one as it flips its gate's row
from *decision* to *launcher*, down to 47.

### Done when

The plan's `## Done when` doesn't exist as a separate list for this plan
— the per-slice description in `## Slices` is the spec for this wave:
*"`entry/gate.ts` and `board/plot-gate.mjs` read the hook JSON once and
run named gates with the per-gate exit contract (none registered yet);
`plot-gates.sh` is a launcher row; `plot-install-hooks.sh` expands
`plot-gates.sh` through `plot-gate.mjs --list`; `scripts/measure-gates.mjs`
measures per-call CPU; `docs/shell-and-domain.md` §1 records the
one-start case. Decision count stays at 52."*

Verify specifically:
- `plot-gate.mjs --all` on an arbitrary Bash command exits 0 (no gates
  registered yet — this is the naive-implementation trap: a stub that
  always exits 2, or that crashes on malformed stdin, would pass a
  shallow smoke test but fail the first real agent command).
- `plot-gate.mjs --list` prints nothing and exits 0 (proves the table is
  genuinely empty, not hardcoded to a future gate name).
- `plot-gates.sh` with the bundle temporarily renamed away prints the
  UNVERIFIED message and exits 0 — not 2. This is the assertion that
  catches a naive "fail safe = fail closed" instinct, which is exactly
  backwards here per the settled decision above.
- `plot-install-hooks.sh --verify` still reports `state`, `controller`,
  `brief-name`, `bundle-commit` as probed (against the untouched `.sh`
  scripts) and `phase` as `unprobed` with its present reason — unchanged
  from today, because this slice converts nothing.
- `scripts/measure-gates.mjs` runs and produces the same wall/CPU shape of
  numbers the plan's table shows (figures will differ by load; the shape
  — one launcher cheaper than five shell starts — must hold).
- `check-decision-count.sh` reports 52.

Plus: `plot-gate.mjs` must appear in `packages/board/build.mjs`'s
`shipped*` declarations and build cleanly via `pnpm build:board` — a
missing declaration is invisible until `check-bundle-attributes.sh` or
`check-no-bundle-diff.sh` catches it in CI, so add it before you first
commit the bundle. Run the local checks command before each push:
`node skills/plot/scripts/board/plot-local-checks.mjs`, and run whatever
it prints — do not run the full CI suites locally (`pnpm run test:e2e` is
CI's gate, not a local one; see repo CLAUDE.md § Testing).

Name the shell gate: `scripts/check-shell-lines.sh` ratchets the shipped
shell under `skills/` against this branch's merge base. This slice adds
`plot-gates.sh` (new shell, ~7 lines per the `plot-reap.sh` shape) and
touches `plot-install-hooks.sh` (likely a net addition for the `--list`
expansion). If the net shell line count grows, pay for it in the same
change — trim elsewhere, or confirm the growth is small enough the gate
doesn't fire. The gate stores no number and grants no override.

### Bookkeeping

Open the PR through the controller once the first real commit exists:
`../plot/scripts/plot-open-pr.sh` (or `--draft` while work is still
moving). Do not run `gh pr create` — it takes its title from the last
commit subject rather than this wave's heading, and won't link the plan.
When the PR is created, append `→ #<number>` to this branch's line under
`## Slices` → `### One entry reads the hook` in the plan file. Push the
first real commit as soon as it exists — don't hold a day of work
unpushed.

### Scope guard

This branch owns: `packages/board/src/server/entry/gate.ts` (new),
`packages/board/build.mjs` (one new `shipped*` entry), `skills/plot/scripts/plot-gates.sh`
(new), `skills/plot/scripts/plot-install-hooks.sh` (the `--list` expansion),
`scripts/measure-gates.mjs` (new), `docs/shell-and-domain.md` (§1 addition),
`skills/plot/scripts/README.md` (new rows for `plot-gates.sh` and
`measure-gates.mjs`), and `skills/plot/scripts/board/plot-gate.mjs`
(generated — do not hand-edit or commit outside a clean `pnpm build:board`).

No other branch of this plan is claimed yet — this is the first wave, and
every later slice (bundle, brief-name, state, controller, phase gates)
builds on top of what this slice lands, so none of them can start until
this branch merges. Do not touch any `plot-*-gate.sh` file, `rules/*.ts`
under `packages/domain/src/rules/`, or `hooks/hooks.json` — those belong
to the five slices that follow, each scoped to its own gate.

If you find something the plan did not anticipate, report it rather than
improvising outside scope.
