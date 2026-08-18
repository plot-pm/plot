# plot-board-setup — developer notes

Board adoption for a project that already has Plot. `SKILL.md` is the
agent-facing instruction; this file is why it looks the way it does.

Design spec: `docs/superpowers/specs/2026-08-18-plot-board-setup-design.md`

## Split: skill vs script

Per Manifesto Principle 3 — *skills interpret and adapt; scripts collect and
report*:

| Layer | Responsibility |
|-------|----------------|
| `skills/plot/scripts/plot-board-probe.sh` | Facts only. Node version, repo shape, artifact location, config presence, plan count, CLI auth states. Decides nothing. |
| `skills/plot/scripts/plot-board-verify.sh` | The resource guarantee. Starts the board on an OS-assigned port, fetches `/api/board`, reaps the server via `trap` on every exit path. |
| `skills/plot-board-setup/SKILL.md` | Judgment. Which artifact to recommend, whether Jenkins keys are warranted, what an empty board means, whose board is on port 7777, what to tell the user. |

## Why the gate asserts cards, not HTTP 200

Measured 2026-08-18: a plan file written with a bare `**Phase:** Draft` line
instead of the list item `- **Phase:** Draft` parses as `format: "none"`. The
board then boots, serves valid JSON, and renders **zero cards**. At the browser
this is indistinguishable from a broken board, and a port-responds check passes
it cleanly.

So step 4b asserts the payload's shape and 4c asserts it is not empty — and
when it is empty, `plot-plan-meta.sh` names the offending files. Manifesto
Principle 12: a gate is satisfied by the artifact that proves it, never by the
claim that it holds.

## Why `--start` verifies with `curl` rather than `plot-board-verify.sh`

The verify script's whole value is the `trap` that reaps the server it started.
`--start` exists to leave a board **running**, so reusing the script would
guarantee the one outcome the user did not ask for.

That leaves `--start` needing its own evidence, and it needs it more than setup
does, because of how the board handles a busy port. `packages/board`'s
`server.on('error')` treats `EADDRINUSE` as a report rather than a crash:

    Plot board already running at http://localhost:7777

and then **exits 0**. That is deliberate and correct — several worktrees run
boards side by side, and a second `pnpm board` shooting down the first is a
worse failure than the collision. But it means the exit code answers a
different question from the one `--start` is asking. Measured 2026-08-18: port
7777 was held by a *different Plot installation*, so the command reported
"already running" and exited 0 while the operator's board was not running.

So step S4 fetches `/api/board` from the board that is now up, and compares its
cards against the probe's `plan_files`. A payload full of plans from another
checkout is the only signal that distinguishes "your board is serving" from
"someone else's board owns the port" — and it is a judgment, which is why it
lives in the skill rather than in a script.

**Reproduced during this branch's own hand-walk, 2026-08-19.** A `curl` against
7777 found nothing; seconds later `node <artifact>` printed *already running*
and exited 0, because a board from a *different Plot installation*
(`~/.claude/skills/plot/scripts/board/board-server.mjs`, pid confirmed via
`lsof`) had taken the port in between. The fetch returned HTTP 200 — and **3**
cards, in a checkout holding **59** plan files. Exit code and HTTP status both
said success; only the card count said whose board it was.

The comparison is order-of-magnitude, not equality. The same walk on a free
port served **60** cards against those 59 files, because the board also carries
delivered plans out of the index directories. Sixty against fifty-nine is a
match; three is not.

## Why the verify step tolerates one failure

Measured 2026-08-19 in this checkout, with 59 plans: the first run of a
freshly-installed plugin artifact exceeded `plot-board-verify.sh`'s
`curl --max-time 10` and reported that `/api/board` did not answer. Three
consecutive runs immediately afterwards each returned the full 22 KB payload,
and a direct measurement put the warm response at ~1.7 s.

The cold path — first `node` start of that artifact, module load and JIT, over
a plan directory that size — is the difference. Two later hand-walks put the
cold fetch at 8.7 s and 9.5 s, both under the 10 s ceiling but not by much, and
both far above the ~1.7 s warm figure. That is the margin: healthy, and close
enough to the limit that a loaded machine crosses it.

`SKILL.md` therefore asks for a second run before a broken board is declared,
and asks the agent to say which run it is quoting. One failure then a pass is a
cold start; two failures are a finding. Step S4, which owns its own `curl`,
uses `--max-time 30` for the same reason.

This is a note about the script's margin, not a defect fixed here:
`plot-board-verify.sh` is wave-1 surface, and widening its timeout is a change
to a tested script that belongs with its own tests.

## Why auth has three states

`ok | failed | unknown`, never a boolean. An unrecognised output means *cannot
verify*, and rounding that up to *authenticated* is the failure `plot-host.sh`
documents from the 2026-08-17 GitHub 503 afternoon, when every branch read as
having no PR. Being wrong in the reassuring direction is the worst way to be
wrong, because nobody investigates a green light.

`jen` forced the issue. Measured 2026-08-18:

    $ jen -I nonexistent-xyz auth status
    Keycloak:      signed in
    Instance:      nonexistent-xyz (https://…)
    Jenkins token: none
    Jenkins auth:  NOT reachable
    $ echo $?
    0

A bogus slug expands into a URL pattern without ever being reached, so the
output looks healthy at a glance and the exit code says nothing. Only the
`Jenkins auth:` line answers the question — and `NOT reachable` must be tested
before `reachable`, since it contains it.

## Why the Jenkins keys are not inert

`CI` and `Jenkins instance` are written before any board consumer reads them,
which normally fails Manifesto question 5 (*would removing it lose something
essential?*). They survive it because **the skill reads them back**:
`Jenkins instance` is the required `-I` argument to the only auth check that
verifies anything. Without the key, the sole runnable form of the check is the
one that exits 1 and proves nothing.

The board does not render Jenkins status, and the skill says so rather than
implying a consumer that does not exist.

## Project-agnostic constraint

Manifesto Principle 5: Plot hardcodes no project names, paths, or hosts. `jen`
is treated as *a* Jenkins CLI the probe may detect, and the config keys describe
*any* Jenkins. A project with a different Jenkins CLI records the same keys; only
the detection of this one is specific, and its absence degrades to
`installed: false`.

## Testing

`--start` has no automated test, by design: it leaves a server running, which is
the one thing the suite must never do. It is walked by hand instead — start it,
confirm the board answers on the printed URL, stop it — and its refusal path
(`artifact_source: none`) cannot be exercised from this checkout at all, because
the checkout itself holds an artifact at
`skills/plot/scripts/board/board-server.mjs` and the third fallback always
succeeds here. A scratch repo with `PLOT_PLUGIN_ROOT=/nonexistent
PLOT_NPM_BIN=/nonexistent` is what reproduces it.

## Known gaps

- **Step 4c only fires when the board is entirely empty.** A project where 3 of
  7 plans are malformed shows 4 cards, looks healthy, and is never diagnosed.
  Making the check unconditional would catch partial breakage, at the cost of a
  `plot-plan-meta.sh` call per plan on every run.
- **`CI` is a single key.** A project on GitHub Actions or GitLab CI would want
  the same key with a differently-named companion. Generalising to
  `CI instance:` was considered and deferred until a second CI system exists.
- **npm `latest` lags the plugin.** `@plot-pm/board` publishes 0.3.0 as
  `latest` while the plugin ships a newer build, which is why artifact
  precedence puts the plugin first.
- **`--start`'s ownership check is a heuristic.** Comparing served cards against
  `plan_files` catches the measured case — another checkout's board on 7777 —
  but two worktrees of the *same* repo serve near-identical payloads and are not
  distinguishable this way.
