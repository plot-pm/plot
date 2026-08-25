# A hung child does not hold the loop

## Status

- **Phase:** Approved
- **Type:** bug
- **Sprint:** the-board-tells-the-truth-in-every-section
- **Issue:** <!-- optional -->
- **Story:** <!-- optional -->
- **Review:** in-session
- **Impl:** own branches
- **Approved:** 2026-08-25, Jan Wloka, in-session
- **Started:** <!-- YYYY-MM-DD, who, `branch` -->
- **Delivered:** <!-- YYYY-MM-DD -->
- **Released:** <!-- YYYY-MM-DD, version -->

## Changelog

A worker whose agent process hangs is ended rather than waited on forever, and
a worker that has finished its branch still occupies a slot until it exits.

## Motivation

### The measurement

Found by an operator asking why the board showed eleven workers with nothing to
do, 2026-08-25. Measured on the machine:

```
13 live workers, 11 of them with an already-merged PR
```

All eleven had the same last line in `.plot-worker.log`:

```
Error: No messages returned
    at NO9 (…/@anthropic-ai/claude-code/cli.js)
    at process.processTicksAndRejections
This error originated either by throwing inside of an async function
without a catch block…
```

An unhandled rejection **inside the agent CLI**. The process did not exit. Each
sat in state `S`, CPU unchanged over a two-second sample, one of them for
**10 hours**:

```
child 75757   elapsed 10:07:04   cpu 1:07.19 → 1:07.19   state S
```

`plot-worker-loop.sh:88` sources the prompt file, so the agent runs in the
foreground and the loop waits for it to return. It never returned.

### The control case, on the same machine

Two workers dispatched the same hour finished normally, opened PRs #420 and
#421, and **exited cleanly** — `dirty=0 unpushed=0`. Same loop, same host, same
prompt. So the loop is not structurally broken; it has no answer for a child
that crashes without dying.

### Why the fleet then grew instead of shrinking

Auto-dispatch started two NEW workers while those eleven were hung, against a
cap of 3. That is not a second bug — it follows from `liveAgentCount`:

```ts
agents.filter((a) => LIVE_STATES.has(a.state) && !(a.branch && landed.has(a.branch)))
```

An agent whose branch has **landed** is excluded from the count. The intent is
sound: a worker whose work is merged no longer blocks a *useful* slot. But it
still occupies a machine — CPU, memory, a worktree — and every one of those
eleven had a merged branch, so none of them counted.

**Two reasonable rules compose into an unbounded fleet.** *Lowering the cap
never kills* (correct — a half-done branch killed mid-run strands work nobody
can see) and *landed branches do not count* together mean the fleet grows for as
long as PRs merge faster than workers exit.

### What it cost

Eleven processes and their worktrees for up to ten hours; a `parallel agents
(cap) 3` control reading `11 working`; and an operator unable to tell a thinking
worker from a dead one, because the board reports both as `running`.

## Design

### The loop bounds the wait

The prompt invocation at `plot-worker-loop.sh:88` runs under a bound. When it
fires, the loop treats the branch as unfinished, logs why, and exits rather than
hopping — a hung agent has left the worktree in a state nobody measured, and
starting a second branch on top of that guess is worse than stopping.

**The mechanism is measured before it is chosen, and that is this wave's first
step.** The obvious phrasing — `timeout 1h . "$prompt_file"` — does not work:
line 88 is `. "$prompt_file"`, a shell **builtin**, and `timeout(1)` execs a
process. It cannot wrap a `source`. Two candidates survive, and neither is
obviously right:

| Candidate | Cost |
|---|---|
| `timeout $B bash -c '. "$f"'` | The prompt moves into a subshell, so every `PLOT_*` variable must be exported or `$PLOT_BRANCH` expands empty |
| A bash watchdog: background sleep + `kill` | No context change, no dependency — but the watchdog is code that must clean up on **every** exit path |

The spike answers one question for both: **does the bound survive Ctrl-C, a kill
of the loop itself, and a child that ignores SIGTERM?** A bound that leaks its
watchdog, or that dies with the shell it was meant to outlive, is worse than
none — it looks like protection and is not.

### `timeout(1)` is not assumed

Measured on this machine: `timeout` resolves to `/opt/homebrew/bin/timeout` —
**coreutils, not macOS.** A mac without Homebrew has neither `timeout` nor
`gtimeout`, and Plot's other helpers assume nothing beyond POSIX tools and git.

So the bound is implemented in **bash alone**. Reporting the absence and
carrying on was rejected: it makes the protection vanish silently on exactly the
systems that lack it, which converts a gate back into a rule (CLAUDE.md — *can
you answer "did I complete this?" without doing the work?*). Documenting it as a
prerequisite was rejected for the same reason Node 24 is different: Node is
already required to run the board at all, coreutils is required by nothing else
here.

**This is a gate, not a rule** (CLAUDE.md). *"Never leave a worker hanging"* is
advice an agent can rationalise past; a `timeout` is enforced by the shell on
every exit path.

**The bound is measured, not guessed.** Honest runs on this estate, PR creation
to merge:

| PR | duration |
|---|---|
| #414 | 9 min |
| #417 | 9 min |
| #416 | 29 min |
| #419 | 13 min |

Against hangs of up to 10 hours. Two orders of magnitude of separation, so a
bound of roughly an hour never truncates real work. It is a **Plot Config key**
with that default — Principle 5, and a project whose waves are genuinely longer
sets its own.

### Why not catch the error

The rejection happens inside the agent CLI's own process. Plot cannot install a
handler there, and there is no exit code to read **because the process does not
exit** — that is the entire defect. A crash that terminated would be harmless:
the loop would see a non-zero status and carry on.

Matching the log for `No messages returned` was rejected for the same reason a
denylist is always wrong here: it recognises only the hang already seen. A
timeout catches the next one too.

### A landed branch still holds its machine

`liveAgentCount` stops excluding landed branches, so the cap counts processes
rather than useful work.

**`liveAgentBranches` must stay consistent with it** — it exists so a refusal at
the cap names which agents hold the slots, and a count that disagrees with its
own explanation is the defect `a-count-answers-to-its-section` fixed elsewhere.

The `LIVE_STATES` filter is untouched: this changes which live agents count, not
what live means.

### Not chosen: kill a worker whose branch has landed

Tempting — the work is merged, so end it. Rejected: the loop's whole purpose is
to hop to the next wave of the same plan, and a worker between waves has a
merged branch by definition. Killing on that signal would end healthy workers
mid-hop, which is the *"never kill; lowering only withholds"* rule inverted.

### Not chosen: detect the hang by CPU

The sharper diagnosis — a child at zero CPU growth is not working — and it is
already planned as wave `Marked` of `a-state-is-a-word-not-a-sentence`, where it
belongs: it makes the board SAY what a worker is doing. This plan makes the loop
STOP. Both are wanted; neither substitutes for the other.

## Waves

### Bounded (Branch: bug/the-loop-bounds-its-child)

`plot-worker-loop.sh` runs the prompt under a configurable bound implemented in
bash alone, and a timed-out worker exits with its reason in the log instead of
hopping. **Begins with the spike** above: subshell versus watchdog, decided by
which survives Ctrl-C, a killed loop, and a child that ignores SIGTERM.

### Counted (Branch: bug/a-landed-branch-still-holds-a-slot)

`liveAgentCount` counts every live agent, landed or not, so auto-dispatch cannot
start work beside workers that have not exited.

## Done when

1. A worker whose prompt never returns is ended by the timeout, and its log says
   so. Asserted with a stub prompt that sleeps past the bound — not against the
   real CLI, which cannot be made to hang on demand.
2. **A worker whose prompt finishes normally is never truncated.** Asserted with
   a prompt that runs close to, but under, the bound. This is the assertion a
   naive implementation fails: a bound that fires on slow-but-honest work trades
   a visible hang for silent data loss, which is strictly worse.
3. A timed-out worker **does not hop** to the next wave. Its worktree state was
   never measured, so continuing would build on a guess.
4. The bound is a `## Plot Config` key with the measured default; a project that
   sets nothing sees that default.
5. **The bound needs no `timeout(1)`.** Asserted with `timeout` and `gtimeout`
   absent from `PATH` — measured here at `/opt/homebrew/bin/timeout`, so a mac
   without Homebrew has neither. A gate that disappears where the tool is
   missing is a rule.
6. **The watchdog leaves nothing behind.** Asserted after a normal finish, a
   timeout, and a kill of the loop itself: no orphaned sleep, no stray child.
   This is the assertion the spike exists to inform, and the one a naive
   implementation fails — a bound that outlives its worker is a new leak in the
   fix for a leak.
7. `liveAgentCount` counts a live agent whose branch has landed. Asserted
   directly, since this is the line that let the fleet reach 13 against a cap
   of 3.
8. **`liveAgentBranches` names exactly the agents `liveAgentCount` counted.**
   The two must not diverge — the refusal message explains the number.
9. Auto-dispatch refuses to start while live agents ≥ cap, whatever their
   branches' merge state.
10. `pnpm test`, `pnpm run test:reconcile`, `pnpm run test:board` green.

## Notes

### The board could not say it, which is why it took an operator

Eleven rows read `running` and `someone is on it` — both true by Plot's
definitions, neither able to distinguish a worker mid-thought from one whose
child died ten hours ago. The reader who asked *"aren't they idle or waiting?"*
was reading the fleet more accurately than the fleet was reading itself.

### It belongs to this sprint's subject

*The board tells the truth in every section.* A cap of 3 above 11 running
workers is a section contradicting itself, and the contradiction was in the
counting rule rather than in the display.
