# Juror: adversary — round 2

Position: amend

Lens: what survives a correction pass. The easy findings are gone. What I looked
for is the amendment that fixed one sentence and left its dependent claim
standing, and the gate a prose paragraph promised but never wrote.

**The headline: the Design's new parse fails the plan's own `Done when` fixture
— again, for a different reason, and with the same 401 symptom.** Round 1 found
the parse returning empty on `export `. The replacement handles `export `. It
now returns the value **with its quotes still attached** whenever a quoted line
also carries trailing whitespace — and the `Done when` fixture mandates quotes
and trailing whitespace in the same file. **Round 1's defect class was not
eliminated; it was moved one case to the right.**

---

## 1. Did the amendment fix what round 1 found, or restate it?

**Mixed. Two fixed, one restated as prose where a gate was owed, three dropped
without a word.**

| round 1 finding | status |
|---|---|
| parse fails on `export ` | **fixed** (and broken elsewhere — Q2) |
| `plot-boardctl.sh` detached = false | **fixed**, withdrawn explicitly and well |
| ledger writes the email unredacted | **narrated, not gated** — Q3 |
| zsh-abort measurement does not reproduce | **dropped, claim still stands** |
| `$root` does not exist in `plot-host.sh` | **dropped** |
| `issue-list`/`issue-view`/`issue-status` | **dropped** |
| "sourcing EXECUTES the file" | **dropped** |
| `dotenv` lockfile note | **dropped** |
| a gate that the credential authenticates | **dropped** |

Counted:

```
$ grep -cn 'executes'            <plan>   -> 0
$ grep -cn 'issueError|published' <plan>  -> 0
$ grep -cn 'issue-view|issue-status' <plan> -> 0
$ grep -cn 'dotenv'              <plan>   -> 0
$ grep -n  'authenticat'         <plan>   -> 3 hits, ALL prose, none a gate
```

**The withdrawal of the `plot-boardctl.sh` citation is the amendment's best
work** — it names the retraction instead of quietly deleting, which is the house
style and the right call.

**But the zsh claim it was paired with survives untouched**, still asserted at
line 69 after two jurors failed to reproduce it. I failed a third time:

```
$ printf 'A=1\nJSON={"k":"v","n":[1,2]}\nJIRA_API_TOKEN=tok\n' > z.env
$ zsh  -c 'set -a; . ./z.env; set +a; echo "zsh token=[$JIRA_API_TOKEN]"'
zsh token=[tok]
$ bash -c 'set -a; . ./z.env; set +a; echo "bash token=[$JIRA_API_TOKEN]"'
bash token=[tok]
```

Both source cleanly. **This is the dependent-claim pattern my lens exists for:**
the amendment corrected the detachment support in the same paragraph-cluster and
left the adjacent false measurement in place. The conclusion (do not source) is
right and needs no support — `read_env` is justified by the parse alone.

---

## 2. Did the amendment introduce a NEW false claim or a new hole?

**Yes. The Design's four measured outputs are honest — I reproduced all four
exactly — and the fixture they were measured against is weaker than the one the
`Done when` demands.**

The plan's claim reproduces:

```
plain:     [plain@example.com]
exported:  [quoted-token]
trailing:  [value-with-space]
absent:    []
```

Every one matches. **The measurement is true and the generalisation drawn from
it — "the shape that meets every case this plan's gate names" — is false.**
Note what the fixture never contains: a value that is quoted **and** trailed by
whitespace. The `Done when` names both.

### NEW HOLE 1 — quotes survive when a quoted value has trailing whitespace

```
$ printf 'JIRA_API_TOKEN="plaintok"   \n' > g.env
$ read_env JIRA_API_TOKEN g.env
["plaintok"]          <- want [plaintok]
```

**The cause is sed ordering.** The quote-strip `s/^"\(.*\)"$/\1/` runs *before*
the whitespace-strip, so the trailing spaces defeat the `"$` anchor; the
whitespace-strip then runs on a string whose quotes it does not remove. A
credential of `"plaintok"` goes to `curl -u` **with the quote characters** — the
401 round 1 identified, reproduced through the correction meant to cure it.

This needs no exotic input. `.env` files are hand-edited; a trailing space after
a quoted token is ordinary. **And the plan's own gate fixture mandates exactly
these two features in one file.**

### NEW HOLE 2 — CRLF breaks the quoted case

```
$ printf 'JIRA_API_TOKEN=crlftok\r\n'   > d.env
$ read_env JIRA_API_TOKEN d.env
[crlftok]                       <- unquoted survives: BSD [[:space:]] eats \r

$ printf 'JIRA_API_TOKEN="crlfquoted"\r\n' > d2.env
$ read_env JIRA_API_TOKEN d2.env
["crlfquoted"]                  <- quotes retained; same ordering bug
```

Unquoted CRLF passes **by luck** — `[[:space:]]` matching `\r` is a BSD/GNU
detail, not a property the function states. Quoted CRLF fails. A `.env` authored
on Windows or pasted through a Windows tool is a normal population.

### NEW HOLE 3 — a multi-line quoted value is silently truncated

```
$ printf 'JIRA_API_TOKEN="line1\nline2"\n' > h.env
$ read_env JIRA_API_TOKEN h.env
["line1]           <- corrupt: half a value, with an opening quote attached
```

Not a refusal — a **corrupted credential presented as a good one**. The rubric
asked; this is the worst failure mode of the three because nothing anywhere can
tell it from success.

### The cases that hold (I tried to break them and could not)

| case | result |
|---|---|
| value containing `=` (`abc=def==`) | `[abc=def==]` correct |
| value containing `#` (`tok#hash`) | `[tok#hash]` correct — no comment-strip, a defensible choice |
| prefix collision `JIRA_EMAIL` vs `JIRA_EMAIL_BACKUP` | `[real@x.test]`; asking for `JIRA_EMAIL` against a backup-only file gives `[]` — **correct both ways** |
| empty value `JIRA_API_TOKEN=` | `[]` |

**The empty-value case is not a parse bug but is an unresolved design question:**
an empty value is byte-identical to an absent one, so a `.env` holding
`JIRA_API_TOKEN=` produces today's "create a token" message while the file does
contain the key. The plan's precedence table has three rows and no row for it.

### NEW HOLE 4 — the file-error paths write to a stderr the board publishes

```
$ read_env JIRA_API_TOKEN /nope/absent.env ; echo "rc=$?"
sed: can't read /nope/absent.env: No such file or directory
rc=0

$ read_env JIRA_API_TOKEN adir/ ; echo "rc=$?"          # a directory
sed: read error on adir: Is a directory
rc=0
```

Both **leak a raw `sed:` diagnostic to stderr and return rc=0** — the no-`.env`
path is the plan's *"today's message, unchanged"* row, and it is not unchanged.
It is today's message preceded by a sed error. The function needs a
`[ -f "$2" ] || return 1` guard, which also gives the absent/empty distinction
Hole 3's row wants.

**This is not merely cosmetic, and round 1 found the reason the plan dropped.**
That stderr is published over HTTP:

```
$ grep -n 'issueError' packages/board/src/server/fleet.ts
2259:    entry.issueError = message;   // <- the script's stderr
7067:    issueError: entry.issueError,
$ grep -n 'issueError' packages/board/src/contract/schema.ts
3917:  issueError: z.string().nullable().default(null),
```

Script stderr on this exact path becomes a field in the `/api/board` payload.
`credential-handling` established this in round 1; the amendment did not record
it, and the new `read_env` is the first code in the plan that **writes to that
stderr by accident**. The dropped finding and the new hole are the same hole.

### NEW HOLE 5 — `$1` is interpolated into a regex, not matched literally

```
$ read_env '.*' i.env
[realtok]          <- '.*' matched as a pattern
```

Only two literal names are ever passed, so this is not exploitable today. It is
worth one sentence because the function is written as a **reusable helper** with
a `# $1=name $2=file` signature, and the plan's "two named variables" boundary
lives in prose rather than in the function.

---

## 3. Does `Done when` pin the corrected behaviour, and is the ledger gate satisfiable?

**No, and the second half of the question has no subject — the ledger gate was
never written.**

The Design says, at line 134:

> **And the plan's own leak gate could not see it**: reading stdout and stderr
> says nothing about a file. **So the gate grows a second half.**

It does not. The `Done when` block has **zero changed lines** in the amendment:

```
$ git diff 0500774a5 b2cc89e6f -- <plan> | grep -E '^[+-]' | grep -i 'ledger|budget'
(only Design-section lines; no Done-when line changed)
```

The gate still reads, verbatim from the pre-amendment draft:

> the token's **value appears in no output stream**, pinned by asserting its
> absence from both stdout and stderr

**The Design promises a gate in the future tense and the gate section is
untouched.** This is the exact failure the moderator named in round 1 — *"the
gate was written from what should be true and the Design was copied from the
report"* — reproduced one round later, with the polarity flipped: this time the
Design is right and the gate never caught up. A plan whose prose says "the gate
grows" and whose gate did not grow is worse than one that never claimed it,
because a reader checking the summary finds the finding addressed.

**Nor does `Done when` pin any of the parse corrections.** It still names the
same four fixture features it named before the amendment. It does not require
a quoted-plus-trailing-whitespace line, so **the fixture as specified passes
while Hole 1 ships.**

**Is the ledger gate satisfiable? Yes — mechanically, and cheaply.** I proved a
test can read `budget.tsv` after a call, because the path has a documented
override:

```
$ sed -n '59,66p' skills/plot/scripts/plot-budget.sh
budget_path() {
  local home="${PLOT_BUDGET_HOME:-}"
  ...
  printf '%s\n' "$home/budget.tsv"
}

$ PLOT_BUDGET_HOME=$tmp bash -c '. plot-budget.sh
    budget_append jira "leak@example.test" api 1 - - - unknown
    cat "$PLOT_BUDGET_HOME/budget.tsv"'
b1  jira  leak@example.test  api  1789634044000  1  -  -  -  unknown

$ grep -c "leak@example.test" "$PLOT_BUDGET_HOME/budget.tsv"
1
```

**So there is no excuse for the gate's absence.** `PLOT_BUDGET_HOME` redirects
the ledger to a temp dir, and an assertion is one `grep -c`. The plan correctly
argues the ledger into scope and then does not spend the one line the argument
earned.

One note for whoever writes it: `budget_record_jira` is guarded by
`[ -z "${PLOT_BUDGET_OFF:-}" ] || return 0`, so a test asserting the ledger must
ensure `PLOT_BUDGET_OFF` is **unset** — a suite that sets it globally would make
the gate vacuously pass.

---

## 4. Is there anything round 1 missed that is still wrong?

**(a) The surviving support claim is misleading, and it is now the only one.**
The amendment withdrew the false `plot-boardctl.sh` citation and leaned the
whole argument on the remaining sentence — so that sentence now carries the load
alone. It does not hold:

```
$ grep -n 'LABEL=' skills/plot/scripts/plot-fleetctl.sh
84:LABEL="${PLOT_FLEET_LABEL:-com.plot-pm.registryd}"

$ grep -c 'issue' packages/board/src/server/entry/registryd-main.ts
0
```

The launchd unit supervises **`plot-registryd`, not the board**, and registryd
never touches the inbox. It bakes `PLOT_REPO_ROOT` and `PATH` — a repo root and
a tooling path, no credential, and the plist comment says PATH is there because
*"launchd gives a job a minimal PATH"*.

**Round 1 flagged this as MISLEADING and the amendment kept it while deleting
its neighbour.** By discarding one of two supports, the plan made the weaker one
load-bearing. The honest argument is the one the plan already states first:
every repo adopting `Tracker: jira` meets this, and `.env` is where the
ecosystem puts credentials. That needs no process claim at all.

**(b) `$root` is gone from the snippet but the promise it broke is still in the
plan.** Round 1 found no repo-root resolution in `plot-host.sh`. Still true:

```
$ grep -nE 'show-toplevel|git rev-parse|repo_root|PLOT_REPO_ROOT' \
    skills/plot/scripts/plot-host.sh
(no output)
```

The new `read_env` takes `$2` as a file, which dodges the question — and line 142
still reads *"The repository root, resolved the way every other script resolves
it."* **This script does not resolve it at all**, so the sentence points an
implementer at a convention that is absent from the file they are editing. The
amendment removed the broken expression and kept the prose that depended on it —
the dependent-claim pattern again.

The worktree consequence round 1 raised is likewise unanswered: a dispatch desk
under `.worktrees/` has no `.env`, so "no upward search" makes that a refusal
rather than a fallback. That is a defensible choice; it is not a stated one.

**(c) Nothing pins the `.gitignore` ordering.** Round 1's premise juror asked for
the `.gitignore` entry to land first, since the window between teaching
operators to create a `.env` and ignoring it is when one gets committed. The
slice still bundles both into one branch and the `Done when` lists `.env` in
`.gitignore` as a checkbox with no ordering. One slice, one commit order — cheap
to state, and it is the only irreversible item in the plan.

---

## 5. Would you implement from this plan as it stands?

**No — and the reason is narrow and mechanical, not a disagreement about the
feature.**

The feature is right, the premise survived two rounds of attack, the chokepoint
is the correct layer, the ledger argument is genuinely well-made, and the
retraction paragraph is a model of how to withdraw a claim. **What is not ready
is the artifact an implementer copies.**

An implementer following this plan literally today ships a `read_env` that
returns `"plaintok"` — quotes included — for a quoted value with trailing
whitespace, which is the reported 401 wearing a third mask, and the `Done when`
fixture as specified **does not catch it**. That is the same structural failure
round 1 measured, one round later: the Design and the gate still disagree, and
the gate is still the half that is weaker.

Three changes and I would implement without further argument:

1. **Reorder the strips and guard the file.** Strip trailing whitespace and `\r`
   **before** the quote-strip, and `[ -f "$2" ] || return 1` so a missing or
   directory path returns non-zero instead of leaking a `sed:` line to a stderr
   the board publishes. Decide the empty-value row and the multi-line case —
   refusing both is fine; silently truncating is not.
2. **Write the ledger gate the Design already promises.** `PLOT_BUDGET_HOME`
   makes it a temp dir and a `grep -c`, proven above, with `PLOT_BUDGET_OFF`
   unset.
3. **Extend the `Done when` fixture to a quoted value carrying trailing
   whitespace**, and to CRLF. Without that line the fixture certifies a parse
   that fails on its own mandated inputs.

Three sentences of tidying I would take but would not block on: drop the zsh
measurement (unreproduced by three jurors), drop or restate the `plot-fleetctl.sh`
support now that it stands alone, and either name the root expression or say the
file path is the caller's to supply.

**The plan is one correction pass from implementable. It is not there, and the
gate is what is missing — which is precisely what round 1 said.**
