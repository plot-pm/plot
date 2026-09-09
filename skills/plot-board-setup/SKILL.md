---
name: plot-board-setup
description: >-
  Set the Plot board up in a project that already has Plot: probe the
  prerequisites, record the git-host and CI configuration, and prove the board
  serves. Adoption only — starting the board is /plot-board. Use on
  /plot-board-setup.
globs: []
license: MIT
metadata:
  author: eins78
  repo: https://github.com/plot-pm/plot
  version: 0.4.0
compatibility: >-
  Designed for Claude Code and Cursor. Requires git, bash, curl, and the Node
  major the repository pins in `.nvmrc`. Git-host and CI CLIs are optional —
  the board works without any of them. The plugin start route is Claude Code-specific; on Cursor the probe
  finds no plugin directory and falls through to the npm or checkout route.
---

# Plot: Board Setup

The board reads the **current working directory**, not its own location, so it
runs in any repository without installation. What a project actually needs is
the configuration around it, and evidence that it works.

**The guiding rule: prove, don't assert.** A board that boots and serves valid
JSON can still show nothing — a plan in the wrong format parses as
`format: none` and vanishes silently. Checking that the port responds would
pass that case. So step 4b starts a board on an OS-assigned port, fetches its
data, checks the cards, and reaps the server it started.

**Input:** `$ARGUMENTS` is optional; `--dry-run` reports what would be written
and changes nothing.

**Starting the board is [`/plot-board`](../plot-board/).** This command had a
`--start` flag until 2026-09-06; it was **removed, not aliased**, because a flag
that still works teaches the wrong command. Setup is a once-per-repo ceremony
and starting the board is a daily action, so they are two commands.

## Adoption only

Setup is a once-per-repo ceremony: probe, propose, write config, verify,
summarise. Re-running the probe, the config write and the auth checks every time
someone wants to look at their board is ceremony that does not scale with the
weight of the action (Manifesto Principle 10) — which is why the daily action is
its own command.

| Invocation | Does |
|---|---|
| `/plot-board-setup` | Steps 1–5 below: probe, propose, write config, verify, summarise |
| `/plot-board --start` | Start the board and leave it running — a different command |

**Step 4b starts a board and this command still does that**, through
`plot-board-verify.sh`, which reaps the server it started. That is a probe, not
a start: it proves the board serves and leaves nothing running. `/plot-board
--start` exists to leave one running, which is the opposite act.

## Model Guidance

| Steps | Min. Tier | Notes |
|-------|-----------|-------|
| 1. Probe | Small | Three script calls, JSON out; merge without transforming, then ask the rule what it proposes |
| 2. Propose and confirm | Mid | Wording the proposals and reading a one-directional signal (prefix proposes, silence asks) is judgment; the thresholds behind them are not — `proposeStack` answers those |
| 3. Write config | Small | Append known keys to a known section |
| 4. Verify | Small | Run commands, compare to documented output shapes |
| 5. Diagnose an empty board | Mid | Mapping a parse failure to a human cause |

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
callers, so it must not be asked to carry a ticket prefix it never had.

`plot-board-probe.sh` reports the Node version and the major `.nvmrc` pins,
whether the CWD is the repo root, where a board artifact lives, whether a
`## Plot Config` exists, how many plan files there are, the CI signals present
(`ci_signals.jenkinsfile`, `ci_signals.gh_workflows`), and the install/auth
state of `gh`, `bb`, and `jen`. Its `git_host` is the **configured** `Git host`
key, not an inference — empty until something writes it.

`plot-detect-repo.sh` answers what the probe cannot: the git host **inferred**
from origin's URL, and the ticket prefix and its count from the commit log.
These are the structural signals setup proposes from.

**Then ask the domain what the readings propose.** Both probes report
measurements; which of them clears a threshold is one rule, in
`packages/domain/src/rules/stack.ts`, reached through its own bundle:

```bash
# merge the two reports into one JSON object, then:
../plot/scripts/board/plot-propose-stack.mjs < merged.json
```

It answers four questions, each carrying its evidence: `node` (the major found,
the floor pinned, and whether the first meets the second), `commitStyle`,
`ticket`, and `language`. **The thresholds are not restated here and must not
be recomputed** — a threshold written in two places is the second answer this
seam removes. A missing bundle names its repair (`pnpm build:board`), and since
all fifteen are tracked in git it can only be missing from a broken install.

**If `node.supported` is false, stop and say which two numbers disagree.** This
is the check the command did not make: `plot-fleetctl.sh` refuses to write a
unit under a `node` that is not the pinned major, and board setup ran under
anything at all. Report the major found and the major pinned; the repair is
`nvm use`, not a change to Plot.

> A `node.supported` of **`null`** is *cannot verify*, never *fine*. It means
> no `node` on `PATH`, or a repository pinning no major. Say which, and carry
> on — the board may still start, and an unverifiable reading is not a refusal.

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

**One signal proposes, two signals ask, and `proposeCi` answers it.** Every
inferred field is a *proposal* built from a single structural signal. Where two
signals point different ways, setup does not tie-break — it asks, naming what
it found.

**Read `ci` from the proposal rather than re-deriving it from `ci_signals`.**
The rule lives in `packages/domain/src/rules/stack.ts` and it answers one of
three ways:

| `ci.answer` | What it means | What setup does |
|---|---|---|
| `propose` | one signal was found | propose `CI: ${ci.proposed}`, printing `ci.evidence` |
| `ask` | two signals were found | ask, naming every string in `ci.found` |
| `silent` | the tree showed neither | write no `CI:` key |

**A question carries no proposed word**, which is the shape rather than an
oversight: a field holding `jenkins` beside an `uncertain: true` invites a
caller to read the first half. There is no first half here — an `ask` has no
`proposed` field to read.

**A `null` `ci` is a fourth answer and not a `silent`.** It means the merged
probes reported no `ci_signals` at all, so nothing was looked for. Say the CI
system was not read and carry on; every other proposal is independent of it.

Turn the merged signals into proposals:

- **Git host** — propose `plot-detect-repo.sh`'s inferred `git_host`
  (`bitbucket` from a `bitbucket.org` origin). It is a proposal, not a config
  read: the probe's `git_host` is empty until this write.
- **CI** — read `ci` from the proposal. A lone `Jenkinsfile` proposes
  `CI: jenkins`; a lone `.github/workflows/` proposes `CI: github-actions`;
  both ask. See the both-signals rule below.
- **Tracker** — a repeated ticket prefix is strong evidence **for** a Jira
  tracker. When the proposal carries a `ticket.prefix`, propose `Tracker: jira`
  **with the evidence named**:

  > Found `QUACDS-*` in 6 of 80 commit subjects → propose `Tracker: jira`.

  **Read `ticket.prefix` from the proposal, not `ticket_prefix` from the
  probe.** The probe reports every prefix it saw with its count, including a
  single stray `ONEOFF-1`; whether that count makes a scheme is
  `proposeTicket`'s answer. A `null` prefix there means *no scheme was
  proposed*, and `ticket.matched` / `ticket.outOf` are the numbers to print.

  The prefix is one-directional. `ABC-123` is Jira's convention, but Linear and
  GitHub issues carry prefixed keys too — perfect correlation in this
  population, a proposal never an assertion anywhere else. So it *proposes*, and
  a human confirms. **Absence proves nothing** (half of Bitbucket repos carry no
  prefix): a `null` `ticket.prefix` is not evidence against a tracker, so it
  **asks** the open question below and **never proposes `Tracker: none`** from
  silence.

- **Ticket prefixes** — the same `ticket.prefix` seeds the `Ticket prefixes`
  key, which is what `plot-host.sh issue-list` puts in the Jira query's
  `project IN (…)`. A repository that declares it gets an inbox holding its own
  tickets; one that declares nothing keeps the instance-wide query. **Ask for
  the whole list, because the probe knows of one**:

  > Found `QUACDS-*` in 6 of 80 commit subjects. Which Jira projects hold this
  > repository's tickets? (`QUACDS`, or `QUACDS, QUAWEB, QUAPI`)

  `plot-detect-repo.sh` counts every prefix and reports the most frequent, so
  the seed is complete only where the repository maps to one project. Measured
  on the repository issue #850 reports: scoping to the measured prefix alone
  shows 3 of 12 issues and hides two other projects' work **under a heading
  claiming nobody planned those tickets** — the same failure an instance-wide
  inbox produces with the projects reversed. So a one-element answer is written
  and the gap is named beside it.

  **Declining writes no key.** The inbox stays instance-wide, which is what
  every repository had before the key existed and is a legitimate choice. Never
  write `Ticket prefixes:` empty: an empty key reads as *this repository has no
  projects* while behaving exactly like the absent key.

  **It is not `Branch prefixes`.** The two sit near each other in the config and
  are unrelated — `Branch prefixes` holds `idea/, feature/, bug/` and shapes
  branch names; `Ticket prefixes` holds Jira project keys and shapes one query.

  > **Unattended (`PLOT_UNATTENDED=1`):** the *proposal* survives and the
  > *question* does not, as for the tracker. Write the measured prefix alone and
  > name the gap:
  >
  > `PLOT-UNASKED: which Jira projects hold this repository's tickets — default — wrote Ticket prefixes from QUACDS in 6 of 80 subjects; the inbox hides every issue in this repository's other projects until the rest are added`
  >
  > With a `null` `ticket.prefix` there is nothing to seed: write no key, and
  > disclose nothing — an instance-wide inbox is today's behaviour.

**The CI both-signals rule (Item 1b).** Where `ci.answer` is `ask` — both
signals present — setup **does not propose**. It asks, naming both:

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

- **The tracker** — when `ticket.prefix` is `null`, ask which tracker the
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
  > A proposed `ticket.prefix` is a structural signal, so `Tracker: jira` may still
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

- **The worktree root** — where `/plot-dispatch` puts its worktrees. Propose
  `.worktrees` when the repo has none configured and `.gitignore` can carry it;
  the default is the repo's PARENT, which scatters `plot-wt-*` directories
  beside the checkout and mixes them with unrelated repos.

  **Propose, do not assume.** A repo whose worktrees already live beside it has
  a working arrangement, and moving them is `--migrate`'s job on a person's say
  — not setup's. Where `plot-wt-*` siblings already exist, say how many were
  found and that they stay put unless migrated.

  > **Unattended (`PLOT_UNATTENDED=1`):** write no `Worktree root` key. The
  > default is documented and harmless, and a key written unasked would relocate
  > every future worktree on a repo nobody was consulted about. Disclose:
  >
  > `PLOT-UNASKED: gather worktrees under .worktrees? — default — no Worktree root key written; dispatch keeps using the repo's parent`

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
- **Ticket prefixes:** QUACDS, QUAWEB
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
from a `ticket.prefix` — **never `Tracker: none` from an unanswered question**,
because absence of a prefix is not absence of a tracker.

`Ticket prefixes` scopes the Jira inbox to this repository's projects. Write it
only from a confirmed list or from a measured prefix, and **never empty** — the
absent key is what leaves the inbox instance-wide, and an empty one claims the
repository has no projects while changing nothing. Where the list holds one
prefix, say what it costs:

> Recorded `Ticket prefixes: QUACDS`, from `QUACDS-*` in 6 of 80 subjects. That
> is the one prefix the subjects show — add the rest, or the inbox hides every
> issue belonging to this repository's other projects.

**Warn when the key has no backend.** `plot-host.sh issue-list` resolves issues
through the **Git host** — `github` or `bitbucket` — not through a separate
tracker system. A `Tracker: jira` or `Tracker: linear` is recorded but unread:
the board's inbox will show nothing until a backend for that tracker lands.
When writing such a key, say so:

> Recorded `Tracker: jira`. Note: no backend reads this yet — the board's inbox
> sources issues from the git host, not from Jira. A Jira backend is planned;
> until then, the inbox will be empty.

**Derive, do not hardcode.** The backends that `plot-host.sh issue-list` can ask
are exactly those that match its `if [ "$be" = "github" ]; then … else …` shape:
`github` and `bitbucket`. Any other `Tracker` value is unread today. When a new
backend lands — `jira`, `linear`, etc. — the warning must stop firing for it.
The check the skill performs: if the confirmed `Tracker` value is neither
`github` nor `bitbucket`, warn that no backend reads it yet.

Then hand over the start command:

```bash
alias plot-board='node <artifact path from the probe>'   # plugin or checkout
# artifact_source: npm — the path is already executable, so drop the `node`:
alias plot-board='<artifact path from the probe>'
```

**Say what the alias is not.** It shares its name with the `/plot-board`
command and does a smaller thing: it starts the artifact in the foreground and
records nothing. `/plot-board --stop` reads a pidfile that only `/plot-board
--start` writes, so a board started through the alias is stopped the way any
foreground process is — with `Ctrl-C` in its own terminal. Offer the alias to
someone who wants a board in a terminal they are watching; offer `/plot-board`
to someone who wants one running behind them.

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
> — expected `- **State:** Draft` as a list item under `## Status`.

**Report only. Never rewrite the user's plans** — adoption is additive, and an
unrequested edit to a plan is exactly the kind of write Plot does not do.

### 5. Summarise

State what landed, how to start the board (`/plot-board --start`), and every
remediation command still outstanding. If anything reads `unknown`, say which check could not be
completed rather than presenting a clean bill of health.

**Name the supervisor too.** The board shows what the fleet is doing; the
supervisor is what keeps it doing it, and it is a separate process with a
separate command. Adoption is where a user hears about it — measured
2026-09-06, this skill named it zero times, so an adopter learned the board and
never learned that nothing was supervising the agents they dispatch:

> ```
> /plot-board --start   — the board you just verified
> /plot-fleet --start   — supervises the agents you dispatch; same package
> ```
>
> `/plot-fleet --start` also needs launchd or systemd, and reports what it
> cannot find rather than starting half a fleet.

**Print the line whether or not the supervisor can run here.** Step 1's probe
resolved the artifact both processes read; say which prerequisite is missing
and let the user go and get it. The two are independent systems that share a
machine — neither is a component of the other, and a board that serves says
nothing about whether a supervisor is loaded.

## Failure modes

| Condition | Response |
|---|---|
| No `## Plot Config` | Stop; point at `/plot-init` |
| No artifact anywhere | Stop; report the plugin and npm routes |
| A proposed `ticket.prefix` | Propose `Tracker: jira`, name the evidence; a human confirms |
| A `null` `ticket.prefix` | Ask which tracker; never propose `Tracker: none` from silence |
| A measured prefix, for `Ticket prefixes` | Ask for the whole list — the probe reports the most frequent of several; a one-element answer is written with its cost named |
| No prefix and no answer, for `Ticket prefixes` | Write no key; the inbox stays instance-wide. Never `Ticket prefixes:` empty |
| Both CI signals present | Ask which runs the PRs; do not tie-break on the git host |
| Tracker unresolved, unattended | Refuse the key; a wrong tracker serves an empty inbox reading as *no tickets* |
| Tracker has no backend | Write the key with a warning: *recorded; no backend reads this yet* — the inbox will be empty until the backend lands |
| `node.supported` false | Stop; name the major found and the major `.nvmrc` pins. The repair is `nvm use` |
| `node.supported` null | Say which reading was missing — no `node`, or no pin — and carry on |
| CWD is not the repo root | Warn prominently — the board compares realpaths, and branch-staged plans silently vanish otherwise |
| A CLI is absent | Skip its check; absence is not failure |
| Auth output unrecognised | Report *cannot verify*; never authenticated |
| `/api/board` is not JSON | Report the raw response; do not retry silently |
| Zero cards, zero plans | Not an error — an empty project |
| Verify fails once, then passes | A cold start, not a broken board; report which run you are quoting |
| Asked to start the board | That is `/plot-board --start`; this command adopts and verifies |
| No init system for the supervisor | Name `/plot-fleet --start` anyway and say what it needs; the board is unaffected |
