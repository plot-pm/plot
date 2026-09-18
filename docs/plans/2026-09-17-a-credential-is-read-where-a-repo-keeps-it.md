# A credential is read where a repo keeps it

> The board refuses the Jira inbox and tells the operator to create a token, while both values sit working in the repository's `.env` — nothing on the estate reads that file.

## Status

- **State:** Delivered
- **Type:** feature
- **Issue:** #930
- **Sprint:** a-declared-agent-costs-what-it-costs
- **Story:** plot-board
- **Review:** in-session
- **Impl:** own branches
- **Rounds:** 2
- **Approved:** 2026-09-17, jwloka, in-session
- **Started:** 2026-09-17, Jan Wloka, `feature/a-credential-is-read-where-a-repo-keeps-it`
- **Delivered:** 2026-09-18

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
process, and `plot-fleetctl.sh` bakes an environment into a launchd unit
precisely because a supervised process inherits no interactive shell.

**An earlier draft also cited `plot-boardctl.sh` as starting the board detached.
It does not** — its own comment reads *"`setsid`/`nohup` is deliberately NOT
used: the tree must stay…"*. The citation is withdrawn; one correct reason is
enough and two, one of them false, is worse than one.

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

So the read is per-variable and evaluates nothing. **The reporter's one-liner is
not the shape** — measured 2026-09-17, `grep '^NAME=' | cut -d= -f2-` returns
empty for an `export `-prefixed line and keeps the quotes on a quoted one, and a
quoted token sent to `curl -u` produces the **401 this plan exists to remove**.

The shape, with the strip order that a round-2 panel measured wrong once
already:

```bash
read_env() { # $1=name $2=file
  sed -n "s/^[[:space:]]*\(export[[:space:]]\+\)\{0,1\}$1=//p" "$2" \
    | head -1 \
    | sed -e 's/[[:space:]]*$//' \
          -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'\$/\1/" \
          -e 's/[[:space:]]*$//'
}
```

**Whitespace is stripped BEFORE the quotes and again after, and the order is the
defect.** An earlier draft stripped quotes first; on `T="plaintok"   ` the `"$`
anchor then misses and the value keeps its quotes:

```
old order: ["plaintok"]
new order: [plaintok]
```

**A quoted-and-trailed value is exactly the case the first fixture omitted** — it
held a quoted value and a trailed value and never one that is both, while the
`Done when` names both. The measurement was true and too weak for the gate
written beside it.

Measured against ten cases:

```
  A     [plain]                     F     [{"json":"unquoted"}]
  B     [quoted]                    G     [has=equals=inside]
  C     [single]                    H     []
  D     [trail]                     I     [with#hash]
  E     [quoted-and-trailed]        NOPE  []
```

**It still evaluates nothing** — `sed` over a line, never `source` — which is the
property the refusal of `set -a` was about.

### Two things the reporter did not raise, and both belong in the gates

**`.env` is not in this repository's `.gitignore`** — checked 2026-09-17, no
`.env` entry exists. A feature that teaches Plot to read credentials from a path
the repository would commit must not ship without saying so; the slice adds the
entry and the adoption path mentions it.

**A value must never be echoed.** The message names the SOURCE (`read from
.env`), never the value, and no debug path prints it. That is a property to pin
by asserting the token's absence from the output, since a log line added later
is exactly how such a value escapes.

### The value is already persisted, and that is this plan's problem now

`plot-host.sh:1742` writes the email into a machine-local ledger on every Jira
call:

```bash
budget_record_jira() {
  budget_append jira "${JIRA_EMAIL:-unknown}" api 1 - - - unknown
}
```

Measured 2026-09-17: `$HOME/.plot/state/budget.tsv` holds **2448 jira lines** on
this machine. The email is half of a Basic credential.

**Why it belongs to this plan rather than a separate one.** Today that ledger is
written only where an operator exported the variable deliberately. After this
change it is written wherever a `.env` exists — **a population that never
consented to a machine-local record of it.** A feature that widens who gets
written down owns the writing down.

**And the plan's own leak gate could not see it**: reading stdout and stderr
says nothing about a file. So the gate grows a second half.

#### The redaction is not free, and pricing it is part of this plan

**The account is a MATCH KEY, not a label.** `plot-budget.sh:250` is
`if ($2 != want_c || $3 != want_a) next`, and the same field is read by
`spend-rate` (`plot-host.sh:3920`, which publishes it) and by `decodeEntry` /
`sameKey` (`entities/budget.ts:181,232`).

**Collapsing distinct accounts to one label would merge their windows.** This
machine's ledger holds three:

```
   3 a@<redacted>
  51 jan.wloka@<redacted>
2399 me@<redacted>
```

So a redaction must stay **per-account distinguishable** — a stable derived
identifier, not a constant — or the rate a connector reads becomes the sum of
several people's.

#### A second path exists and is latent for a stated reason

`slots-file.ts:185` turns an account into a **directory name** under
`~/.plot/state/slots/`, via `clean()` which maps `@` to `_`:

```
$ node -e 'const c=a=>a.replace(/[^A-Za-z0-9._-]/g,"_"); console.log(c("me@acme.test"))'
me_acme.test
```

**Jira does not reach it today** — `slots.acquire` is called only from
`liveSlotsFor` (`fleet.ts:1830`), keyed on `entry.prAccount`, the git host's
account. Verified: the directory holds `jwloka`, `plot-pm`, `quatico`,
`unknown`, and no email.

**That is why the redaction belongs at the SOURCE rather than at `budget.tsv`.**
Fixing the one known writer leaves the next one to inherit the defect, and this
path is one `slots.acquire` call away from being live.

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

### A credential is read where a repo keeps it (Branch: feature/a-credential-is-read-where-a-repo-keeps-it, PR: #946)

- `feature/a-credential-is-read-where-a-repo-keeps-it` — where both variables are unset, read them from the repository root's `.env` with a targeted per-variable parse, name the source in the output, add `.env` to `.gitignore`, and mention the file in the adoption path

**Done when** both variables set in the environment produce behaviour
**byte-identical** to today, pinned by asserting no file read occurs; an unset
pair with a `.env` carrying both is used and the output **names `.env` as the
source**, pinned by text; an unset pair with no `.env`, or one carrying neither,
produces **today's message unchanged**; a `.env` is parsed without error and without importing anything else, pinned by
a fixture holding **every combination the gate names rather than one of each** —
plain, `export `-prefixed, quoted, trailed, **quoted AND trailed**, unquoted
JSON, a value containing `=`, a value containing `#`, an empty value, a blank
line and a comment; the
token's **value appears in no output stream**, pinned by asserting its absence
from both stdout and stderr; `.env` is in `.gitignore`; and `pnpm run
test:contracts` passes.

## Notes

**Reported 2026-09-17 with the credentials verified independently** — a 200 from
`/rest/api/3/myself` with the same pair the board refused.

**Amended 2026-09-17 after a two-lens panel**
(`.plot/panels/2026-09-17-a-credential-is-read-where-a-repo-keeps-it/`), which
found the Design's parse failing this plan's own `Done when` — measured, not
argued — and a ledger writing the email unredacted that no gate here could see.

**The panel's shared blind spot is recorded because it is the plan's too**: every
gate reads what the code PRINTS. The two findings that mattered were what it
WRITES and what it SENDS. A third of that kind is still unpinned — **a `.env`
holding a STALE token**, where the board authenticates with a credential the
operator believes they replaced. Naming the source is what makes that
diagnosable, which is why that line is a requirement above and not a nicety; no
gate pins the stale case, and stating so is better than implying it is covered.

**The reporter named the parsing trap and its measurement**, which is why the
targeted read is in the Design rather than discovered by whoever implements it.

**This is the second Jira-inbox report in two days** and they are different
defects: [#928](2026-09-17-the-inbox-says-what-it-is-showing.md) is an inbox
that is empty because the query narrows by assignee, this one is an inbox that
never runs because the credentials are not found. **An operator meeting both
sees one symptom** — an empty board — which is the argument for fixing them
together and stating in each plan that the other exists.
