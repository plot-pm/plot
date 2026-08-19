---
"@plot-pm/board": minor
---

board: a WORKING row opens one view of the agent holding it

Wave *Log* served the worker's console; this serves the run around it. A WORKING
row now opens a single panel carrying pid, uptime, the command that started the
worker, branch, worktree, plan and wave — and, when the runtime's own session
transcript is readable, the model, the context in use and when the agent last
spoke. The log is the same live tail as before, now beneath the facts that say
whose log it is.

This wave is mostly assembly: every source it reads was already merged or
already on disk. Nothing re-derives worker liveness, and nothing re-implements
the log read — `plot-worker-state.sh` decides the first once and
`/api/worker-log` already does the second. Neither script is touched.

**A second on-demand route rather than new fields on the row.** The panel wants
per-agent facts — a pid, a process's age, a transcript's model — and putting
them on `AgentRow` would ride them out on the 4 s pulse, to every open tab,
whether or not anyone had a panel open. `GET /api/agent-panel?branch=<branch>`
follows the pattern `/api/worker-log` established for exactly this reason: the
row asks, the server assembles. The pulse payload is unchanged, and that is
asserted rather than intended — `/api/fleet` and `/api/board` are checked for
the absence of a sentinel model name under any key, and for the absence of
`uptimeSeconds`.

The branch is resolved through the same lookup-not-validator boundary the log
route documents: the request names a branch, and the answer comes from the
worktrees the pulse itself reported. No request text becomes a path segment, so
`../../etc/passwd` matches no branch and is answered rather than read.

**Uptime is a reading, never a memory.** It is derived from the pid via `ps`,
not from a timestamp stored at launch — because a stored one outlives the
process it describes, and a row reading *up 4h* for a worker that died in its
first minute is worse than a row reading nothing. The same call that measures
the age establishes there is something to measure: `ps` exits non-zero for a pid
nobody is running, and the panel then shows no uptime at all. Asserted in both
directions, including for pid `0` — `kill -0 0` signals the caller's whole
process group and succeeds, a trap this repo has sprung before.

**Model, context and last activity are read defensively, and omitted rather than
guessed.** They come from `~/.claude/projects/<cwd-slug>/<sessionId>.jsonl`, a
private, undocumented format belonging to the runtime that may change under the
board. When a field is missing or unrecognised the panel simply shows less: no
error, no placeholder, no last-known value. The plan accepts this deliberately
and the reasoning is load-bearing — *a stale model name read from a field that
moved would be believed, while an absent one prompts a look at the transcript.*
Checking a `version` and reporting an unrecognised one would buy an error
message at the price of a second thing to keep current, guarding fields that are
conveniences rather than facts anything depends on.

That failure mode is the wave's main risk, so it is asserted from both ends:
eleven malformed transcript shapes each yield absence, a real transcript yields
the three values, and the route test confirms the keys are *absent* from the
payload rather than null — a client rendering `body.model` gets nothing to
print. Fields omit independently, so a format that moved `usage` but kept
`model` still shows the model.

Three details were measured rather than assumed, and two of them corrected the
plan:

- **`model` and `usage` are nested under `message`, not top-level.** The plan's
  summary put `model` at the top level; read there it returns undefined on every
  line — and because absence is silent by design, that would have shipped a
  panel that simply never showed these fields, with nothing anywhere reporting
  a fault. Confirmed 33/33 assistant lines.
- **A worktree's transcript directory holds `agent-*.jsonl` sidechains** written
  by subagents, and they are routinely the newest files in it. A subagent's
  model and context are a true statement about the wrong process, so they are
  skipped by filename and by the `isSidechain` flag.
- **The path slug replaces dots as well as slashes.** Worktree directories
  routinely contain dots, and a slug that kept them points at a directory that
  does not exist — which, again, would look exactly like a format change.

**The scan stops at the first assistant line it finds from the end, even when
that line yields nothing.** Walking past an unreadable current turn to a
readable older one would report a superseded model as the agent's current one —
the stale-value failure, reached by trying harder rather than by giving up. The
first implementation did precisely that; a test caught it and now pins it.

The omission rule is structural rather than repeated at each call site: `Fact`
returns `null` for a value it was not given, so there is no code path that can
print "—" or "unknown". A zero is still a value — `0s` of uptime is a real
reading of a process that just started — so the check is for null, undefined and
empty, never falsiness.

The menu item reads *Show the agent* rather than *Read worker log*, because the
view is now about the agent and the log is one of the things it shows. It stays
in the menu on WORKING membership, unchanged: the row says what IS, the menu
says what you can DO, and nothing on the client guesses whether a panel will
find anything.

**The panel acts on nothing.** *Answer*, *Machine* and *Registry* are later
waves and this sprint is deliberately read-only; no capability fields are added,
since nothing records them.

<!--
bumps:
  skills:
-->

No skill version bumps: this is a board-side change only. Nothing under
`skills/` reads or documents the panel, and no helper script is touched —
`plot-fleet-scan.sh` and `plot-worker-state.sh` are deliberately untouched,
since every fact the panel needed was already derivable from what the scan
reports or readable beside it on disk.
