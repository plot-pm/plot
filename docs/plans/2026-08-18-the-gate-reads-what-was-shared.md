# The gate reads what was shared

> `/plot-dispatch`'s phase gate parses the plan file in the working tree. An approval that exists only in someone's local branch opens it; an approval everyone can see does not, if the checkout is parked elsewhere.

## Status

- **Phase:** Draft
- **Type:** bug
- **Review:** in-session
- **Impl:** own branches

## Changelog

- The phase gate reads the plan as it exists on the shared ref, so a local-only approval cannot open it and a shared approval cannot be hidden by a checkout parked on another branch.

## Motivation

Reproduced in a sandbox 2026-08-18, both directions.

**It refuses work that is approved.** With the plan `Approved` on `origin/main`
and the checkout left on another branch carrying an older copy:

```
checkout left on: other-agent-branch
origin/main phase:  Approved
what plot reads:    draft
plot-dispatch: plan '2026-08-18-p' is still Draft — nothing may be dispatched.
```

**It permits work that is not.** With the plan `Draft` on `origin/main` and an
approval committed only to a local branch, never pushed:

```
origin/main phase: Draft   <- NOT approved
would dispatch feature/x → /private/tmp/gate/plot-wt-feature-x
summary: dispatched=1 ...
```

The second is the serious one. Manifesto Principle 2 is *plans are approved
before implementation*, and the gate is what enforces it. A gate that accepts an
approval nobody else can see does not enforce that principle — it enforces
"someone typed Approved in this filesystem". Nothing was reviewed, nothing was
shared, and agents fan out anyway.

### Why it happens

`plot-dispatch.sh` resolves the plan as a filesystem path and parses whatever is
there:

```
223:  for cand in "$ACTIVE_DIR_CFG$slug.md" "$PLAN_DIR_CFG"*"$slug".md; do
232:  gate_meta=$("$script_dir/plot-plan-meta.sh" "$plan_file" 2>/dev/null)
```

The working tree is the least trustworthy surface available in a repo with
several agents in it. It carries whatever branch was last checked out, plus
uncommitted edits, and neither is a fact anyone else shares.

### It is not hypothetical

This bit three times in one session, on the session's own operator. A concurrent
agent's `git checkout` moved the shared checkout twice; on the second occasion
`/plot-dispatch` refused two correctly-approved plans as "still Draft", and the
approvals were sitting on `origin/main` the whole time. A third occasion put a
commit onto the other agent's branch.

The workers were never affected. `/plot-dispatch` gives each one an isolated
worktree, which is exactly the protection the dispatching process lacks.

## Design

### Approach

**Read the plan from the shared ref.** Resolve `origin/$MAIN` and read the plan
blob from it — `git show origin/$MAIN:<plan path>` — rather than opening the
path. The gate then asks the question it means: *has this plan been approved
where everyone can see it?*

The three-way outcome, and what each means:

| Situation | Gate |
|---|---|
| Approved on the shared ref | opens |
| Draft on the shared ref | refuses, naming the ref it read |
| The ref cannot be resolved (no remote, fresh clone) | refuses, saying it could not check |

The third row matters. An unresolvable ref must not fall back to the working
tree — that reintroduces the bug precisely where nobody would notice. A repo
with no remote is a real case, and `--allow-local` (explicit, documented, named
in the refusal message) is the escape hatch rather than a silent default.

**Say which ref was read.** A refusal that names `origin/main@<sha>` is
debuggable in seconds. The refusals measured above said only "still Draft",
which sent an operator looking at a file that already said `Approved`.

### Alternatives considered

**Warn when the checkout is not on the default branch.** Cheap, and would have
caught the session's failures. But it is advice, not a gate — and the
local-only-approval direction survives it untouched.

**Require a clean working tree.** Refuses when the plan file is modified. Closes
the local-only case, but breaks the legitimate flow where `/plot-idea` writes a
plan and dispatch follows in the same session before a push.

Both are weaker than reading the ref, and neither is simpler once the fallback
rules are written down.

### Open Points

- [ ] Does the same working-tree read affect the other gates — `/plot-approve`'s
      Draft check, `/plot-deliver`'s open-PR check, `/plot-release`? Each was
      written the same way and deserves the same question, but they are separate
      commands and may warrant separate fixes.
- [ ] Should `--allow-local` exist at all, or should a remote-less repo be told
      to configure `Main branch` and use a local ref? An escape hatch that is
      easier to type than to justify becomes the default.
- [ ] `plot-phase-gate.sh` (the PreToolUse hook blocking implementation commits
      while a plan is Draft) reads the same way. It is the strongest gate in the
      system and the one most worth checking next.

## Branches

- `bug/the-gate-reads-what-was-shared` — read the plan blob from `origin/$MAIN` in `plot-dispatch.sh`'s gate, refuse when the ref is unresolvable, name the ref in every refusal, and add `--allow-local` as the explicit escape. Tests: both sandbox reproductions above — a shared approval hidden by a parked checkout must dispatch, and a local-only approval must be refused.

## Notes

Found while dispatching three fix branches during a live fleet run. The two
sandbox reproductions in Motivation are deterministic and belong in the test as
written; neither depends on timing or on another agent being present.

Related: `docs/plans/2026-08-18-the-board-never-shrinks-on-a-success.md` fixes
the same working-tree-versus-ref confusion in `plot-fleet-scan.sh`'s plan
enumeration. That one costs a misleading display; this one costs the approval
gate. They are the same mistake at two altitudes and should probably be read
together, but they are in different files and independently fixable.
