---
"@plot-pm/board": minor
---

board: an agent is the machine, so it never appears in WAITING ON A MACHINE

Measured on the live board 2026-08-20: `bug/one-component-renders-every-row`
appeared in **WORKING** *and* in **WAITING ON A MACHINE**, five minutes apart on
one screen. From `/api/fleet` for that row: `worker: running`, **`pr: None`** —
no CI, no check, nothing automated anywhere near it. The section was listing the
agent itself as the machine, and an operator reading *what am I waiting on?* was
answered with the name of the thing doing the work.

**The section answers one question, and an agent is not an answer to it.**
WAITING ON A MACHINE means *you cannot act; something automated is working* — a
check running, a build queued, a run page you refresh and a verdict you read. An
agent is technically a process, and WORKING is the better sentence for it because
it says *who*. Given both rows a reader learns nothing from the second and has to
reconcile two lines describing one branch.

**The justifying case was two subjects, not one subject twice.** The rule was
introduced for *"an agent watching its own CI"*, listed once as an agent and once
as a process, on the argument that the sections list different things. They do —
which is exactly why the conclusion does not follow. The agent belongs in
WORKING; the PR whose checks are running belongs in the machine section, and it
arrives there on its own through `group`. Two rows, two subjects, each named
once. The original framing put one subject in two sections.

**A rule keyed on a mechanism when the intent was a situation.** The plan meant
*an agent watching its own CI*; the code said *a process is running*, and an
agent is always a process — so the entry fired for every live worker, including
the ones with nothing pending to wait on. That is the shape this estate keeps
producing, and the measured row is its clearest instance: the implementation
could not tell the justifying case from any running worker at all.

**Two halves removed, in two files.** `machineProcesses` (`fleet.ts`) loses its
`origin: 'local'` arm, so no worker state writes a process entry. `inMachineSection`
(`AgentList.tsx`) loses `|| processesOf(row).length > 0`, so membership is the
server's grouping and nothing added to it. The description was built in the
first; membership was decided in the second, and it was the second that admitted
the rows.

**Membership is `group` alone, rather than `processes` filtered to host entries.**
Both spellings render identically today, and the difference is where the
guarantee lives. A predicate that reads `processes` holds *no agent reaches this
section* only for as long as `machineProcesses` keeps its promise — a rule in a
second file, of the kind this repo converts to gates. Reading `group` makes it
structural: the client cannot admit a row the server did not group, whatever
`processes` later grows to carry. The field stays on the row and `machineNote`
still reads it for the section's sentence; this decides MEMBERSHIP, and
membership has one source.

**No row is lost, and that was the objection raised against the removal** — *an
agent that exited while its checks still run would land nowhere.* It lands in the
section by two paths that never consult a worker: the classifier's
`pr.checks === 'pending'` arm sets `group: 'waiting-on-machine'`, and the host
half of `machineProcesses` pushes an entry off the same reading. The local half
was credited with a case it never covered — the worker there is `finished`, so it
pushed nothing. Asserted end to end rather than argued.

**The rule is asserted over the whole enum, not over the states that occur
today.** `no worker state reaches the machine section` iterates
`WorkerStateSchema.options` — all eight, `running` through `elsewhere` — at both
the unit and the pulse level, and pins the enum's size so a ninth state cannot be
added without this failing. That is what makes it a rule rather than a patch: the
two states a naive fix would cover are not the claim.

**`MachineProcessOriginSchema` keeps `local` although nothing writes it.** This is
a WIRE contract, and the board's page is a built artifact a reader may have open
across a restart — `/api/fleet` answers from whichever server is running, which
is the same asymmetry `processesOf` already guards. A narrowed enum would fail to
parse an older server's payload, trading a stale entry that renders nowhere for a
blank page. Widening-tolerant, narrowing-cautious.

**What deliberately did not change.** The CI grouping at `fleet.ts`'s `pending`
arm is untouched and is now what the section rests entirely on, so it is asserted
rather than assumed — if it moved, the section would empty and every negative
above would still pass. The `processes` field stays on the row; only the local
entry is gone. WORKING is unchanged: it already lists a running worker, and making
it agent-centred is a later wave and a much larger change. An agent in WAITING ON
YOU is a later wave too — a crashed agent does not become visible through this
change, which is correct for now.

The worker arguments to `machineProcesses` survive the entry they fed,
underscored rather than dropped. Every caller passes them positionally and the
suite calls it with spread tuples whose argument positions this file has broken
once before; churning every call site to delete one `if` would obscure a diff
that should read as one behaviour removed.

<!--
bumps:
  skills:
-->

No skill version bumps: this is a board-side membership change only. No helper
script decides which section a row lands in, the `/api/fleet` payload loses no
field, and `plot-fleet-scan.sh` is untouched — the worker states it reports are
unchanged, and what changes is only whether one of them is allowed to answer
*what am I waiting on?*
