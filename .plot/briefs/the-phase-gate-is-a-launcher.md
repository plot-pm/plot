## Implementation brief — the-gates-are-launchers (wave: the phase gate)

- **Plan (canonical):** `docs/plans/2026-10-10-the-gates-are-launchers.md` on `main`
- **Approved:** 2026-10-10, Jan Wloka, plan PR #1494 merged
- **Branch:** `feature/the-phase-gate-is-a-launcher` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** pr

This is the fifth and final wave. Four are merged: the scaffold and
bundle-commit gate (PR #1520), the brief-name gate (PR #1529), the state gate
(PR #1540), and the controller gate (PR #1549). `GATES` in
`packages/board/src/server/entry/gate.ts:390` currently reads
`[bundleCommitGate, briefNameGate, stateGate, controllerGate]`. This wave adds
the fifth and last row. `scripts/check-decision-count.sh push origin/main`
reads **48 at `origin/main` (`d7a09a954`) — confirm against your own branch's
merge base before you push**, and the plan's target for this wave is
**48 → 47**, your PR's diff carrying that final -1 to close the plan's
ratchet out at 47. There is no remaining sibling branch to collide with —
every other wave is merged.

### What to build

Convert `skills/plot/scripts/plot-phase-gate.sh` (264 lines) into a launcher
that `exec`s `board/plot-gate.mjs` with the gate name `phase`, mirroring
`plot-state-gate.sh`'s ~13-line shape exactly (read it before you write this
one — it is the template). The decision — refuse an implementation commit
while its governing plan is still Draft or Design on the shared ref, unless
the commit touches only the plan/story directories or an explicit
`.plot/hold` entry has already been cleared — moves into a new pure rule,
`phaseGateRefusal` (new file, `packages/domain/src/rules/phase-gate.ts`),
registered as the fifth row in `gate.ts`'s `GATES` table, after
`controllerGate`.

**This gate has the most readings of the five, and most of what it needs
already exists from earlier waves — reuse it, don't re-derive it.**
`effectivePaths` (`packages/domain/src/rules/state-transition.ts:210`, built
for the state gate) already answers "what will this commit actually carry,
including a chained `git add -A` or `-am` that stages after the hook runs" —
this gate needs exactly that same question for a *different* purpose (is
every carried path inside the plan/story dirs, not does a `State:` line
change), so import and reuse it rather than writing a second effective-paths
walker. `chainedAddsOf` underneath it is already the one shared `git add`
parser (brief-name gate's comment says so). Don't write a third.

### Decisions already settled — do not re-derive them

**The phase is read from `origin/<main>`, then `origin/<branch>` — never the
working tree, and never local `main`.** This is the gate's entire reason to
exist (`plot-phase-gate.sh:21-28`): a `State: Approved` committed locally and
never pushed must not open the gate, because the question is "has this been
approved where everyone can see it", and only a shared ref answers that.
`Impl: same branch` plans put the plan file *on the work branch itself* and
never push it to main at all — for those, "shared" means the pushed copy of
*this* branch, `origin/<branch>`. Try `origin/<main>` first (so a plan that
genuinely lives on main is never shadowed by a stray push of the same slug to
a branch), fall back to `origin/<branch>` only when the first finds nothing.
Reading local `main` or the working tree is the bug this gate was built to
not have — an approval only you can see is not an approval.

**Three-way outcome when neither shared ref holds the plan, and they are NOT
the same outcome.** (1) The plan exists nowhere under the configured plan
directory on either ref, and no local copy matches the slug either → exit
allow silently, no message: unplanned quick work is legitimate and this gate
has nothing to say about it. (2) A local plan file matches the slug (by the
anchored `<plan-dir>/YYYY-MM-DD-<slug>.md` basename match, never a glob on
the slug) but neither shared ref holds it yet → allow, but print that the
phase went **unverified** and that pushing the plan is what lets this gate
see it — the bootstrap window between `/plot-idea` and the first push is not
evidence of a Draft, and blocking it would make the gate hostile to its own
onboarding flow. (3) Neither ref is readable at all (offline, no `origin/HEAD`)
→ allow, print unverified, and say to `git fetch` — this is the ONE place
this gate and `plot-dispatch.sh` deliberately diverge (per the shell
script's comment at lines 220-229): dispatch refusing costs one retried
fan-out, this gate refusing costs every commit in the repository, so it
fails open and says so rather than failing silently or failing closed.

**Draft and Design both block — this is two phases, not one, and the
message must name which.** Design is transitional: a spike or tracer bullet
still answering whether an approach works, and implementation only ever
references an *approved* plan (Manifesto). Telling a reader "still Draft"
over a plan that is actually in Design sends them hunting for the wrong
word in the refusal — title-case whichever phase string the plan parser
actually returned (`draft` → "Draft", `design` → "Design") rather than
hardcoding one.

**The plan-file match is anchored and exact, never a glob or regex on the
slug.** `<plan-dir>/YYYY-MM-DD-<slug>.md`, matched by cutting the date
prefix off the basename and comparing the remainder to `<slug>.md` by string
equality (`plot-phase-gate.sh:174-190`'s `plan_on_ref`). A slug containing a
regex metacharacter, or one that happens to be a prefix of a longer slug,
must not collide. **The phase itself comes from the domain's own plan
parser** — not a shell-out to `plot-plan-meta.sh` — since the domain already
has one (it is what `effectivePaths`/`state-transition.ts` and the approve/
deliver controllers already read plans through); find and reuse that parser
rather than adding a second phase-extraction path. If no such reusable
parser-for-a-blob-of-text function exists yet in the domain, say so in the
PR rather than silently writing a third phase regex (the shell's own is a
call to `plot-plan-meta.sh`, which itself is out of scope per the plan's "Out
of scope" section — this slice reads blob text with the domain's parser, it
does not touch `plot-plan-meta.sh`).

**The plan/story carve-out passes a Draft/Design commit when it touches only
review artifacts — refining what's under review is the point, not a bypass
of it.** A commit whose every effective path (via `effectivePaths`) is under
the `Plan directory`, the `Story directory` (including any directory sharing
the story dir's *basename* — `plot-phase-gate.sh:117-133`'s
`outside_plans_and_stories` calls out `clients/*/stories/`-style sub-unit
homes explicitly, so a basename match, not just a prefix match against the
one configured path), or `.plot/` passes even while the plan is Draft/Design.
A commit that also touches so much as one path outside those three still
blocks. This is a *different, wider* carve-out than the hold check below
(which additionally needs no-plan/story-touch to pass) — read the shell's two
separate helpers (`outside_plans` vs `outside_plans_and_stories`) as two
distinct predicates in the port, not one collapsed into the other.

**The `.plot/hold` carve-out is a second, independent block — string
equality only, never a pattern.** A line in the committed `.plot/hold` file
shaped `<branch> <free-text reason>` blocks implementation commits on
*exactly* that branch name (first-field string comparison). This exists
beside the phase check, not instead of it: a branch can be held even once
its plan is Approved (an explicit "review this code before it lands"
marker a skill wrote), and releasing the hold is a separate act from
approving the plan. The same plan/story/`.plot/` carve-out applies here too
— editing the artifact under review passes under a hold. Port this as its
own check in the rule, reading `.plot/hold`'s content as an input the gate
is handed (through a port, not a direct `readFileSync` scattered in the
entry — follow `gate.ts`'s existing pattern of reading everything through
`refs`/adapters and handing plain values into the rule).

**Fail-open on the gate's own machinery, fail-closed only on a phase it
actually read as Draft/Design.** No git, an unreadable `origin/<main>`, an
unreadable blob, no plan found anywhere — every one of these allows (several
print why, as detailed above; "no plan matches the slug at all" allows
silently). Only "the shared ref holds the plan, the parser read its phase,
and that phase is Draft or Design, and the commit touches something outside
plan/story/`.plot/`" refuses. This is the same asymmetry the state gate's
brief called out as the point of that gate, not a bug to smooth over, and it
holds here too.

**Implementation-branch recognition reads the `Branch prefixes` config,
minus `idea/`.** `idea/` branches carry the plan itself before it is
approved — gating them against their own not-yet-approved phase would be
circular. A branch matching none of the other configured prefixes (an
ad hoc branch name, or `main` itself) is not an implementation branch and
the gate has nothing to say about it at all — this check comes first, before
any ref is read.

### Done when

The plan's `## Done when` list is the specification. Lift these assertions
because a naive port would pass without them — check whether
`test/reconcile/phase-gate.test.mjs` already exercises some of these against
the shell script (it is the gate's existing contract test, the same role
`controller-gate.test.mjs`/`state-gate.test.mjs` played for their waves) and
port alongside it rather than guessing blind:

- a Draft plan on `origin/<main>` blocks a commit touching a non-plan path,
  and the refusal names "Draft" (not "Design") when that is the phase read;
- a Design plan blocks the same way and the refusal names "Design";
- an Approved (or any later-phase) plan allows the same commit;
- a commit whose every effective path is under the plan dir, the story dir
  (including a `clients/*/stories/`-shaped sub-unit home), or `.plot/`
  passes regardless of phase — including when the paths only become staged
  via a chained `git add -A`/`-am`/`--all` that runs after the hook, proven
  through `effectivePaths`, not a raw index read;
- `Impl: same branch` plans (the plan file lives ON the work branch, never
  pushed to main) are read from `origin/<branch>` once `origin/<main>` finds
  nothing, and still block/pass on the same Draft/Design rule;
- a plan matching the slug ANCHORED (`YYYY-MM-DD-<slug>.md` exact,
  no glob/regex surprise on a metacharacter-bearing or prefix-colliding
  slug) is found; a near-miss slug is not;
- a plan that exists locally but on neither shared ref allows and the
  message says the phase went unverified and to push it — distinct from the
  "no plan anywhere" silent-allow case, which prints nothing;
- an unreadable `origin/<main>` (offline) allows, prints unverified, and
  says to `git fetch` — the one place this gate and `plot-dispatch.sh`
  diverge, per the shell's own comment;
- an explicit `.plot/hold` entry for the exact branch name blocks a non-
  plan/story commit even on an Approved plan, by string equality (a
  substring or prefix match on another branch's hold line must NOT block
  this branch);
- a branch under no configured prefix (or `idea/`) is not gated at all.

The existing shell test file stays as the gate's contract test (it spawns
`plot-phase-gate.sh` directly and must keep passing once that script is a
~13-line launcher) — write the new TypeScript unit tests for
`phaseGateRefusal` (and whatever smaller named functions you split it into)
alongside it, not instead of it.

Plus: register `phase` as the fifth and final `GATES` row in `gate.ts`. Drop
`plot-phase-gate.sh`'s own standalone entry from `hooks/hooks.json` —
currently the first of the two entries there, immediately before
`plot-gates.sh`'s. Once this lands, `hooks.json` should hold exactly ONE
PreToolUse command hook, `plot-gates.sh`, with no per-gate entries at all —
this is the last one, and removing it is what finally closes the "one hook"
half of the plan's title promise. Re-run `plot-install-hooks.sh --verify` to
prove the launcher still answers through the real hook path, and confirm it
now reports the phase gate the way it already reports the other four (the
state-gate brief noted the phase gate stayed `unprobed` with its present
reason while it was still a shell decision — check whether that `--verify`
behavior needs updating now that it, too, is a launcher, or whether
`unprobed` was about something else entirely; read `plot-install-hooks.sh`
before assuming). Update `skills/plot/scripts/README.md`'s
`plot-phase-gate.sh` row: `Kind` from `decision` to `launcher`, `Replaced by`
to `board/plot-gate.mjs`, and the description to the "Launcher only, since
`the-phase-gate-is-a-launcher`" phrasing the four merged rows already use —
read their rows (lines 34-37, 60 of `skills/plot/scripts/README.md`) for the
exact shape: name where the decision now lives, what it still refuses, and
that a missing bundle allows and prints UNVERIFIED.

Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push
and run what it prints; the suites in the `CI suites` config key run in CI,
and a failure there comes back as a correction. List no full suite.

Name the shell gate in the same paragraph: `scripts/check-shell-lines.sh`
refuses a PR that grows total shell line count under `skills/` versus the
merge base (**12358 lines at `origin/main`, measured above**). This
conversion — the largest single shell file of the five at 264 lines,
collapsing to a ~13-line launcher — should net-reduce it by far more than
it costs, the way all four prior gate conversions did; you have headroom,
not a budget to spend elsewhere.

With this wave merged, `docs/shell-and-domain.md` §1 (already amended by the
scaffold slice for the one-start case) needs no further change — this slice
is "one more row in the same table", not a new cost shape. If you find the
figures there stale once this gate is live, note it rather than silently
re-measuring and overwriting without saying so.

### Bookkeeping

Open the PR through the controller, never `gh pr create`:

```bash
skills/plot/scripts/plot-open-pr.sh          # the current branch
skills/plot/scripts/plot-open-pr.sh --draft  # while the work is still moving
```

When the PR is created, append `→ #<number>` to this branch's line under the
plan's `## Slices` section, on `main`. Push the first real commit as soon as
it exists.

### Scope guard

**Owned by this branch:** `skills/plot/scripts/plot-phase-gate.sh` (becomes
the launcher); a new `packages/domain/src/rules/phase-gate.ts` (or the
functions it needs, named for what they decide) and its unit tests; whatever
small port addition reading `.plot/hold`'s content and a blob from
`origin/<main>`/`origin/<branch>` requires, following the existing `refs`/
`scriptsShell` adapter pattern the other four gates already use; the fifth
and final row in `packages/board/src/server/entry/gate.ts`'s `GATES` array;
the one remaining dropped line in `hooks/hooks.json` (leaving exactly one
entry, `plot-gates.sh`); the `plot-phase-gate.sh` row in
`skills/plot/scripts/README.md`.

**Not owned here, and not touched:** `plot-plan-meta.sh` and
`plot-config.sh` (both explicitly out of scope per the plan's "Out of
scope" section — reach config through `scriptsShell`, as the other four
gates do, and reach a plan's phase through the domain's own parser, not a
shell-out); `plot-state-receipt.sh`; the already-merged `bundleCommitGate`/
`briefNameGate`/`stateGate`/`controllerGate` rows and their rules — reuse
`effectivePaths`/`chainedAddsOf` by importing them, never by copying or
re-deriving their logic; `the-controllers-close-their-review-findings`
(#1458, #1483)'s remaining findings, which stay on that issue.

If you find something the plan did not anticipate, report it rather than
improvising outside scope.
