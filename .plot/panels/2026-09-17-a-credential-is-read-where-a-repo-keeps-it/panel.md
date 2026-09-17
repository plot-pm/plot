# Panel — a-credential-is-read-where-a-repo-keeps-it

**Reconciled: `unanimous` — amend (credential-handling, premise)**

Two lenses, one plan, and the finding that moves both is the same: **the plan's
prescribed parse fails the plan's own gate.** The moderator re-ran it.

## The Design and the Done-when contradict each other

The Design prescribes `grep -m1 '^JIRA_EMAIL=' "$root/.env" | cut -d= -f2-`.
The `Done when` demands a fixture holding *"unquoted JSON, quotes, `export `
prefixes and blank lines"* parsed correctly. Measured here:

```
export-prefixed: []              <- the ^ anchor does not match past `export `
quoted:          ["abc123"]      <- cut strips no quotes
```

**An implementer following the Design literally ships a parse that fails the
gate.** And the quoted case is worse than a failed gate: `curl -u` would send
the quote characters, producing a 401 — **the very symptom this plan exists to
remove.**

This is the third time in this session that a plan's prose and its gates have
disagreed, and the pattern is the same each time: the gate was written from what
*should* be true and the Design was copied from the report.

## A leak the plan does not know about, on disk, today

`credential-handling` found `plot-host.sh:1742`:

```bash
budget_record_jira() {
  budget_append jira "${JIRA_EMAIL:-unknown}" api 1 - - - unknown
}
```

Verified: `$HOME/.plot/state/budget.tsv` holds **2448 jira lines** on this
machine. The email is persisted unredacted, and it is half of a Basic
credential.

**Why it belongs to this plan rather than a separate one:** today that ledger is
written only where an operator exported the variable deliberately. After this
change it is written wherever a `.env` exists, which is a population that has
not consented to a machine-local record of it. The plan's own
*"a value must never be echoed"* gate reads stdout and stderr, and would not see
a file.

## The plan's supporting argument is partly false

**`plot-boardctl.sh` does not start the board detached.** Its own comment says
so: *"`setsid`/`nohup` is deliberately NOT used: the tree must stay…"*. The plan
cites a detached start to argue that "export it in your shell" cannot reach the
board.

**The conclusion survives on the other half.** `plot-fleetctl.sh` genuinely bakes
an environment into a launchd unit, and a board started from a launcher
genuinely inherits no interactive shell. The plan needs one correct citation,
not two, and it currently has one.

## What the lenses had in common

**Both asked what happens to the value and neither asked what happens without
it.** The panel is thorough about leakage — process listings, traces, the
ledger, worktree copies — and silent on the failure path: a `.env` that holds a
*stale* token. The board would then authenticate with a credential the operator
believes they replaced, and the plan's "name the source" line is what makes that
diagnosable. **No gate pins it.**

That is the shared blind spot, and it points at the same missing test as the
leak finding: the plan's gates all read what the code *prints*, and the two
things that matter most are what it *writes* and what it *sends*.

## What the panel settles

- **The `.gitignore` entry is right and belongs in scope** — checked, `.env` is
  absent from this repository's.
- **Reading two named variables on one refusal path is the right boundary.**
  Neither juror argued for a general loader.
- **The environment must win.** Both confirm the plan says so and that the gate
  pins it.

## The moderator's reading

**Unanimous, and the amendment is concrete:** replace the parse with one that
handles `export `, quotes and trailing whitespace; add a gate that the ledger
does not gain an unredacted email; correct the `plot-boardctl.sh` citation. The
feature is right and its gates are stronger than its Design.

**Nothing here moves the plan's phase.**
