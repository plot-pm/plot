# A second slice needs its own session

> An agent's first slice succeeds and its second cannot start. The session id is fixed at launch and passed to every prompt, so the runtime refuses the second one — `Session ID … is already in use` — and the loop falls back to waiting for work it has already been handed.

## Status

- **Phase:** Approved
- **Type:** bug
- **Sprint:** the-domain-owns-the-lifecycle
- **Story:** the-master-agent-holds-the-fleet
- **Review:** in-session
- **Impl:** own branches
- **Approved:** 2026-09-05, Jan Wloka, in-session
- **Rounds:** 5
- **Started:** 2026-09-05, Jan Wloka, `bug/a-second-slice-needs-its-own-session`

## Changelog

- An agent taking a second slice starts a prompt instead of failing on the session id it used for its first, and `plot-init` ships the prompt file that carries the rule.

<!-- Board impact: an agent stuck this way reads `running` with a live pid and
     an idle transcript — the board shows it working while it polls. -->

## Problem

**Measured 2026-09-05.** Three agents finished their first slices, were handed a second each, and all three failed identically:

```
plot-worker-loop: taken up on <slug> after waiting 5100s — the registry handed over a slice.
[feature/an-agent-lifecycle-refuses ea50df8e] plot: claim feature/an-agent-lifecycle-refuses
branch 'feature/an-agent-lifecycle-refuses' set up to track 'origin/…'.
Error: Session ID 5c7c41bd-ae8f-45ec-a220-2a23b5f1a16b is already in use.
plot-worker-loop: free on <slug> — nothing handed over yet …
```

**Everything before the prompt works.** The hand-over is read, the desk is reset onto the new branch, the claim commit is made and pushed. Then `claude` refuses, the prompt exits at once, and the loop returns to `wait_for_work` — which finds `branch` cleared and reports the agent free.

**One line causes it.** `.plot/worker-prompt.sh:29`:

```sh
[ -n "${PLOT_SESSION_ID:-}" ] && session_args=(--session-id "$PLOT_SESSION_ID")
```

`PLOT_SESSION_ID` is exported once at launch and never changes. `--session-id` asks the runtime to CREATE a session with that id, which succeeds exactly once. There is no `--resume` path anywhere in the file.

**The manifest already anticipated this and nothing acted on it.** `plot-dispatch.sh:324` states that `resumeId` and `session` *"are two fields that hold one value at launch, and they are written separately on purpose"* — `session` is the transcript join key and stays fixed across a hop, while *"the resume handle is a different identity with a different lifetime, and whether it should follow a hop cannot even be ASKED while one field carries both meanings."*

**It can be asked now, and this plan asks it.** The two fields exist, hold the same value, and the second slice is the case that separates them.

**IT PRESENTS AS AN IDLE AGENT, NOT AS A FAILURE.** The loop exits the prompt cleanly and waits. `plot-worker-state.sh` reads a live pid and answers `running`; the board renders *running · idle*. Measured: three agents sat this way for over an hour, and what found it was reading a log by hand. Every exit code involved is zero.

## What this is not

**Not a claim that one session per agent is wrong.** An agent that survives its branch is the design — `plot-dispatch.sh:327` keeps `session` fixed *precisely* so the board can join an agent to one transcript across hops. This plan keeps that and stops using the same id to CREATE a session twice.

**Not a change to `wait_for_work`.** It behaved correctly: the manifest named no branch, so it waited. It was told the truth about a state that should not have existed.

## Slices

### The second prompt resumes (Branch: bug/a-second-slice-needs-its-own-session, PR: #715)

The prompt asks the runtime to CREATE a session on the first slice and to CONTINUE one on every slice after it: `--session-id` once, then `--resume`.

**ONE TRANSCRIPT PER AGENT, AND THE BOARD IS WHY.** `transcript.ts:100` opens `${sessionId}.jsonl` literally — one id names one file, with no chain to follow. So the agent keeps a single session for its whole life, which is exactly what `session` was made to join, and this is the only shape that needs no board change at all.

**TWO ALTERNATIVES WERE REJECTED, AND BOTH WOULD HAVE WORKED.**

`--resume <id> --fork-session` mints a fresh id while inheriting the prior transcript. It solves the collision and bounds nothing else, but the transcript becomes a linked list of files and `session` stops naming the current one — the board would have to learn to walk it.

*A fresh session per slice* gives the cleanest context boundary and breaks the join outright: the agent starts each slice cold, having forgotten what it learned on the last.

**THE COST OF WHAT WAS CHOSEN IS STATED RATHER THAN HIDDEN.** A long-lived agent's transcript and context grow across slices, and nothing here bounds them. `Worker bound: 28800` bounds the agent's LIFE, not its context. When a transcript is measured large enough to matter, `--fork-session` is the change that answers it, and this decision is the reason to reach for that one rather than a fourth.

**`resumeId` IS THE FIELD THAT CARRIES IT, and this slice is what makes it real.** `registry.ts:126` already declares it *"a second field, not an alias"* and says the question *"cannot even be ASKED while one field carries both meanings."* It is written once at dispatch, equal to `session`, and read by nothing — a field with one writer, no readers and a twin is drift waiting to happen.

So the hop writes it and the prompt reads it. `update_manifest_on_hop` (`plot-worker-loop.sh:249`) rewrites `branch`, `worktree` and `wavesCount` today and leaves `resumeId` alone; it gains that write. `session` stays fixed and stays the join key. The two diverge exactly where the docstring predicted, and a later `--fork-session` becomes a change to one field's value rather than a new concept.

**A FAILED PROMPT MUST NOT READ AS AN IDLE AGENT, AND IT MUST NOT LOSE ITS SLICE.** Both, because they answer different questions.

*Fail loudly.* `EndingReasonSchema` holds four values — `bound`, `quiet`, `unreadable`, `spent` — and none of them means *nothing ran*. A prompt that could not start writes a fifth and exits non-zero, so `plot-worker-state.sh` answers `failed`, the `attempts` budget applies, and `--restart` is reachable. Today the loop returns from `run_bounded` (`:1237`) and falls through to a wait.

**The ACTOR is `agent`, and `detail` carries the runtime's words.** The agent's own process ran the command and received the refusal, so the party that acted is the agent — `bound` and `monitor` name watchers that did not fire here. This gives `EndingActorSchema`'s only unwritten value its first writer: [`an-agent-lifecycle-refuses`](2026-09-04-a-lifecycle-is-enforced-by-a-test.md) measured `'agent'` as admitted, documented *"the agent stopped itself"*, and produced by nothing. No new actor is invented for the runtime, because `detail` already exists to carry what separates one ending from another, and *"Session ID … is already in use"* is the entire diagnosis.

*Keep the assignment.* The manifest's `branch` is cleared on the way into the wait, so an agent that failed to start reads free and the slice returns to the queue. It must stay claimed: nothing else should take a slice this agent was given and is still holding a desk for.

**THE LOOP ASKS THE TRANSCRIPT AND EXPORTS THE FINISHED FLAG.** A prompt cannot tell a first slice from a hop today: the hop exports `PLOT_BRANCH` and `PLOT_WORKTREE` (`plot-worker-loop.sh:1498`) and nothing else, and `PLOT_SESSION_ID` never changes. So the decision — resume when a transcript exists under the id, create when none does — is made in the loop, and the prompt file receives an argument it interpolates without knowing the rule.

**THE PROJECT'S FILE CARRIES WORDING, NOT LOGIC**, and that is what makes the template of the second slice worth shipping. A rule placed in `.plot/worker-prompt.sh` is a rule in the one file every project rewrites for itself — the same file that got `--session-id` wrong. Exported as a finished flag, a project can rewrite its whole prompt and still cannot get this wrong.

**AND IT AVOIDS A SECOND IMPLEMENTATION OF A PATH THE BOARD ALREADY COMPUTES.** A `test -f` in the template would re-derive `transcriptDir`'s slug rule in shell; `readResumeAvailability` is already TypeScript and already the board's answer to *which transcript is this agent's*.

**That test is already the board's, and it is deliberately the only honest one.** `readResumeAvailability` (`resume.ts:42`) exists for this exact question, and its docstring says why a probe rather than an assertion: Plot *"exports the session id … and documents the `--session-id` an adopting project's `.plot/worker-prompt.sh` must pass on. It can require neither — that file and the harness it invokes belong to the project — so the one honest test is whether a transcript exists under the id Plot asserted."*

**IT ALSO SELF-CORRECTS, WHICH A COUNTER WOULD NOT.** A `wavesCount` branch is right only while every earlier prompt actually ran. The transcript is the ground truth: an agent whose first prompt never started has no transcript, so its second correctly CREATES rather than failing to resume something that does not exist. That is precisely the state today's three agents were left in.

**A BLANK HANDLE MUST NEVER REACH `--resume`, AND THIS TRAP IS WORSE THAN THE ONE THE FILE ALREADY DOCUMENTS.** `--session-id ""` is a malformed argument that fails loudly, and `.plot/worker-prompt.sh:14` carries a paragraph about it. `--resume` is **optional-valued** — *"Resume a conversation by session ID, or open interactive picker"* — so a blank value does not fail: it opens a picker, in a `-p` run with no terminal.

So the flag is emitted only with a value, inside the same `[ -n … ]` guard the file already uses, **and a test asserts the built argv never contains a bare `--resume`.** The guard prevents it; the test proves the guard. The existing bash 3.2 note — a plain `"${a[@]}"` on an empty array expanding to one empty argument, measured 2026-09-04 — is this exact class of bug surviving careful prose, in this exact file.

**THE DIRECTORY IS THE SUBTLETY, AND IT MUST BE READ FROM THE RIGHT DESK.** `transcriptDir` (`transcript.ts:79`) keys on the **cwd** the runtime ran in, not on the agent. A hop that RESETS the desk keeps its path, so the transcript stays where it was; a hop that CREATES one (`plot-worker-loop.sh:1415`, the fallback when the desk holds unaccounted work) moves it, and a probe in the new desk finds nothing and creates a fresh session.

**THAT SPLIT IS A DEFECT, NOT A PROPERTY, AND IT IS RECORDED RATHER THAN FIXED HERE.** `session` is meant to be the agent's identity for its whole life — `registry.ts:120` calls it *"the identity, and the transcript's name"* — and a per-desk transcript breaks that promise quietly: the board would show an agent whose transcript apparently restarts, with nothing saying why. Following an agent across desks is its own change, in the board rather than in the loop, and it needs a measurement of how often a created desk actually happens before it is designed. This plan states the split, and the next one closes it.

**Done when** an agent handed a second slice starts a prompt on it, the prompt resumes when a transcript exists under the id and creates when none does, a prompt that cannot start writes an ending record and exits non-zero rather than waiting, the slice stays assigned across that failure, and `resumeId` is written by the hop and read by the prompt.

### The prompt template Plot never shipped (Branch: bug/a-worker-prompt-has-a-template)

`plot-init` writes `.plot/worker-prompt.sh` from a shipped template, and this repo's own copy learns the resume rule.

**MEASURED 2026-09-05: `find skills -name '*worker-prompt*'` RETURNS NOTHING.** The file the loop invokes on every prompt has no template, no generator and no example in the repository. Every adopting project writes it from prose, and the prose it follows is a comment inside `plot-worker-loop.sh`. This bug is what that costs: a rule written once in a docstring, implemented once by hand, wrong on the second slice.

**A TEMPLATE IS A GATE THE OTHER OPTIONS ARE NOT.** Documenting the resume rule for adopters answers CLAUDE.md's own test with a *yes* — you can say you did it without doing it. A file `plot-init` writes is either present or absent.

**`plot-init` ALREADY DOES THIS FOR ANOTHER FILE.** `SKILL.md:129` copies a **Plan template** into `.plot/templates/plan.md`, and the `Plan template` config key makes it overridable. The worker prompt takes the same shape: shipped, copied on adoption, overridable by any project that wants different wording.

**PLOT STILL DOES NOT OWN THE WORDING.** The template carries the session handling and the invocation; what the agent is *told* stays the project's. That is why this is a template rather than a hardcoded prompt — the loop's own comment (`plot-worker-loop.sh:19`) settles that a project's prompt is its own, and a starting point is not ownership.

**THIS REPO'S COPY IS FIXED IN THE SAME SLICE**, because a template nobody runs proves nothing, and this estate is where the defect was measured.

**THE TEMPLATE CARRIES NO SESSION LOGIC.** The loop exports the finished flag, so the template interpolates it and states nothing about resuming. That is what keeps this slice about distribution rather than about the rule — and it is why a project rewriting its prompt wholesale still cannot reintroduce the bug.

**AN EXISTING PROMPT FILE IS OFFERED THE UPDATE, NEVER GIVEN IT.** Round 3 moved the decision into the loop, so a project still passing a bare `--session-id` from its own prompt stays broken on its second slice and nothing tells it. `plot-init` already probes what a repository is and proposes rather than imposes — every field it writes is *"a proposal a human confirms"* — so it detects an out-of-date prompt and offers the template, leaving the operator's own wording theirs to keep.

**A release note would not have reached this repo.** The prompt file here was written by hand, has been edited twice since, and would have gone on passing `--session-id` until a second slice failed again. Detection at adoption is where the mismatch is visible; a changelog entry is a rule, and this bug is what that rule's violation looks like.

**Done when** `plot-init` writes `.plot/worker-prompt.sh` in a fresh repository, offers the update where one already exists and overwrites nothing, this repo's copy handles a second slice, and the template contains no session decision of its own.

**A FAILED START IS RESTARTED IN PLACE, NOT REPLACED.** What is restarted is the agent, on the branch it was handed, at the desk it already holds — a fresh prompt, nothing else moved. The claim and the desk are both correct; only the invocation failed. That is exactly what `--restart` does today: it *"inherits the tree untouched"* and refuses on a live pid, a `PLOT-BLOCKED` marker and a PR, none of which a failed start produces.

**Handing the slice to a different agent would be the wrong reading**, because the fault is the invocation's and not the agent's — a second agent invoked the same way fails the same way, having paid for a desk and a claim move.

**THE LOOP BOUNDS ITS OWN RETRIES ON `attempts`, AND THAT WIDENS THE FIELD'S MEANING.** `registry.ts:141` documents it as *"how many times a SUPERVISOR retried this agent"* and states plainly that *"nothing in Plot raises it yet; the field exists so the two counters were never one."* This slice is what raises it, and the loop is not a supervisor.

**The widening is deliberate and the alternative is worse.** `attempts` versus `relaunches` separates *automatic* from *a person's* — not *supervisor* from *loop*. A loop retry is automatic by every property the distinction was drawn for: it spends no human patience, and counting it against `relaunches` would let a self-retry exhaust an operator's record. So the field keeps its dividing line and loses only the word *supervisor* from its docstring, which the slice updates.

**Without a bound the agent spins.** The slice stays assigned, `wait_for_work` finds a branch, the prompt fails in under a second, and nothing stops that repeating for the full eight hours of `Worker bound: 28800`. Past the budget the loop ends the worker, leaving a `failed` desk and a `PLOT-BLOCKED` marker for a person, with the runtime's own words already in the ending record.

**AN AGENT HOLDING A CLAIM WITH NO PROMPT RUNNING IS A FINDING.** The AgentMonitor reports three today — `clear`, `owes a review`, `owes an answer`, `holds unlanded work` — and gains a fourth. **This is deliberately wider than the bug.** The fifth `EndingReason` makes THIS cause visible; the finding catches the next cause of the same shape, which is what today's measurement argues for: three agents sat `running · idle` for over an hour with every exit code zero, and what found them was a person reading a log.

**THE HOP TEST WAS GREEN THROUGHOUT, AND THAT IS WHY THIS REACHED PRODUCTION.**
`test/reconcile/declaration-hop.test.mjs` performs a REAL hop against a real
loop — its own header insists *"the hop is performed, not mocked"* — and it has
never failed. It could not catch this: its fixture prompt is a shell script
that writes a file, commits and pushes, and **never invokes `claude`**, so no
session id is ever consumed and the second slice starts happily.

**A fixture standing in for the thing under test will pass whatever the real
thing does.** The test asserts the hop's BOOKKEEPING — one declaration per
branch — and the bookkeeping was correct. What was broken was the hop's actual
work starting, which nothing in that fixture exercises. This is the same lesson
[`a-lifecycle-is-enforced-by-a-test`](2026-09-04-a-lifecycle-is-enforced-by-a-test.md)
is written about: a rule the test cannot violate is a rule the test does not
check.

**So this slice tests both halves, and the fixture is where they part.**

*The flag is asserted.* The fixture prompt records the session arguments it was
handed, and the test reads them: `--session-id <id>` on the first slice,
`--resume <id>` on the second, and never a bare `--resume`. No `claude` is
needed, because since round 3 the decision is the LOOP's and the argv is what
carries it.

*The failure is reproduced.* A second fixture exits non-zero when handed a
session id it has already seen — the exact shape of the real refusal. That is
the only way to prove the fifth `EndingReason` is written, the exit is non-zero
and the assignment survives; a flag assertion cannot reach any of them.

**THIS SLICE LEADS ITS SIBLING.** [`a-merged-slice-leaves-the-queue`](2026-09-05-a-merged-slice-leaves-the-queue.md) was found by the same event and is the same age, and this one goes first: until it lands **no agent can take a second slice at all**, so the queue defect cannot be observed again. Fixing the queue first would produce correct offers that still die on arrival.

## Notes

### Why the fleet reached this only today — 2026-09-05

The hop path has existed for weeks and no agent had used it: dispatch stopped spawning, so an agent finished its slice and exited. Three agents were started by hand on 2026-09-05, two slices merged within the hour, and the supervisor matched all three to new slices — the first second-slice hand-over the estate has ever performed.
