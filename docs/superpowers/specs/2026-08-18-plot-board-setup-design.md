# plot-board-setup — design

> A Plot spoke that brings a project from "has Plot" to "has a working board",
> proving the board serves rather than asserting it, and recording the git-host
> and CI configuration the board and its helpers read.

**Status:** design approved 2026-08-18. Not yet implemented.

## Problem

The board runs in any repository already — it reads the current working
directory, not its own location. Verified 2026-08-18: the plugin-shipped
artifact, run from a throwaway git repo containing a `## Plot Config` and one
plan, served that plan as a card on `/api/board`.

What is missing is everything around that:

1. **No adoption path.** `plot-init` never mentions the board. A project that
   adopts Plot gets no pointer to it, though `CLAUDE.md` calls the board
   first-class and gates it in the Definition of Done.
2. **No start route for other projects.** `pnpm board` is a script in *this*
   repo's root `package.json` pointing at a checked-in artifact path. Other
   projects have neither.
3. **Failures are silent and misread.** A plan in the wrong format parses as
   `format: "none"` and yields a board that boots, serves valid JSON, and shows
   zero cards. Measured 2026-08-18: this is indistinguishable at the browser
   from a broken board.
4. **CI configuration is unrecorded.** `plot-host.sh` reads a `Git host` key,
   but nothing in Plot records which CI system a project uses. Jenkins appears
   nowhere in Plot — zero mentions across every `.md`, `.sh`, `.ts`, and `.json`
   in the repository.

## Scope

**In:** prerequisite probing, config writing, auth verification for the git host
and CI CLIs, starting the board and proving it serves, diagnosing an empty
board.

**Out:** rendering Jenkins status on the board. That requires changes to
`plot-host.sh`, `fleet.ts`, and the board UI, and is separate work. This design
touches no board source and no existing helper, so it needs no artifact rebuild
and carries no artifact-conflict risk.

**Out:** moving, rewriting, or deleting anything the project already has.
Adoption is additive, and that includes malformed plans — they are diagnosed and
named, never rewritten.

## Architecture

The split follows Manifesto Principle 3 — **scripts collect and report; skills
interpret and adapt.**

### `skills/plot/scripts/plot-board-probe.sh` — collect

Read-only, JSON to stdout, exit 0 whether or not the findings are good. It
decides nothing, writes nothing, starts nothing. Every field is a fact for a
skill to interpret.

```json
{
  "node": "v24.4.1",
  "node_ok": true,
  "bash": true,
  "git_root": "/path/to/repo",
  "cwd_is_root": true,
  "artifact": "/Users/…/plugins/…/board/board-server.mjs",
  "artifact_source": "plugin",
  "has_plot_config": true,
  "plan_dir": "docs/plans/",
  "plan_files": 7,
  "git_host": "github",
  "gh":  {"installed": true, "auth": "ok"},
  "bb":  {"installed": true, "auth": "ok"},
  "jen": {"installed": true, "auth": "unreachable", "instance": "apps"},
  "ci_signals": {"jenkinsfile": true, "gh_workflows": false}
}
```

`artifact_source` is one of `plugin | npm | checkout | none`, resolved in that
order.

`node_ok` is `true` when the major version is ≥ 20, which is what the artifact's
esbuild target and its shipped README both require.

`auth` is a three-state enum — `ok | failed | unknown` — never a boolean.
`unknown` is what an unrecognised output produces, and it reads as *cannot
verify*, never as *authenticated*. This is the same failure direction
`plot-host.sh` chose after the 2026-08-17 GitHub 503 afternoon, where every
branch read as having no PR: being wrong in the reassuring direction is the
worst way to be wrong.

### `skills/plot-board-setup/SKILL.md` — interpret

Turns the probe into a proposal, asks only what the probe could not answer,
writes config, runs the verification gate, and reports. Invoked as
`/plot-board-setup`.

## Measured CLI behaviour

These are the facts the probe's auth detection must be built on. All measured
2026-08-18 on macOS.

| Command | Exit | Output shape |
|---|---|---|
| `gh auth status` (authed) | 0 | `✓ Logged in to github.com account …` |
| `bb auth status` (authed) | 0 | `Logged in as: <name> (<user>)` |
| `jen auth status` (no instance) | 1 | `error: no Jenkins instance — pass -I …` |
| `jen -I <slug> auth status` | 0 | multi-line block; truth is on the `Jenkins auth:` line |

**Exit code alone is insufficient for `jen`.** `jen -I <slug> auth status`
prints `Keycloak: signed in` and a plausible instance URL **even for a slug that
does not exist**, because the slug expands into a URL pattern without being
reached. Measured against the bogus slug `nonexistent-xyz`: the output is
byte-similar to a real-but-untokened instance. Only the final line
distinguishes them:

```
Jenkins auth:  NOT reachable      # or: reachable
```

So the probe keys on that line specifically. Anything it does not recognise
yields `"auth": "unknown"`.

This is the reason the `Jenkins instance` config key is not decoration: without
it there is no `-I` argument, and the only runnable form of the check is the one
that exits 1 and verifies nothing.

## Configuration keys

Appended to the existing `## Plot Config`, never replacing content, and only
where absent:

```markdown
- **Git host:** github
- **CI:** jenkins
- **Jenkins instance:** apps
```

`Git host` is already read by `plot-host.sh` and may already have been written
by `plot-init`; it is written here only if missing.

`CI` and `Jenkins instance` are new. They pass Manifesto question 5 — *would
removing it lose something essential?* — because the setup skill reads them back
on every run: `Jenkins instance` is the required argument to the only
instance-scoped auth check that verifies anything. Remove the key and step 4
loses its target.

They are **declared and verified, not yet consumed by the board.** The skill
says so plainly rather than implying a rendering that does not exist.

### Project-agnostic constraint

Manifesto Principle 5: Plot contains zero hardcoded project names or paths. The
skill therefore treats `jen` as *a* Jenkins CLI it may detect, and the Jenkins
keys as describing *any* Jenkins. Nothing in the skill, the probe, or the config
keys names an organisation, an instance URL pattern, or an internal host. A
project with a different Jenkins CLI, or Jenkins behind a different auth scheme,
records the same keys; only the probe's detection of *this* CLI is specific, and
its absence degrades to `"installed": false`.

## Steps

### 1. Probe

One call to `plot-board-probe.sh`.

**If `has_plot_config` is false, stop** and point at `/plot-init`. Board setup
presupposes adoption; re-implementing adoption here would duplicate it.

**If `artifact_source` is `none`, stop** and report how to get one — the plugin,
or `npx @plot-pm/board`.

### 2. Propose, then confirm

One block the user corrects rather than composes, in `plot-init`'s style:

> Detected: Node 24 · git root is CWD · plugin artifact · `docs/plans/` with 7
> plans · host `github`, `gh` authenticated · `jen` installed, Jenkinsfile
> present, Jenkins token missing.
>
> Proposed: start via the plugin artifact, alias `plot-board`. Add `CI: jenkins`
> and `Jenkins instance: apps` to Plot Config.

Ask only what the probe could not answer:

- **Jenkins instance slug** — when `jen` is installed but no instance resolves
  from `JENKINS_INSTANCE` or existing config.
- **Alias vs project script** — a shared repo may prefer a `package.json`
  script; a personal checkout an alias. Default when unasked: print an alias
  for the user to add, and write nothing. An alias touches no tracked file, so
  it is the choice that cannot surprise a shared repository.

Do not ask about anything the probe answered confidently.

### 3. Write config

Append the missing keys to the hub doc's `## Plot Config`. If the section does
not exist, `has_plot_config` was false and step 1 already stopped.

Write the start route the user chose — a shell alias printed for them to add, or
a `"board"` script appended to `package.json` if the project has one and the
user chose that.

### 4. Verify — the gate

This step is what separates the skill from a README. Manifesto Principle 12:
*a gate is satisfied by the artifact that proves it, never by the claim that it
holds.*

**4a. Host and CI auth.** Run `gh auth status`, `bb auth status`, and
`jen -I <instance> auth status` for whichever are installed, applying the
output-shape rules above. Report each as ok/failed/unknown with the exact
remediation command for anything not ok (`jen -I apps auth login`).

**Never run an interactive login.** These are browser-based device flows; the
skill names the command and lets the user run it — in Claude Code, via a `!`
prefixed command so its output lands in the session.

**Auth failure is never a hard stop.** The board is useful with zero host auth:
plans come from git, and only PR/CI enrichment degrades. Report and continue.

**4b. The board boots and serves.** Start the artifact with `PORT=0` — already
supported by `src/server/index.ts`, which binds an OS-assigned port and reports
it — then `curl` `/api/board`, assert the response parses as JSON and contains
the four phase columns, and shut the server down.

**4c. Cards are non-zero.** If `/api/board` returns zero cards across all
columns while `plan_files > 0`, the board is serving but seeing nothing. Run
`plot-plan-meta.sh` on each plan file and report which ones failed to parse and
why:

> 3 of 7 plans parsed as `format: none`:
> `docs/plans/foo.md`, `docs/plans/bar.md`, `docs/plans/baz.md`
> — expected `- **Phase:** Draft` as a list item under `## Status`.

Report only. Rewriting the user's plans is an unrequested write, and adoption is
additive.

This sub-step exists because of a measured failure: on 2026-08-18 a plan written
with a bare `**Phase:** Draft` line instead of a list item produced a board that
booted, served valid JSON, and rendered nothing. A port-responds check would
have passed it.

### 5. Summarise

What landed, the start command, and any remediation commands still outstanding.

## Error handling

| Condition | Behaviour |
|---|---|
| No `## Plot Config` | Stop, point at `/plot-init` |
| No artifact found | Stop, report plugin and npm routes |
| Node < 20 | Report required version, continue to config writing, skip 4b |
| CWD is not the git root | Warn prominently — `board.ts` requires equality, and branch-staged plans silently vanish otherwise |
| A CLI is absent | `installed: false`; skip its auth check, do not treat as failure |
| A CLI's auth output is unrecognised | `unknown` — reported as *cannot verify*, never as authenticated |
| Board starts but `/api/board` is not JSON | Report the raw response; do not retry silently |
| Board serves zero cards, zero plan files | Not an error — an empty project |
| Port in use | `PORT=0` avoids it; a bind failure is reported with the error |

Every failure names the next command. Manifesto question 3: fail gracefully with
helpful suggestions.

## Testing

The skills have no unit tests; validation is end-to-end. This design is testable
in the sandbox style `test/e2e/` already uses:

- A sandbox repo with a valid plan → probe reports it, verify gate passes, board
  serves one card.
- A sandbox repo with a malformed plan → verify gate reaches 4c and names that
  file.
- A sandbox repo with no `## Plot Config` → step 1 stops.
- `jen` absent from `PATH` → `installed: false`, no auth check, no failure.

`pnpm test` must pass (it validates every skill parses). The board is untouched,
so `pnpm run test:board` is unaffected — but it should still be run, since the
Definition of Done gates it.

## Deliverables

| File | Change |
|---|---|
| `skills/plot-board-setup/SKILL.md` | New — frontmatter, Model Guidance, five steps |
| `skills/plot-board-setup/README.md` | New — required by the repo's skill convention |
| `skills/plot/scripts/plot-board-probe.sh` | New — the collect half |
| `skills/plot-init/SKILL.md` | Edit — offer board setup from step 4 extensions |
| `CLAUDE.md` | Edit — Architecture and Helper Scripts tables |
| `README.md` | Edit — root skills table |
| `.changeset/*.md` | New — with a `bumps:` block; versions are never hand-edited |

## Model Guidance

| Step | Tier | Why |
|---|---|---|
| 1. Probe | Small | One script call, JSON out |
| 2. Propose and confirm | Mid | Turning signals into a proposal is judgment |
| 3. Write config | Small | Append known keys to a known section |
| 4. Verify | Small | Run commands, compare against documented output shapes |
| 5. Diagnose empty board | Mid | Mapping parse failures to a human-readable cause |

## Manifesto checklist

1. **Planning stays in git?** Yes — config lives in the hub doc, no external store.
2. **Project-agnostic?** Yes — no project names, paths, or URLs; see the constraint above.
3. **Fails gracefully?** Yes — see the error table; every failure names a next command.
4. **Opt-in convention?** Yes — a command the user runs, adding keys they confirm.
5. **Removing it loses something?** Yes — without it the board has no adoption path, and the empty-board failure stays undiagnosable. The Jenkins keys are read back by step 4.
6. **A human could do it manually?** Yes — every step is a shell command a person can run.
7. **A smaller model could follow it?** Yes — see Model Guidance; only two steps need judgment.
8. **Stays out of effort tracking?** Yes — no estimates, no time.
9. **Ceremony scales?** Yes — one command, and it stops early when there is nothing to do.
