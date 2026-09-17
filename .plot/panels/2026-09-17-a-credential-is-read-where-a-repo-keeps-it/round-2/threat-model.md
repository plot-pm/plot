# Round 2 juror: threat-model

Position: amend

Lens: once the values come from a file rather than an operator's deliberate
export, who else sees them — and what does the amendment's own new gate create?

The amendment is a real fix, not a restatement: the parse now passes the
fixture that broke it, and the ledger finding is brought into scope with the
right argument. **But the amendment states the ledger problem and prescribes no
remedy**, and the one remedy the obvious reading implies — redact the email —
has a cost the plan has not measured and that I did measure. There is also a
**second persistence path from the same value that round 1 did not find**, and a
**third population** of the `.env`-in-a-worktree question that neither round
asked. All three are inside the declared slice.

---

## 1. Did the amendment fix what round 1 found, or restate it?

**Fixed, on the parse. Measured, not read.** The new `read_env` handles every
case round 1 broke:

```
$ cat /tmp/t.env
# comment
JIRA_EMAIL=plain@example.com
export JIRA_API_TOKEN="quoted-token"
OTHER={"a":1,"b":"x=y"}

TRAILING=value-with-space   

$ read_env() { sed -n "s/^[[:space:]]*\(export[[:space:]]\+\)\{0,1\}$1=//p" "$2" \
    | head -1 | sed -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'\$/\1/" -e 's/[[:space:]]*$//'; }

plain:     [plain@example.com]
exported:  [quoted-token]        <- round 1 got [] here
trailing:  [value-with-space]    <- round 1 kept 3 trailing spaces
absent:    []
other:     [{"a":1,"b":"x=y"}]   <- JSON survives, `=` inside it intact
```

The `export ` prefix, the quotes and the trailing whitespace are all correct.
The plan's own table reproduces exactly. **This is the round-1 finding that
moved both jurors, and it is genuinely closed.**

**Fixed, on the false citations.** The `plot-boardctl.sh` detachment claim is
withdrawn by name, with the withdrawal recorded rather than quietly deleted —
the estate's own convention.

**Restated, on the ledger.** This is where I split from "fixed". The amendment
says the ledger is *"this plan's problem now"*, gives the correct argument for
why it belongs here (a population that never consented), and then says only
*"the gate grows a second half"*. **It never says what the second half asserts.**
The `Done when` (Q3) does not carry a ledger clause at all. A finding named in
the Design and absent from the gate is a finding restated, not closed.

---

## 2. Did the amendment introduce a NEW false claim or a new risk?

**No new false claim.** I re-checked every factual sentence the amendment added.
The parse measurements reproduce. `.env` is genuinely absent from `.gitignore`:

```
$ git check-ignore -v .env ; echo "exit=$?"
exit=1                    # 1 = NOT ignored
$ git ls-files | grep -c '\.env$'
0
```

The 2448-jira-lines claim is accurate and now larger:

```
$ grep -c '\tjira\t' ~/.plot/state/budget.tsv
2453
```

**But the amendment creates a new risk it does not see, and it is created by the
remedy the amendment implies.** See Q4 — redacting the email in `budget.tsv` is
not free, and the plan has not priced it.

**One new claim is narrower than it reads.** The amendment says *"no debug path
prints it"*. Verified true today:

```
$ grep -rn 'set -x\|xtrace\|PS4=' skills/plot/scripts/ scripts/
(no output)
```

Clean. But that is a property of today's code, asserted as though it were a
gate. Nothing stops the next `set -x`. Round 1's juror asked for it as a gate
and the amendment absorbed it as a sentence.

---

## 3. Does `Done when` pin the corrected behaviour, and is the new ledger gate satisfiable?

**The parse is pinned; the ledger is not gated at all.**

The `Done when` carries seven clauses. Six are unchanged from round 1. The
fixture clause — *"a `.env` whose other lines hold unquoted JSON, quotes,
`export ` prefixes and blank lines is parsed without error"* — now matches the
prescribed parse rather than contradicting it, which is the round-1 fix landing.

**There is no ledger clause.** Grepped the `Done when` paragraph: `budget`,
`ledger`, `tsv` and `redact` appear zero times in it. The Design says the gate
*"grows a second half"*; the gate did not grow. **The new ledger gate is not
unsatisfiable — it does not exist.** That is the amendment's central gap: it
correctly identified that reading stdout and stderr says nothing about a file,
and then did not write the file assertion.

**And the missing clause cannot be written without deciding Q4 first**, because
"the ledger does not gain an unredacted email" and "the ledger still keys the
account correctly" are in tension. The plan must choose; it has not.

---

## 4. Is there anything round 1 missed that is still wrong?

### (a) A SECOND persistence path from the same value — the slots directory

Round 1 found `budget.tsv`. The same account string also becomes a **directory
name on disk**, in `slots-file.ts:185-187`:

```
$ grep -n 'dirFor\|const clean' packages/domain/src/adapters/slots/slots-file.ts
105:const clean = (account: string): string => {
106:  const safe = account.replace(/[^A-Za-z0-9._-]/g, '_');
185:  const dirFor = (account: string): string | null => {
187:    return home === null ? null : join(home, SLOTS_DIR, clean(account));

$ ls ~/.plot/state/slots/
jwloka  plot-pm  quatico  unknown
```

`clean()` maps `@` to `_`, so an email becomes a directory:

```
$ node -e 'const c=a=>a.replace(/[^A-Za-z0-9._-]/g,"_");
           console.log(c("me@acme.test"))'
me_acme.test
```

**Today this path is not reached by Jira** — I checked, and that is the only
reason it is latent rather than live. `slots.acquire` is called from exactly one
place, `liveSlotsFor` at `fleet.ts:1829`, keyed on `entry.prAccount`, the **git
host's** account, and `fleet.ts:2140` says so explicitly (*"THE SLOT IS THE GIT
HOST'S"*). So the four directories above are GitHub orgs, not emails.

**Why it still belongs in this plan.** The value the plan is about to start
picking up from a file is fed into `budget_append` as an account, and the
account namespace is shared with a component that turns accounts into
filenames. The plan's stated boundary is *"two named variables, one refusal
path"* — but the value does not stop at the refusal path; it enters a namespace
with a second consumer. The plan should say the email is a budget account and
**not** a slots account, so a later slice wiring Jira into the concurrency cap
does not silently create `~/.plot/state/slots/me_acme.test/`.

### (b) The redaction cost the plan must price before it can write the gate

Round 1 said *"either redact the account for the jira connector, or state that
the email reaching the ledger is intended"* and moved on. I traced every reader
of that field. The redaction is **not** free:

**Reader 1 — `budget_rate`, `plot-budget.sh:250`.** The account is a match key:

```awk
if ($2 != want_c || $3 != want_a) next
```

**Reader 2 — `spend-rate`, `plot-host.sh:3920`**, which defaults the account
from `budget_account` and publishes it in the JSON.

**Reader 3 — `decodeEntry`/`sameKey`, `packages/domain/src/entities/budget.ts:181,232`.**

And the record on this machine holds **three distinct Jira emails**:

```
$ awk -F'\t' '$2=="jira"{print $3}' ~/.plot/state/budget.tsv | sort | uniq -c
   3 a@<redacted>
  51 jan.wloka@<redacted>
2399 me@<redacted>
```

**That is the cost, and it is measurable.** Redacting to a constant (`jira`,
`redacted`) collapses three accounts into one, and `budget_rate` then reports a
single account spending the sum of all three — the exact failure
`budget-file.ts` documents at length for the GitHub case (*"two checkouts could
each read a full 5000 while the other spent it"*), reproduced in the other
direction. Redacting to a **stable hash** of the email preserves the key and
loses the reader's ability to name the account, which `spend-rate` publishes.

**So the honest options are three, not two**, and the plan names none:

1. **Hash the account** for the jira connector — keeps the key distinct, loses
   legibility. `clean()` already tolerates hex.
2. **Keep the email and state it is accepted**, with the argument that the file
   is machine-local, mode-600-able, and holds the *lesser* half of the pair.
3. **Record `jira` as the account** and accept that one machine's several Jira
   identities merge — defensible only if the rate is per-connector in practice.

**This plan cannot write its ledger gate until it picks one.** That is the
amendment I am asking for, and it is the difference between my position and
`proceed`.

### (c) The `.env`-in-a-worktree question has a THIRD population

Round 1's credential juror asked whether a desk has a `.env` and answered no.
Correct, and I re-verified:

```
$ find .worktrees -maxdepth 2 -name '.env'
(nothing)
$ git worktree list | wc -l
      10
```

`plot-dispatch.sh` cuts desks with `git worktree add` (`:2049`) and **copies no
untracked files** — I read every `cp`/`rsync` hit in the script and none copies
a working tree. So a desk gets **no** `.env`. Good.

**But the population neither round asked about is the nine board endpoints that
spawn agents with the board's whole environment.** Measured:

```
$ grep -rn '\.\.\.process\.env' packages/board/src/server/*.ts
auto-deliver.ts:372  commission.ts:415  deliver.ts:537  dispatch.ts:363
continue.ts:526      implement.ts:268   idea.ts:719     story.ts:512
reslice.ts:472
```

Nine. Each spawns `sh -c "<configured command>"` with `{...process.env, …}`.

**Why this is the plan's business and not pre-existing noise.** Today, a board
process holds `JIRA_API_TOKEN` only where an operator exported it into the
shell that started the board — a deliberate act. **After this change the token
is read from a file inside `plot-host.sh`, a child process.** That is
*narrower*, and it is the plan's quiet security win: the value lives in one
short-lived shell and never enters the board's own environment, so those nine
spawns never see it.

**The plan does not claim that win, and it is exactly the property that makes
the threat boundary hold.** State it — and state its corollary, which is the
actual risk: **if an implementer "simplifies" by having the board read `.env`
and pass the pair down through `opts.env`, the token enters `process.env` and
all nine spawns inherit it.** The plan's `Done when` would still pass: the value
appears in no output stream, the source is named, the parse is right. **The gate
cannot see the shape that loses the property.** A clause — *the value is read
inside `plot-host.sh` and never enters the board process's environment* — is
cheap and is the one gate this lens most wants.

### (d) Logs are clean today, and the plan should say the registryd log is not a threat

I checked, because a 90 MB log is where a credential hides:

```
$ ls -la .plot/logs/
board.log      16745 bytes
registryd.log  89955500 bytes   (2,042,088 lines)

$ grep -i jira .plot/logs/registryd.log | sort -u | wc -l
       6
```

All six are **branch names** (`feature/the-jira-jql-scopes-by-project`, etc.).
No environment dump, no command line, no credential. `board.log` has zero Jira
hits. **The supervisor logs no environment and no argv.** That is a real
negative result and worth one sentence, so the next reader does not re-derive it
over 90 MB.

### (e) `issueError` still publishes this stderr over HTTP — round 1 found it, the amendment dropped it

Round 1's credential juror found that the refusal's stderr reaches `/api/board`.
Still live:

```
$ grep -n 'issueError' packages/board/src/server/fleet.ts packages/board/src/contract/schema.ts
fleet.ts:2259:    entry.issueError = message;   # the script's stderr
fleet.ts:7067:    issueError: entry.issueError,
schema.ts:3917:  issueError: z.string().nullable().default(null),
```

**The amendment did not absorb this.** It is the strongest reason the
"value appears in no output stream" gate must hold: stderr on this path is not a
terminal, it is an HTTP response body. The plan's new message — `read from .env`
— is safe. The point is that the *rule* is load-bearing in a way the plan's own
prose ("a log line added later is exactly how such a value escapes") understates.
Record the pipe.

### (f) `.gitignore` reaches a desk only through a commit

```
$ git ls-files --error-unmatch .gitignore && echo TRACKED
TRACKED
```

Tracked, so a desk on an older base does not have the new entry. All desks here
happen to share `.gitignore` sha `61ea5cfe`, so the window is currently zero —
but it is a window, and round 1's premise juror was right that the entry should
land first. The amendment did not order it.

---

## 5. Would you implement from this plan as it stands?

**No — one amendment short, and it is a decision rather than a discovery.**

What is ready: the parse is correct and measured; the boundary (two variables,
one refusal path) is genuinely narrow — `grep JIRA_EMAIL` over `skills/` and
`packages/` returns **six lines, all in `plot-host.sh`**, so there is no fourth
consumer hiding; the `.gitignore` gate is objective; the false citation is
withdrawn.

What blocks it: **the plan names a persistence path and prescribes nothing for
it.** An implementer reaching that paragraph has to invent the remedy, and the
obvious one — redact the email — collapses three measured accounts into one and
breaks the rate the record exists to compute. That is a decision with a cost,
and a plan is where costs get decided.

**The amendments, all inside the slice:**

1. **Pick the ledger remedy** — hash, keep-and-accept, or connector-constant —
   and write the `Done when` clause that pins it. Price it against the three
   distinct Jira accounts in the record and `budget_rate`'s account match.
2. **Add the gate this lens most wants:** the pair is read inside
   `plot-host.sh` and never enters the board process's environment. Nine board
   endpoints spread `process.env` into spawned agents; the current design avoids
   them and the gate cannot see a change that would not.
3. **Say the email is a budget account and not a slots account**, so a later
   concurrency slice does not turn it into `~/.plot/state/slots/me_acme.test/`.
4. **Record that this stderr is published** via `issueError` into `/api/board` —
   round 1 found it and the amendment dropped it.
5. **Order the `.gitignore` entry first**, and note a desk gets it by commit.
6. **State the negative results** so they are not re-derived: no `set -x`
   anywhere, no `.env` in any desk, `plot-dispatch` copies no untracked files,
   and the 2.04-million-line registryd log holds six Jira strings, all branch
   names.

The feature is right, the parse is now right, and the one thing left is the one
thing round 1 handed over unresolved.
