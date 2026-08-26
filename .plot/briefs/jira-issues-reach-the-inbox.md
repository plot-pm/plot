## Implementation brief — my-jira-tickets-are-in-the-inbox (wave Listed)

- **Plan (canonical):** `docs/plans/2026-08-26-my-jira-tickets-are-in-the-inbox.md` on main
- **Approved:** 2026-08-26, Jan Wloka, in-session
- **Branch:** `feature/jira-issues-reach-the-inbox` (base: `main`)
- **Ends as:** one PR to main
- **Review of the code:** repo convention (CI green + review)

Wave 2 of 2. `Keyed` merged as **#447** — `plot-plan-meta.sh` already accepts
`PROJ-123` in the `Issue:` field. This wave makes the tracker answerable.

### What to build

`issue-list` and `issue-view` resolve through **Jira** when the repo declares
`Tracker: jira`, emitting the contract that already exists.

### Read the merged Bitbucket arm FIRST — it is your template

`feature/a-bitbucket-issue-is-a-ticket` landed as **#449** in this exact file
and solved the same problem for a different host. Read `issue-list)` and
`issue-view)` in `plot-host.sh` before writing anything.

It establishes the shape you must match:

- **THREE OUTCOMES, KEPT APART** — an empty list means *the host answered and
  there are none*; a non-zero exit with empty stdout means *the question
  failed* (exit 3); exit 4 means *this host cannot be asked at all*. Collapsing
  any two is the defect both plans exist to prevent.
- **READ-ONLY in both directions.** Nothing writes a label, an assignee or a
  close. A plan referencing an issue is Plot's record, not the tracker's.
- Contract: `{number,title,url,createdAt}` per line for `issue-list`,
  `{number,title,body,url}` for `issue-view`.

### The decisions the plan settles — do not re-derive them

**REST API with a token from the environment. No CLI dependency.** `gh` and `bb`
are already two binaries an adopter installs; a third would make the Jira path
the hardest to adopt, for the tracker most likely to sit behind corporate SSO.
Shell out and shape with `jq`, exactly as the other ops do.

**Ignore the plan's stale heading** *"Which `jira` (ankitpokhrel/jira-cli) and
`acli` are candidates, as is the REST API"*. It contradicts the settled decision
directly above it and is a leftover from round 1. **REST is chosen.** If you
think it is wrong, say so in the PR — do not quietly pick a CLI.

**`number` is the Jira key** (`PROJ-123`), not an integer. #447 already taught
`plot-plan-meta.sh` to read that form, which is why this wave is useful.

### `Tracker` is a key NOTHING reads yet — you are adding the first reader

**Measured: `plot-host.sh` contains zero references to `Tracker`.**
`plot-config.sh:58` documents it (`plot | jira | github-issues | linear`), and
nothing consumes it. That is the whole motivation for this plan's sprint.

**`Tracker` is INDEPENDENT of `Git host`.** `backend()` at `plot-host.sh:195`
resolves `github|bitbucket` and knows nothing about trackers. A Bitbucket repo
tracking in Jira is the normal enterprise case and must work.

So the issue ops dispatch on **`Tracker`**, while every PR op keeps dispatching
on `backend()`. Do not route the issue ops through `backend()`, and do not add
`jira` as a third value of it — it is not a git host.

**Absent `Tracker` must behave exactly as today** (Done-when 2): a GitHub repo
that declares nothing resolves through `gh issue list` as it always has. This
is opt-in.

### Done when

The plan's `## Done when` list is the specification. Plus, carried from the
sibling and NOT optional:

- **A failure exits 3; a tracker that cannot be asked exits 4; an empty list is
  a successful answer.** Three outcomes, three exits.
- **An auth failure must not read as an empty inbox.** An empty inbox says *you
  have no tickets*, which is the failure this whole story is named for.

Plus the repo's gates: `pnpm run validate`, `pnpm run test:reconcile`. Node 24
(`nvm use`); `corepack pnpm` if the homebrew one misbehaves. Add a changeset
with a `bumps:` block for `plot`.

**`pnpm test` is NOT a test run here** — it is `skills add . --list`.

**This repo has no Jira instance.** Test against captured fixture JSON and a
stubbed curl, exactly as #449 tests `bb` with a stub on `PATH`. Do not add a
test needing network or a token.

### Bookkeeping

When the PR exists, annotate the wave heading on main — `## Waves` plan, so the
PR goes **inside** the heading:

```
### Listed (Branch: feature/jira-issues-reach-the-inbox, PR: #N)
```

A trailing `→ #N` parses as `prs=[]`. Check `git branch --show-current` is main
before that edit. Push your first real commit as soon as it exists.

### Scope guard

This branch owns the Jira arm of `issue-list`/`issue-view` in
`skills/plot/scripts/plot-host.sh`, and its tests in `test/reconcile/`.

**Do not touch the Bitbucket or GitHub issue arms** — #449 just landed them and
they are correct.

**Do not touch `pr-list --rich`** — #450 (Jenkins checks) just landed there.

**Do not write issue mutations.** Jira's API exposes create/update/transition;
Plot deliberately does not use them.

`test/reconcile/host.test.mjs` has just been through a three-way conflict
between #449 and #450. Rebase onto current main before you finish, and if you
meet a conflict there, keep BOTH test blocks — they are independent suites.

If you find something the plan did not anticipate, report it rather than
improvising outside scope.
