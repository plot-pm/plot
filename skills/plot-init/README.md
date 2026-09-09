# plot-init — developer notes

Adoption for a repo that does not have Plot yet. `SKILL.md` is the
agent-facing instruction; this file is why it looks the way it does.

## Where this came from

Adopting Plot used to mean pasting a long prompt into a fresh session — one
that hardcoded per-repo parameters, cited a reference repo to copy from, and
mixed generic Plot setup with one organisation's house rules (a specific git
host wrapper, reviewer agents, session logs, a four-phase process).

That works exactly once per organisation and rots on every Plot release. The
prompt behind this skill still named `plot 1.6.0` and required front-matter
keys the parser no longer reads.

The rewrite splits it along one line: **generic Plot setup is the skill; house
rules are optional extensions, offered only where the repo shows a signal for
them.** A Bitbucket repo gets the `bb`-not-`gh` note; a GitHub repo never
hears about it.

## Probe, don't interview

`plot-detect-repo.sh` answers what is visible: git host, quality-gate scripts,
ticket scheme, commit style, existing planning directories, hub docs, whether
a config already exists.

The skill then presents a **complete proposal** and asks only what the probe
could not read. Asking a user to confirm their own git host teaches them the
tool is not paying attention — and that is how a five-question adoption turns
into a twenty-question interrogation nobody finishes.

Exactly one thing is always asked: the **Definition of Done**. The probe finds
candidate scripts; only a human knows which of them gates a merge.

## Deliberately conservative detection

Every field is a proposal, so a wrong guess costs one correction — but a guess
dressed up as a fact costs trust. Two rules follow:

- **A ticket prefix must recur.** One stray `ONEOFF-1` in a subject line is
  not a scheme. Without the recurrence check the probe proposes a ticket
  scheme to a repo that has none, and the user has to notice and undo it.
  (Caught by sabotaging the detector: the first version of the test missed it.)
- **Only recognisable gate names count as DoD candidates.** A repo's `deploy`
  or `start` script is not a quality gate; offering it as one undermines the
  whole proposal.

Where a signal is ambiguous the field is empty and the skill asks.

## The stack is proposed, not defaulted

Adoption reads two signals about a team's stack and turns each into a config
key: a recurring ticket prefix proposes `Tracker:`, and `ci_system` proposes
`CI:`. **Whether a prefix recurs often enough is `proposeTicket`'s answer**, in
`@plot-pm/domain`, reached through `board/plot-propose-stack.mjs` — the probe
reports the prefix and its count and decides neither.

**The silent default was the defect.** A repository that declares no tracker
gets `trackerNone`, which answers `unaskable` on every issue operation —
correct for a repo with no tracker, and a lie about a team that has Jira.
Nothing distinguished the two: `unaskable` reads the same whether there is no
tracker or nobody asked. Measured 2026-09-07, `jira` and `jenkins` appeared
zero times across the whole adoption path.

**The evidence travels with each proposal.** `jira (QUACDS in 38 of 80
subjects)` is confirmable in one read; a bare `jira` is indistinguishable from
a guess, and one unexplained proposal costs the whole block its credibility.

**One signal proposes, two signals ask — and `proposeCi` is where that lives.**
Where a `Jenkinsfile` and `.github/workflows/` are both present, adoption does
not tie-break on the git host — a team on GitHub running Jenkins is common, and
a wrong `CI:` sends every build-status lookup to the wrong system. The rule
answers `propose`, `ask` or `silent`, and **an `ask` carries no proposed word**:
a field holding `jenkins` beside an `uncertain: true` invites a caller to read
the first half, so there is no half to read. It was prose in two skills until
2026-09-09, which by CLAUDE.md's own test made it a rule rather than a gate —
you could answer *did I complete this?* without doing the work.

**The base URL is the only question added.** A prefix gives `QUACDS` and no
host, and `tracker-jira.ts` needs one. Rather than guessing it from a remote or
leaving the tracker unset, adoption proposes the scheme it measured and asks
for the one thing it cannot read — the smallest honest shape, and the one that
keeps *propose, don't interrogate* intact.

**Unattended, the proposal survives and the question does not.** A measured
prefix still proposes `Tracker: jira` with the URL unset and says the URL is
missing. A half-configured tracker that announces its gap beats one that fails
later saying nothing. Two CI signals refuse the key outright, because a wrong
`CI:` is worse than an absent one.

## Additive, always

Adoption never moves, rewrites, or deletes anything. A repo with four
overlapping planning systems keeps all four — the skill offers to *describe*
the boundary in a `docs/plans/README.md`, and the human decides what is
canonical.

This is not politeness. Migrating someone's plans destroys both their history
and their own organisation of it, and no probe can tell which of four
directories is the one they still rely on.

## Degrade, never abort

The steps are largely independent, so one blocked file must not sink the rest.
The sharpest case is `.claude/settings.json`: if it is missing, create it; if
it exists, merge and preserve every key; if it is malformed or unwritable,
**print the block, ask, and continue.**

A blocked settings file costs slash-command convenience and nothing else —
the entire lifecycle works with plain git. Aborting the adoption over the
least important step would be the worst possible trade.

## Why adoption writes `.gitignore`

**This is the one file adoption touches that Plot does not own.** Everything
else lands in Plot's own territory — a `## Plot Config` section, `docs/plans/`,
`.plot/`. `.gitignore` is read by every tool the team uses, which is why the
line is appended on the confirmation step 2 already takes, and why the file is
never rewritten.

**The alternative was printing it for a human to paste, and that is the
defect.** `Worktree root: .worktrees` with no ignore rule turns every
dispatched desk into untracked files in `git status`, and the operator's next
`git add -A` stages a whole checkout. A line left to a person is a line that
does not get added — so the key and its ignore rule are confirmed together and
written together, and neither is written alone.

Measured 2026-09-06, which is why the slice exists: the skill named
`Worktree root` **zero times** and `.gitignore` **zero times**. An adopting
repository got the layout without being told and without the rule.

**A directory and a plan skeleton are larger commitments than one ignore
line**, and adoption writes both today. The novelty here is the file, not the
size of the write.

## The absent-key default is not the proposal

With no `Worktree root` key, `plot-dispatch.sh` uses the repository's **parent**
with a `plot-wt-` prefix — desks scattered beside the checkout, mixed with
unrelated repositories. A relative value resolves inside the repo and the
prefix is dropped, because the directory already says what those checkouts are.

So proposing `.worktrees` **changes** where desks go. That is the reason to
propose it rather than leave the default implicit, and the reason the ignore
line is needed at all: the legacy default puts nothing inside the repository,
and the proposed layout puts a whole checkout there.

## A repo with its own convention keeps it

`plot-init`'s guiding rule is *propose, don't interrogate*, and every field
`plot-detect-repo.sh` reports is *a proposal a human confirms*. This joins
them, so the skill reads `git worktree list` before proposing and names what it
found — the same thing `plot-board-setup` does when it counts `plot-wt-*`
siblings.

**The signal is read in the skill, not added to the probe.** The probe's
contract has other callers, and interpreting *where do this repo's worktrees
live* into a proposal is judgment rather than collection — Manifesto Principle
3, the same argument that keeps the ticket prefix out of `plot-board-probe.sh`.

**Relocating is never adoption's.** `/plot-dispatch --migrate` moves existing
worktrees on a person's say; adoption is additive and moves nothing.

## The desk's own exclusion is a different rule

`plot-dispatch.sh` writes a marker into each desk's `.git/info/exclude`. That
is per-clone on purpose: a rule living in branch content is invisible to a
worktree cut from an older branch, and an untracked file there reads as
unlanded work.

Adoption writes the **repository's** line, in the repository's `.gitignore`.
The two look similar and protect different things, and this slice does not move
the second one.

## What is NOT created by default

`docs/sprints/` and `docs/stories/`. Both are optional lenses, and an adopting
repo should not start with empty directories nobody asked for. Same reasoning
for posture keys (`Plan PRs`, `Implementation home`, `Hosts plans`): they
appear only when the answer is not the default, so a new adopter is not
handed a wall of settings they never chose.

## Tests

`test/reconcile/init.test.mjs` builds throwaway repos of each shape — GitHub
and Bitbucket remotes, scripts with and without gates, commits with and
without ticket keys, three commit notations, pre-existing planning systems,
both hub docs, an already-configured repo, and a bare repo with nothing in it.

Two properties matter most and are asserted directly: the probe is
**read-only** (a probe that edits the repo it is inspecting is unusable as the
first thing a stranger runs), and it **survives an empty repo** without
crashing.

`test/reconcile/init-worktree-root.test.mjs` covers the two cases this
proposal adds, both of them about a skill rather than a script — so what is
asserted is the **instruction**, in the same way `test/reconcile/hooks.test.mjs`
asserts what a hook file declares. It checks that the skill proposes the key
with its ignore line as one decision, that it reads the existing convention
before proposing, that it forbids printing the line to paste, and that it
leaves `.git/info/exclude` to dispatch. A decline writes neither half, which is
step 2's existing confirmation gate rather than a new mechanism.

## Known gaps

- The language hint is weak — a keyword count over the hub doc. It only nudges
  template wording, so a wrong guess is cheap.
- No detection for monorepo layouts; a workspace root and a package both look
  like ordinary repos.
- The skill writes the config but does not verify the DoD commands actually
  run. Confirming that is the adopter's first real use of the workflow.
- **`plot-detect-repo.sh` does not emit `ci_system` yet.** The `CI:` proposal
  above reads a field the probe is specified to report and does not, so it is
  inert until that slice lands: the tracker half works today because the
  ticket prefix already exists. Measured 2026-09-08 — the sibling slice
  `feature/the-probe-reads-the-ci-system` merged as PR #811 carrying **zero
  files**, its claim commit only. The signal itself is already read next door,
  as `ci_signals.{jenkinsfile,gh_workflows}` in `plot-board-probe.sh`, which is
  where the probe's field should derive its shape from. **The judgement half
  landed 2026-09-09**: `proposeCi` decides what the two signals answer, and the
  entry reads `ci_signals` when a probe reports it. Until this probe does, `ci`
  is `null` here — *nobody looked*, which the skill states rather than reading
  as `silent`.
