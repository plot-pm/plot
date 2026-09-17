# A credential is read where a repo keeps it

> The board refuses the Jira inbox and tells the operator to create a token, while both values sit working in the repository's `.env` — nothing on the estate reads that file.

## Status

- **State:** Draft
- **Type:** feature
- **Issue:** #930
- **Sprint:** a-declared-agent-costs-what-it-costs
- **Story:** plot-board
- **Review:** in-session
- **Impl:** own branches

## Changelog

- Where `JIRA_EMAIL` and `JIRA_API_TOKEN` are unset, Plot reads them from the repository's `.env` and says it did. The refusal named the two variables it wanted without ever looking where a repository puts them, so an operator holding working credentials was sent to create a second token.

<!-- Board impact: the board's Jira inbox is what refuses. No plan format,
     no template, no layout. -->

## Design

**The message diagnoses a missing token where a token is present** —
`plot-host.sh:1703`:

> Jira needs JIRA_EMAIL and JIRA_API_TOKEN in the environment — an
> unauthenticated Jira must not read as an empty inbox

Measured 2026-09-17 on the reporting repository: both values were in `.env`, and
`curl -u "$JIRA_EMAIL:$JIRA_API_TOKEN" .../rest/api/3/myself` answered **200**.

**Nothing on the estate reads a `.env` file.** Verified here: a grep across
`skills/plot/scripts/` for `.env` returns `process.env` and a worker's envelope
filename, and no file read.

### Why this is Plot's and not the adopter's

**Every repository adopting the board with `Tracker: jira` meets it.** It is not
a property of one repository's layout.

**"Export it in your shell" does not reach the board.** The board is a long-lived
process, often started from a launcher that inherits no interactive shell —
`plot-boardctl.sh` starts it detached, and `plot-fleetctl.sh` bakes an
environment into a launchd unit precisely because that inheritance does not
exist.

### The environment wins, and the source is named

| situation | behaviour |
|---|---|
| both variables set | **unchanged** — the environment wins, and nothing is read |
| unset, `.env` carries both | use them, and **say they came from `.env`** |
| unset, `.env` carries neither | today's message, unchanged |

**Naming the source is a requirement rather than a nicety.** A credential picked
up silently is worse than one that announces itself: two tokens may exist, and
an operator debugging a 401 must be able to tell which one the board used.
`plot-board-probe.sh` already reports `auth` as three words rather than a
boolean for the same reason — a reading that cannot say where it came from is a
reading nobody can act on.

### The parse is targeted, and sourcing is refused

**`set -a; . ./.env; set +a` is the usual one-liner and it is not safe.** The
reporter measured it aborting in zsh on a file whose third line holds an
unquoted JSON object. Sourcing also imports every unrelated variable in the
file, which on a credentials path is a reason of its own.

So the read is per-variable and evaluates nothing:

```bash
grep -m1 '^JIRA_EMAIL=' "$root/.env" | cut -d= -f2-
```

### Two things the reporter did not raise, and both belong in the gates

**`.env` is not in this repository's `.gitignore`** — checked 2026-09-17, no
`.env` entry exists. A feature that teaches Plot to read credentials from a path
the repository would commit must not ship without saying so; the slice adds the
entry and the adoption path mentions it.

**A value must never be echoed.** The message names the SOURCE (`read from
.env`), never the value, and no debug path prints it. That is a property to pin
by asserting the token's absence from the output, since a log line added later
is exactly how such a value escapes.

### What this does not do

**It does not read `.env` for anything else.** Two named variables on one
refusal path. A general loader is a different feature with a different blast
radius, and `plot-config.sh` is where a repository already states its settings.

**It does not search upward.** The repository root, resolved the way every other
script resolves it. A walk toward `$HOME` would read a file the operator did not
mean for this repository.

**It does not change the refusal.** An unauthenticated Jira must still not read
as an empty inbox — the sentence that message carries is right and stays.

## Slices

### A credential is read where a repo keeps it (Branch: feature/a-credential-is-read-where-a-repo-keeps-it)

- `feature/a-credential-is-read-where-a-repo-keeps-it` — where both variables are unset, read them from the repository root's `.env` with a targeted per-variable parse, name the source in the output, add `.env` to `.gitignore`, and mention the file in the adoption path

**Done when** both variables set in the environment produce behaviour
**byte-identical** to today, pinned by asserting no file read occurs; an unset
pair with a `.env` carrying both is used and the output **names `.env` as the
source**, pinned by text; an unset pair with no `.env`, or one carrying neither,
produces **today's message unchanged**; a `.env` whose other lines hold unquoted
JSON, quotes, `export ` prefixes and blank lines is parsed without error and
without importing anything else, pinned by a fixture holding all four; the
token's **value appears in no output stream**, pinned by asserting its absence
from both stdout and stderr; `.env` is in `.gitignore`; and `pnpm run
test:contracts` passes.

## Notes

**Reported 2026-09-17 with the credentials verified independently** — a 200 from
`/rest/api/3/myself` with the same pair the board refused.

**The reporter named the parsing trap and its measurement**, which is why the
targeted read is in the Design rather than discovered by whoever implements it.

**This is the second Jira-inbox report in two days** and they are different
defects: [#928](2026-09-17-the-inbox-says-what-it-is-showing.md) is an inbox
that is empty because the query narrows by assignee, this one is an inbox that
never runs because the credentials are not found. **An operator meeting both
sees one symptom** — an empty board — which is the argument for fixing them
together and stating in each plan that the other exists.
