---
name: plot-board-setup
description: >-
  Set the Plot board up in a project that already has Plot: probe the
  prerequisites, record the git-host and CI configuration, then start the
  board and prove it serves. Use on /plot-board-setup.
globs: []
license: MIT
metadata:
  author: eins78
  repo: https://github.com/plot-pm/plot
  version: 0.2.0
compatibility: >-
  Designed for Claude Code and Cursor. Requires git, bash, curl, and Node
  >= 20. Git-host and CI CLIs are optional — the board works without any of
  them. The plugin start route is Claude Code-specific; on Cursor the probe
  finds no plugin directory and falls through to the npm or checkout route.
---

# Plot: Board Setup

The board reads the **current working directory**, not its own location, so it
runs in any repository without installation. What a project actually needs is
the configuration around it, and evidence that it works.

**The guiding rule: prove, don't assert.** A board that boots and serves valid
JSON can still show nothing — a plan in the wrong format parses as
`format: none` and vanishes silently. Checking that the port responds would
pass that case. So this command starts the board, fetches its data, and checks
the cards.

**Input:** `$ARGUMENTS` is optional; `--dry-run` reports what would be written
and changes nothing. `--start` skips setup entirely — it resolves the artifact,
starts the board, proves it answers, and prints the URL. The same rule governs
it: a board that did not come up must say so.

## Two ceremony levels

Setup is a once-per-repo ceremony. Starting the board is a daily action, and
re-running the probe, the config write, and the auth checks every time someone
wants to look at their board is ceremony that does not scale with the weight of
the action (Manifesto Principle 10).

| Invocation | Does |
|---|---|
| `/plot-board-setup` | Steps 1–5 below: probe, propose, write config, verify, summarise |
| `/plot-board-setup --start` | Step S below: probe for the artifact path, start the board, prove it answers, print the URL |

`--start` writes no config and runs no auth check. It refuses when
`artifact_source` is `none` — there is nothing to start — and it reports that
rather than repairing it: a repo that needs setup should be told to run setup.

Unlike step 4b, `--start` leaves the board **running**; it is the thing the user
asked for, not a probe. So it does not use `plot-board-verify.sh`, whose whole
purpose is to reap the server it started.

## Model Guidance

| Steps | Min. Tier | Notes |
|-------|-----------|-------|
| 1. Probe | Small | Two script calls, JSON out; merge without transforming |
| 2. Propose and confirm | Mid | Turning signals into proposals — and reading a one-directional signal (prefix proposes, silence asks) — is judgment |
| 3. Write config | Small | Append known keys to a known section |
| 4. Verify | Small | Run commands, compare to documented output shapes |
| 5. Diagnose an empty board | Mid | Mapping a parse failure to a human cause |
| S. `--start` | Mid | Mechanical to start; judgment to tell *your* board from another on the port |

> **User interaction:** Use `AskUserQuestion` (Claude Code) / `ask_question` (Cursor).
>
> **No user present?** If `PLOT_UNATTENDED=1` is set, do not call the question
> tool — each question below declares what to do instead, and every skipped
> question is named in the output. See
> [Running unattended](../plot/docs/unattended.md).

## Steps

### 1. Probe

Setup asks two questions, so it reads two probes:

```bash
../plot/scripts/plot-board-probe.sh    # can the board run here?
../plot/scripts/plot-detect-repo.sh    # what is this repo?
```

Both are read-only. Merge their reports; **neither script grows the other's
field** — the composition lives here, in the skill, because interpreting two
collectors into one proposal is the skill's job (Manifesto Principle 3: scripts
collect and report, skills interpret and adapt). The probe's contract has other
callers, so it must not be asked to carry a `ticket_prefix` it never had.

`plot-board-probe.sh` reports the Node version, whether the CWD is the repo
root, where a board artifact lives, whether a `## Plot Config` exists, how many
plan files there are, the CI signals present (`ci_signals.jenkinsfile`,
`ci_signals.gh_workflows`), and the install/auth state of `gh`, `bb`, and `jen`.
Its `git_host` is the **configured** `Git host` key, not an inference — empty
until something writes it.

`plot-detect-repo.sh` answers what the probe cannot: the git host **inferred**
from origin's URL, and a `ticket_prefix` inferred from the commit log. These are
the structural signals setup proposes from.

**If `has_plot_config` is false, stop.** Board setup presupposes adoption —
point at `/plot-init` and do not re-implement it here.

**If `artifact_source` is `none`, stop** and report both routes:

- the Plot plugin (nothing to install if Plot is already a plugin), or
- `npx @plot-pm/board`

### 2. Propose, then confirm

Present one block the user corrects rather than composes:

> Detected: Node 24 · git root is the CWD · plugin artifact · `docs/plans/`
> with 7 plans · origin is `bitbucket`, `bb` authenticated · `Jenkinsfile`
> present · `QUACDS-*` in 6 of 80 commit subjects · `jen` installed, Jenkins
> token missing.
>
> Proposed: start via the plugin artifact with a `plot-board` alias. Add
> `Git host: bitbucket`, `CI: jenkins`, `Tracker: jira` and
> `Jenkins instance: apps` to Plot Config.

**One signal proposes, two signals ask.** Every inferred field is a *proposal*
built from a single structural signal. Where two signals point different ways,
setup does not tie-break — it asks, naming what it found. This is the general
rule below, not a special case for any one field.

Turn the merged signals into proposals:

- **Git host** — propose `plot-detect-repo.sh`'s inferred `git_host`
  (`bitbucket` from a `bitbucket.org` origin). It is a proposal, not a config
  read: the probe's `git_host` is empty until this write.
- **CI** — see the both-signals rule below. A lone `Jenkinsfile` proposes
  `CI: jenkins`; a lone `.github/workflows/` proposes `CI: github-actions`.
- **Tracker** — a repeated ticket prefix is strong evidence **for** a Jira
  tracker. When `plot-detect-repo.sh` reports a non-empty `ticket_prefix`,
  propose `Tracker: jira` **with the evidence named**:

  > Found `QUACDS-*` in 6 of 80 commit subjects → propose `Tracker: jira`.

  The prefix is one-directional. `ABC-123` is Jira's convention, but Linear and
  GitHub issues carry prefixed keys too — perfect correlation in this
  population, a proposal never an assertion anywhere else. So it *proposes*, and
  a human confirms. **Absence proves nothing** (half of Bitbucket repos carry no
  prefix): an empty `ticket_prefix` is not evidence against a tracker, so it
  **asks** the open question below and **never proposes `Tracker: none`** from
  silence.

**The CI both-signals rule (Item 1b).** Where `ci_signals.jenkinsfile` **and**
`ci_signals.gh_workflows` are both true, setup **does not propose** — it asks,
naming both:

> Found a `Jenkinsfile` and 3 workflow files. Which runs your PRs?

Do **not** tie-break on the git host. A team on GitHub running Jenkins is
common — it is exactly this sprint's user — and a silent wrong `CI:` key sends
every build-status lookup to the wrong system.

> **Unattended (`PLOT_UNATTENDED=1`):** refuse the key rather than guessing
> which CI runs the PRs — a wrong `CI:` is worse than an absent one, for the
> same reason a wrong Jenkins instance is. Write no `CI` key and disclose:
>
> `PLOT-UNASKED: which CI runs the PRs — refused — both signals present, no CI key written`

Ask only what the merged probes could not answer:

- **The tracker** — when no `ticket_prefix` was found, ask which tracker the
  repo uses (`plot` · `jira` · `github-issues` · `linear`). Silence is not a
  proposal, and it is never `none` by default.

  > **Unattended (`PLOT_UNATTENDED=1`):** refuse the key rather than guessing a
  > tracker. A wrong `Tracker` has the Jenkins slug's exact shape: a wrong
  > `Tracker: jira` sends `issue-list` to the wrong system, which answers with
  > an **empty list**, and the board renders an empty inbox that reads as *you
  > have no tickets* — the very failure this command exists to prevent. Write no
  > `Tracker` key and disclose:
  >
  > `PLOT-UNASKED: which tracker — refused — no Tracker key written; inbox source unverified`
  >
  > A found `ticket_prefix` is a structural signal, so `Tracker: jira` may still
  > be **proposed** unattended and recorded as such — the refusal is for the
  > *absence* of a signal, not for its presence.

- **The Jenkins instance** — when `jen` is installed, `ci_signals.jenkinsfile`
  is true, and no instance resolved from config or `JENKINS_INSTANCE`.

  > **Unattended (`PLOT_UNATTENDED=1`):** refuse the key rather than guessing a
  > slug. A wrong instance is worse than an absent one — `jen -I <bogus> auth
  > status` prints `Keycloak: signed in` and exits 0, so a guessed slug buys a
  > green light that verifies nothing. Write no `Jenkins instance` key, skip the
  > `jen` auth check as `unknown`, and disclose:
  >
  > `PLOT-UNASKED: which Jenkins instance — refused — no Jenkins instance key written; jen auth unverified`

- **Alias or project script** — a shared repo may prefer a `package.json`
  script. **Default when unasked: print an alias and write nothing**, because an
  alias touches no tracked file and so cannot surprise a shared repository.

  > **Unattended (`PLOT_UNATTENDED=1`):** take that documented default — print
  > the alias, write nothing. It is the choice that cannot surprise a shared
  > repository, which is what makes it safe to take without asking. Disclose:
  >
  > `PLOT-UNASKED: alias or project script — default — alias printed, no tracked file written`

Do not ask about anything the probe answered confidently. A user asked to
confirm their own git host learns that the tool is not paying attention.

### 3. Write the config

Append only the **missing** keys to the hub doc's `## Plot Config`, never
replacing existing content:

```markdown
- **Git host:** bitbucket
- **CI:** jenkins
- **Jenkins instance:** apps
- **Tracker:** jira
```

Write only the keys the user **confirmed** or a structural signal
**proposed** — never a key inferred from silence, and never a value the user
overrode.

`Git host` is read by `plot-host.sh` and may already be set by `/plot-init`;
write it only when absent.

`CI` and `Jenkins instance` are new keys. **Say plainly that the board does not
yet render Jenkins status** — they are recorded and verified, and a board
consumer is separate work. Claiming a rendering that does not exist is the
failure this whole command is built to avoid.

`Tracker` records which system holds the repo's tickets, confirmed from the
proposed prefix or answered outright. Write it only when confirmed or proposed
from a `ticket_prefix` — **never `Tracker: none` from an unanswered question**,
because absence of a prefix is not absence of a tracker.

Then hand over the start command:

```bash
alias plot-board='node <artifact path from the probe>'   # plugin or checkout
# artifact_source: npm — the path is already executable, so drop the `node`:
alias plot-board='<artifact path from the probe>'
```

### 4. Verify — the gate

**4a. Auth.** For each installed CLI, report the probe's `auth` value:

| State | Report |
|---|---|
| `ok` | authenticated |
| `failed` | not authenticated — name the exact fix, e.g. `jen -I apps auth login` |
| `unknown` | **cannot verify** — say so; never round it up to authenticated |

**Never run an interactive login.** These are browser-based device flows. Name
the command and let the user run it — in Claude Code, suggest they type it with
a `!` prefix so the output lands in the session.

**Auth failure is never a hard stop.** The board is useful with no host auth at
all: plans come from git, and only PR/CI enrichment degrades.

**4b. The board boots and serves.** One call, which starts the board on an
OS-assigned port, fetches the data, and reaps the server on every exit path:

```bash
../plot/scripts/plot-board-verify.sh <artifact path from the probe>
```

It prints the `/api/board` payload on success and exits nonzero otherwise.
`PORT=0` means a verification run can never collide with a board the user
already has open.

Assert the response parses as JSON and carries a non-empty `columns` array,
each entry having a `phase` and a `cards` array.

**Do not assert specific column names.** They are the board's own display
pipeline, not the plan phases, and they have already changed once: an older
plugin build served `Draft / Approved / Delivered / Released`, while the build
in this checkout serves `Discovery / Design / Development / Endgame /
Released`. A gate naming those strings would fail on a healthy board every
time the pipeline is renamed — reporting a broken board when the board is
fine, which is the exact confusion this command exists to remove.

**A single failure is not yet a verdict.** Measured 2026-08-18 in a repo with
59 plans: the first-ever run of a freshly installed artifact exceeded the
script's `curl --max-time 10` once, while every subsequent run answered in
about 1.7 seconds. Re-run it once before reporting a broken board, and say
which run you are reporting. One failure followed by a pass is a cold start;
two failures are a finding.

The script guarantees the teardown, so nothing here has to remember it.

**4c. Cards are non-zero.** If every column is empty while `plan_files > 0`,
the board is serving and seeing nothing. Run the plan-format contract script on
each plan file:

```bash
../plot/scripts/plot-plan-meta.sh <plan file>
```

Report which files came back `"format":"none"` or `"phase":"NONE"`, and why:

> 3 of 7 plans parsed as `format: none`:
> `docs/plans/foo.md`, `docs/plans/bar.md`, `docs/plans/baz.md`
> — expected `- **Phase:** Draft` as a list item under `## Status`.

**Report only. Never rewrite the user's plans** — adoption is additive, and an
unrequested edit to a plan is exactly the kind of write Plot does not do.

### 5. Summarise

State what landed, the start command, and every remediation command still
outstanding. If anything reads `unknown`, say which check could not be
completed rather than presenting a clean bill of health.

### S. `--start`

The daily action, not the ceremony. Run **only** this step: no config write, no
auth check, no proposal.

**S1. Resolve the artifact.** Run the probe (step 1) and read `artifact` and
`artifact_source` from its JSON. This is the sole reason `--start` probes at
all — one command knows where the artifact lives, for the same reason
`plot-host.sh` is the only thing that talks to `gh` and `bb`.

**If `artifact_source` is `none`, refuse.** There is nothing to start. Point at
`/plot-board-setup` and stop — report, do not repair.

Warn when `cwd_is_root` is false: the board compares realpaths, so a board
started from a subdirectory silently shows nothing.

**S2. Start it, in the background, from the repo root.** How to invoke it
follows `artifact_source`, which the probe already reported:

| `artifact_source` | Start with |
|---|---|
| `plugin`, `checkout` | `node <artifact> &` — the path is a `board-server.mjs` |
| `npm` | `<artifact> &` — the path came from `command -v plot-board`, so it is an executable shim and may be a wrapper script rather than the module itself |

Run it from the repo root, not from a subdirectory: the board reads the CWD.

The board binds **port 7777** and prints its URL. `--start` does not choose a
port: several worktrees run boards side by side, and one shooting down
another's is a worse failure than the collision.

**S3. Read what it printed, and do not confuse the two messages.**

| Printed | Means |
|---|---|
| `Plot board: http://localhost:7777` | Your board started. |
| `Plot board already running at http://localhost:7777` | **A board holds that port, and it may not be yours.** |

The second message **exits 0**. Treating that exit code as success is the whole
trap: measured 2026-08-18, port 7777 was held by a different Plot installation,
so the command reported "already running" and exited 0 while the operator's
board was not running at all. Never report a board as started on the strength
of an exit code.

**S4. Prove it answers — and prove it is serving *this* repo.** Exit 0 is not
evidence. Fetch the running board's own data:

```bash
curl -sf --max-time 30 http://localhost:7777/api/board
```

Assert the same shape step 4b asserts: JSON, a non-empty `columns` array, each
entry carrying a `phase` and a `cards` array. Do not assert column names.

Allow a generous timeout. Measured 2026-08-19 against a 59-plan repo, the first
fetch after a cold start took 8.7–9.5 s; a 10 s margin sits close enough to that
to turn a healthy board into a reported failure.

This step is not optional, and it is what distinguishes the two messages above.
When the port was already held, the payload comes from **that** board, serving
**its** working directory — so compare its total card count against the probe's
`plan_files`. Expect the same order of magnitude, not equality: the board also
carries delivered plans from the index directories, so a repo with 59 plan
files legitimately serves ~60 cards.

A count that cannot be reconciled at all is the signal. Measured 2026-08-19:
`--start` in a 59-plan checkout printed *already running* and the board on 7777
served **3** cards, because the port was held by a different Plot installation
running from `~/.claude/skills/`. Three cards is not 59 by any accounting, and
that mismatch is the only thing that caught it — the exit code was 0 and the
fetch returned HTTP 200. Say so, and name the choice: stop that board, or read
it knowing whose it is. **Never stop a board you did not start without asking**
— it may be another worktree's, and that is the failure the port policy exists
to avoid.

**S5. Report.** Print the URL, whether *this* invocation started the board or
found one already there, and the verification result. If the fetch failed, say
the board did not come up and show the response — a board that did not come up
must say so.

`--start` does not use `plot-board-verify.sh`. That script reaps the server it
starts, which is the opposite of what `--start` is for; the `curl` in S4 is the
verification, run against the board that stays up.

## Failure modes

| Condition | Response |
|---|---|
| No `## Plot Config` | Stop; point at `/plot-init` |
| No artifact anywhere | Stop; report the plugin and npm routes |
| A repeated `ticket_prefix` | Propose `Tracker: jira`, name the evidence; a human confirms |
| No `ticket_prefix` | Ask which tracker; never propose `Tracker: none` from silence |
| Both CI signals present | Ask which runs the PRs; do not tie-break on the git host |
| Tracker unresolved, unattended | Refuse the key; a wrong tracker serves an empty inbox reading as *no tickets* |
| Node < 20 | Report the requirement, still write config, skip 4b |
| CWD is not the repo root | Warn prominently — the board compares realpaths, and branch-staged plans silently vanish otherwise |
| A CLI is absent | Skip its check; absence is not failure |
| Auth output unrecognised | Report *cannot verify*; never authenticated |
| `/api/board` is not JSON | Report the raw response; do not retry silently |
| Zero cards, zero plans | Not an error — an empty project |
| Verify fails once, then passes | A cold start, not a broken board; report which run you are quoting |
| `--start` on `artifact_source: none` | Refuse; point at full setup rather than repairing |
| `--start` prints *already running* | A board holds the port and may not be yours; verify via S4 before claiming success |
