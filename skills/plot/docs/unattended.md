# Running unattended

Plot skills ask the user. Under `claude -p` — the form this repo's `Worker
command` uses, and the form a CI release would use — there is nobody to answer.
`PLOT_UNATTENDED=1` states that fact, so a skill can take a documented path
instead of improvising one.

## What was measured

The behaviour here was **measured on 2026-08-18**, not inferred, because the
plan that asked for this work rested on a guess and said so.

The guess was that `AskUserQuestion` blocks indefinitely until the harness's
timeout kills the run. It does not. Under `claude -p` the tool **is not
registered at all** — it does not appear in the session's tool list, and it is
not among the deferred tools `ToolSearch` can load.

Three runs, each `claude -p ... --permission-mode bypassPermissions`:

| Run | Prompt | Exit | Elapsed |
|---|---|---|---|
| 1 | "call `AskUserQuestion` and do not proceed without my answer" | 0 | 12s |
| 2 | "list every tool you have" — no `AskUserQuestion` in the output | 0 | 53s |
| 3 | a release checklist quoting the standard interaction line | 0 | 26s |

**There is no hang.** The failure is the opposite shape, and worse for it.

### Why the absence is worse than the hang

A hang is loud. It leaves a corpse: a killed process, a workflow marked failed,
a timestamp somebody can look at. An unregistered tool is silent — the agent
notices the tool is missing, writes what it would have asked into its prose, and
**exits 0**.

Run 3 is the whole problem in one result. The agent behaved impeccably: it
refused to cut the release, named the four options it would have offered, and
said it had taken no action. Then it exited 0. A CI job reading `$?` sees
success. A dispatcher reading the exit code sees a finished worker. The one
place the refusal exists is a prose block nobody parses.

That is this repo's recurring defect — an unobserved thing reported as an
observed one — arriving through the exit code instead of through a log line.

So the design in this file survives the measurement, but its **reason changes**.
It is not there to prevent a wait. It is there to make the skipped question
appear somewhere a machine reads, and to make the three shapes a decision the
skill author made rather than one the model improvised. Runs 1 and 3 improvised
well; nothing guarantees the next one does.

### What the variable still buys, given the tool is absent anyway

A fair objection: if the question tool is missing under `claude -p` regardless,
why set a variable at all?

Measured 2026-08-18, running one skill's question site twice — variable set,
then unset — under `claude -p`:

- **Set:** the agent found the declared shape, stopped, emitted the
  `PLOT-UNASKED:` line, and changed nothing. It cited the clause as its reason.
- **Unset:** the agent checked the environment, correctly found the variable
  absent, declined to infer it from the neighbouring `PLOT_*` variables,
  attempted the attended path, found no question tool, and stopped anyway.

Both stopped. **The difference is the reason, and the reason is the product.**
Set, the outcome is the one a skill author chose and wrote down; the run states
which shape applied. Unset, the outcome was reconstructed on the spot by a
model that happened to reason well — the same improvisation the measurement
above caught being done well twice, with nothing guaranteeing a third.

Two consequences worth stating plainly:

1. **"Unset still asks" is not observable under `claude -p`.** Both arms stop.
   Verifying that the attended path really asks requires an interactive
   session, where the tool exists. Do not read a passing unattended run as
   evidence the attended one works.
2. **The variable is a declaration, not a switch.** It does not enable the
   behaviour so much as make it attributable — which is the whole difference
   between a documented default and a lucky guess.

## The variable

```
PLOT_UNATTENDED=1
```

Set it explicitly. **Never infer it from a missing TTY.** An agent under
`claude -p` may well have a terminal attached, and a human working behind a pipe
may not, so `[ -t 0 ]` answers a different question than the one that matters.
The variable says *there is nobody to answer*, which is the only fact a question
site needs.

Set it in the `Worker command`, in `ralph-plot-sprint`'s loop, or in a CI job.
A repo that never runs Plot unattended never sets it and sees no change at all —
Plot is not asking anyone to configure anything.

## The one rule that must not bend

**`PLOT_UNATTENDED=1` never converts a gate into a pass.**

A Must-Have gate, an unapproved plan, an unmerged branch, a draft plan PR —
those refuse in both modes, identically. The variable answers *may I ask?*, and
never *may I proceed?*

This matters because the variable is set in exactly the environment with the
least supervision. Its power must stay strictly smaller than the operator's. A
skill that used it to skip a check would be using it for the precise opposite of
its purpose.

## The three shapes

Each question site declares its own unattended behaviour. The shape is chosen
per question by the skill author — there is no global default, because the three
differ in who owns the decision, not in how urgent it is.

### 1. Proceed with the documented default

For a confirmation of something already decided. The question exists to give a
present human a chance to intervene; with nobody present, the documented outcome
stands.

> **Unattended:** proceed — cut the release, and name the open Should Haves in
> the output.

### 2. Refuse and say what was needed

For anything where proceeding would commit something a person owns. Release
sign-off, approving a plan, anything outward-facing or hard to reverse.

> **Unattended:** refuse. Say that sign-off was required and no one was present
> to give it. Change nothing.

A refusal is not a failure of the run — it is the run's correct result. Say so
plainly, so a reader does not mistake it for a crash.

### 3. Report and stop cleanly

For a genuine choice with no safe default — which MoSCoW tier an item belongs
in, which of three plans a branch implements.

> **Unattended:** stop. Name the choice, list the options that would have been
> offered, and leave the state untouched.

**This is not a hang.** It exits, states what it could not ask, and leaves
everything as it found it. The distinction from shape 2 is the reason for
stopping: shape 2 knows the answer is a human's to give, shape 3 does not know
the answer at all.

## Whatever the shape, say a question was skipped

Every unattended run that passes a question site **must name it**. Use this
form, so the line is greppable and countable:

```
PLOT-UNASKED: <question> — <shape: default|refused|stopped> — <what happened>
```

For example:

```
PLOT-UNASKED: Cut the release with 3 Should Haves unfinished? — default — cut; the 3 are listed above
PLOT-UNASKED: Approve plan 2026-08-18-a-question-nobody-can-answer-is-a-hang? — refused — approval is a person's to give; nothing changed
PLOT-UNASKED: Which MoSCoW tier for "board shows claim age"? — stopped — Must/Should/Could were the options; sprint file untouched
```

End the run with a count, even when it is zero:

```
3 questions skipped (nobody was present to answer).
```

A run that silently took a default is the defect this file exists to prevent.
The release notes must be able to say *"cut with 3 Should Haves open; nobody was
asked"* — and that sentence has to come from somewhere.

### Refusing and stopping still exit non-zero where the caller reads it

Shape 2 and shape 3 leave work undone. Where a skill's step ends in a script or
a command the caller checks, that command should exit non-zero — because run 3
above proved an exit 0 is indistinguishable from success. Where the step is
prose the agent performs, the `PLOT-UNASKED:` line is the machine-readable
record, and the agent should not report the task as complete.

## What this does not do

- **No timeout on the question.** A timeout turns a hang into a slower hang, and
  the default it eventually takes is the one nobody chose. A documented default
  taken immediately is strictly better than the same default taken ten minutes
  later. (Moot as measured — nothing waits — but it stays rejected so it is not
  reintroduced.)
- **No forbidding questions.** A person at a terminal *should* be asked. With
  `PLOT_UNATTENDED` unset, every skill asks exactly as it did before.

## For skill authors

At each question site, add one line naming the shape:

```markdown
Ask which MoSCoW tier the item belongs to.

> **Unattended (`PLOT_UNATTENDED=1`):** stop — no safe default. Emit
> `PLOT-UNASKED:` naming the item and the three tiers; leave the sprint file
> untouched.
```

The shape lives at the question, not in this file, because the same skill asks
questions of different shapes. `/plot-release` alone asks all three.
