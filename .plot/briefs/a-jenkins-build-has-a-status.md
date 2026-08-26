## Implementation brief — i-can-see-whether-my-build-passed (wave Reported)

- **Plan (canonical):** `docs/plans/2026-08-26-i-can-see-whether-my-build-passed.md` on main
- **Approved:** 2026-08-26, Jan Wloka, in-session
- **Branch:** `feature/a-jenkins-build-has-a-status` (base: `main`)
- **Ends as:** one PR to main
- **Review of the code:** repo convention (CI green + review)

The plan's only wave. Nothing waits on it and it waits on nothing.

### What to build

`plot-host.sh` resolves a branch's `checks` value through `jen` when the repo
declares `CI: jenkins`, so build status on the board is a fact for a Jenkins
team rather than a permanent blank.

Today `plot-host.sh` contains **zero** references to `jen` (`grep -c jen` → 0).
The probe already detects the CLI, a Jenkinsfile and the instance;
`plot-config.sh:61` documents `CI: jenkins`. The trail ends one step before the
board: a team is asked for its Jenkins instance, the answer is recorded, and
nothing ever reads it.

### THE SPIKE IS DONE — do not re-run it

The wave originally opened with a spike. **It was run during interrogation**
(2026-08-26, `jen` 0.2.0, `jenkins-ci-webbloqs.internal.quatico.dev`, job
`webbloqs/continuous-build-multi`):

```
$ time jen -I <instance> job list webbloqs/continuous-build-multi --json
45 branches, each {name, color}          0.17 s, ONE call
```

**One call per refresh, no cache.** `--depth` was not needed: a multibranch
job's branches are its children. Done-when 5 is therefore free — do not build a
cache, and do not add a per-branch call.

### The decisions the plan settles — do not re-derive them

**The colour table is decided.** The fast path returns only `{name, color}`:

| Jenkins | means | `checks` |
|---|---|---|
| `blue` | last build succeeded | `passing` |
| `red` | last build FAILED | `failing` |
| `yellow` | **UNSTABLE** — ran, tests failed, no error | `failing` |
| `disabled` / absent | no build to report | `none` |
| `*_anime` suffix | a build is RUNNING | `pending` |

**`yellow` → `failing` is a decision, not an oversight.** Jenkins frames
UNSTABLE as *not red*; mapping it to `passing` would be faithful to Jenkins and
wrong here, because a branch whose tests failed would read green on a board
people use to decide what is ready.

**`*_anime` → `pending` is READ FROM DOCS, NOT MEASURED.** Nothing was building
during the spike. Verify it against a live build and correct the plan's table if
the suffix does not appear as documented — that is Done-when 8, and it is yours.

**Decode branch names before joining.** Measured: **27 of 45 names arrived
percent-encoded** (`bugfix%2FCDSTLZ-189` for `bugfix/CDSTLZ-189`); none arrived
with a raw slash. An equality join without decoding misses every slashed branch
**as `none`** — indistinguishable from having no build, so it fails silently.

**Multibranch only.** Parameterised and webhook-triggered jobs report `none`
rather than a guess. The non-multibranch question is an OPEN POINT in the plan,
deliberately not settled — do not invent a job-name pattern key.

### `jen` exits 0 on failure — Done-when 4 cannot use `$?`

```
$ jen -I <instance> auth status ; echo $?
Keycloak:      signed in
Jenkins auth:  NOT reachable
0
```

`plot-board-probe.sh:193` records the sharper form: **a slug that does not exist
still prints "Keycloak: signed in"**, because the slug expands into a URL
pattern without being reached. Only the `Jenkins auth:` line carries the answer.

Reuse the discipline `classify()` in that probe already encodes: match the
success text, and **degrade to failure rather than to `ok`** when the wording is
unrecognised. An implementation that checks `$?` reports a reachable-but-empty
Jenkins and passes Done-when 2 while doing so.

This is the sibling trap to the Bitbucket plan's, from the other direction:
`bb` writes errors to stdout and exits 1 for everything.

### `checks:"unknown"` already exists — use it for a dead Jenkins

`plot-host.sh:490` documents a FIFTH state the plan's four do not name:

> *"--rich reports checks:"unknown" and mergeable:"unknown" — a consumer must
> render those as 'unavailable', never as green and never as clean."*

That is the right per-row answer when Jenkins was asked and failed. Done-when 4
says "exits 3", and that is correct for the op as a whole — but **one dead
Jenkins must not blank out the entire PR list**. Prefer `checks:"unknown"` on
the affected rows over failing the whole command, and keep exit 3 for the case
where the op itself cannot proceed.

If you conclude those two cannot both hold, say so in the PR rather than
choosing silently — it is the one place this brief and the plan's Done-when may
read differently.

### `CI` and `Git host` are INDEPENDENT keys

`plot-host.sh:203` resolves the backend from `Git host` (default `github`);
`CI: jenkins` is a separate key. So a Jenkins arm can pair with EITHER backend —
a Bitbucket repo with Jenkins gets its PR list from `bb` and its `checks` from
`jen`, joining two hosts in one `--rich` row.

Do not attach the Jenkins path to the Bitbucket branch of the `if`. It is
orthogonal to the backend, and Done-when 3 (a GitHub repo still reads its own
rollup) is what catches getting this wrong.

### Done when

The plan's `## Done when` list is the specification — all nine items. Four exist
because a naive implementation passes without them:

- **Item 4** — an unreachable Jenkins is detected WITHOUT `$?`.
- **Item 6** — a branch whose name contains `/` joins correctly (the 60% miss).
- **Item 7** — `yellow` reports `failing`, not `passing`.
- **Item 8** — a RUNNING build reports `pending`; verify `*_anime` for real.

Plus the repo's gates: `pnpm run validate`, `pnpm run test:reconcile`. Node 24
(`nvm use`) — pnpm crashes on 26; use `corepack pnpm` if the homebrew one
misbehaves. Add a changeset with a `bumps:` block for `plot`.

**Note `pnpm test` is NOT a test run in this repo** — it is `skills add . --list`
and prints an installer listing. The skill gate is `pnpm run validate`.

**You cannot reach a Jenkins from CI**, and the instance used for the spike is
internal. Test the parse and the join against captured fixture JSON — the shape
is a flat array of `{_class, name, color}`. Do not add a test needing Jenkins
auth or network.

### Bookkeeping

When the PR exists, annotate the wave heading on main — this is a `## Waves`
plan, so the PR goes **inside** the heading:

```
### Reported (Branch: feature/a-jenkins-build-has-a-status, PR: #N)
```

A trailing `→ #N` parses as `prs=[]`. Check `git branch --show-current` is main
before that edit. Push your first real commit as soon as it exists.

### Scope guard

This branch owns the Jenkins arm of `pr-list --rich` in
`skills/plot/scripts/plot-host.sh`, and its tests.

**Do not change the GitHub rollup logic** at `plot-host.sh:395-480`. Done-when 3
pins that a GitHub repo behaves exactly as today.

**Do not touch the Bitbucket `issue-list`/`issue-view` arms** —
`feature/a-bitbucket-issue-is-a-ticket` (PR #449) is live in that same file
right now. Rebase onto current main before you finish and expect to meet it.

**Do not add a `Jenkins job path` config key.** The job path derives from the
branch name for a multibranch job; anything else is the plan's open point.

The board artifact `skills/plot/scripts/board/board-server.mjs` is generated and
marked `-merge`. Never read its diff — take either side, run `pnpm build:board`,
stage the **rebuild** (not the merge's copy), then commit.

Do not commit `packages/board/test/fixtures/tiny-garden/.plot/state/last-pulse.json`
— every board suite rewrites it, and a dirty copy makes
`plot-resolve-artifact.sh` refuse with `worktree-busy`.

If you find something the plan did not anticipate, report it rather than
improvising outside scope.
