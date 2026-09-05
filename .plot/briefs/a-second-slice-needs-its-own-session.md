## Implementation brief — a-second-slice-needs-its-own-session (slice: The second prompt resumes)

- **Plan (canonical):** `docs/plans/2026-09-05-a-second-slice-needs-its-own-session.md` on `main`
- **Branch:** `bug/a-second-slice-needs-its-own-session` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR

Slice 1 of two, and it gates slice 2 and the whole of [`a-merged-slice-leaves-the-queue`](../../docs/plans/2026-09-05-a-merged-slice-leaves-the-queue.md). Five rounds of interrogation; the plan's decisions are settled — implement them, do not re-derive them.

## The failure

Measured 2026-09-05, on three agents simultaneously:

```
plot-worker-loop: taken up on <slug> after waiting 5100s — the registry handed over a slice.
[feature/an-agent-lifecycle-refuses ea50df8e] plot: claim feature/an-agent-lifecycle-refuses
branch 'feature/an-agent-lifecycle-refuses' set up to track 'origin/…'.
Error: Session ID 5c7c41bd-ae8f-45ec-a220-2a23b5f1a16b is already in use.
plot-worker-loop: free on <slug> — nothing handed over yet …
```

Everything before the prompt works. Then `claude` refuses, the prompt exits in under a second, and the loop returns to waiting.

## What to build

### 1. The loop decides, and exports a finished flag

**`--session-id <id>` on the first invocation, `--resume <id>` after.** The decision is the LOOP's, not the prompt's — a rule in `.plot/worker-prompt.sh` sits in the one file every project rewrites for itself, which is the file that got this wrong.

**The loop probes the transcript**, because it cannot otherwise tell a first slice from a hop: `:1498` exports `PLOT_BRANCH` and `PLOT_WORKTREE` and nothing else, and `PLOT_SESSION_ID` never changes.

`readResumeAvailability` (`resume.ts:42`) already makes exactly this test, and its docstring says why a probe rather than an assertion: Plot *"can require neither — that file and the harness it invokes belong to the project — so the one honest test is whether a transcript exists under the id Plot asserted."*

**It self-corrects where a counter would not.** An agent whose first prompt never started has no transcript, so its second correctly CREATES. That is precisely the state the three agents above were left in — a `wavesCount` branch would have tried to resume something that does not exist.

**A BLANK HANDLE MUST NEVER REACH `--resume`.** `--session-id ""` is malformed and fails loudly; `--resume` is **optional-valued** — *"Resume a conversation by session ID, or open interactive picker"* — so a blank value opens a picker inside a `-p` run with no terminal, and hangs.

Emit the flag only with a value, inside the same `[ -n … ]` guard the file already uses at `.plot/worker-prompt.sh:29`, **and assert in a test that the built argv never contains a bare `--resume`.** The guard prevents it; the test proves the guard. That file's own bash 3.2 note — a plain `"${a[@]}"` on an empty array expanding to one empty argument, measured 2026-09-04 — is this exact class of bug surviving careful prose, in this exact file.

### 2. `resumeId` becomes real

`registry.ts:126` declares it *"a second field, not an alias"* and says the question *"cannot even be ASKED while one field carries both meanings."* It is written once at dispatch, equal to `session`, and read by nothing.

**The hop writes it and the prompt reads it.** `update_manifest_on_hop` (`plot-worker-loop.sh:249`) rewrites `branch`, `worktree` and `wavesCount` today and leaves `resumeId` alone; it gains that write. `session` stays fixed and stays the join key.

### 3. A failed start fails loudly and keeps its slice

**`run_bounded` RETURNS 0 OR 124 AND NOTHING ELSE.** Verified at `:1075-1076`:

```sh
[ "$_timed_out" = 1 ] && return 124
return 0
```

The prompt child's own exit code is never captured — `bash -c '. "$1"' _ "$prompt_file" &` at `:1000` is waited on, and the status discarded. **That is why a `claude` that exited non-zero in under a second read as a completed slice.** Capturing it is the core of this part.

**Write a fifth `EndingReason`.** `EndingReasonSchema` (`entities/ending.ts:42`) holds `bound`, `quiet`, `unreadable`, `spent` — none means *nothing ran*.

**`actor` is `agent`, `detail` carries the runtime's words.** The agent's own process ran the command and received the refusal; `bound` and `monitor` name watchers that did not fire. This gives `EndingActorSchema`'s only unwritten value its first writer. No new actor for the runtime — `detail` exists for exactly the text that separates one ending from another, and *"Session ID … is already in use"* is the whole diagnosis.

**Exit non-zero**, so `plot-worker-state.sh` answers `failed` rather than the loop falling through to `wait_for_work` at `:1400`.

**Keep the assignment.** The manifest's `branch` is cleared on the way into the wait, so a failed start returns the slice to the queue. It must stay claimed: nothing else should take a slice this agent still holds a desk for.

### 4. Bound the retries on `attempts`

**Without a bound the agent spins** — the slice stays assigned, `wait_for_work` finds a branch, the prompt fails in under a second, and that repeats for the full eight hours of `Worker bound: 28800`.

**THIS WIDENS `attempts`, DELIBERATELY.** `registry.ts:141` documents it as *"how many times a SUPERVISOR retried this agent"* and states *"nothing in Plot raises it yet."* The loop is not a supervisor. But the line the field draws is *automatic* versus *a person's* — `relaunches` is the human record — and a loop retry is automatic by every property that distinction was made for. **Update that docstring in this PR**; do not leave it saying supervisor-only while the loop writes it.

Past the budget the loop ends the worker, leaving a `failed` desk and a `PLOT-BLOCKED` marker for a person, with the runtime's words already in the ending record.

## Testing

**THE EXISTING HOP TEST IS GREEN AND ALWAYS WAS.** `test/reconcile/declaration-hop.test.mjs` performs a REAL hop against a real loop — its header insists *"the hop is performed, not mocked"* — and it could not catch this: its fixture prompt (`:183`) writes a file, commits and pushes, and **never invokes `claude`**, so no session id is ever consumed.

A fixture standing in for the thing under test passes whatever the real thing does. That test asserts the hop's BOOKKEEPING, which was correct.

**Two new tests, and the fixture is where they part:**

1. **The flag is asserted.** A fixture prompt records the session arguments it was handed; the test reads them — `--session-id <id>` first, `--resume <id>` second, never a bare `--resume`. No `claude` needed, because the decision is now the loop's and the argv carries it.
2. **The failure is reproduced.** A fixture that exits non-zero when handed a session id it has already seen. Only this can prove the fifth `EndingReason`, the non-zero exit and the kept assignment.

Gates: `pnpm test`, `pnpm run test:reconcile`, `pnpm run test:board`, `pnpm run typecheck`.

## Done when

- an agent handed a second slice starts a prompt on it
- the loop resumes when a transcript exists under the id and creates when none does
- the built argv never contains a bare `--resume`, asserted by a test
- `run_bounded` distinguishes a prompt that failed from one that finished
- a failed start writes an ending record (`actor: agent`, runtime text in `detail`) and exits non-zero
- the slice stays assigned across that failure
- `resumeId` is written by the hop and read by the prompt
- retries are bounded by `attempts`, and its docstring no longer says supervisor-only
- the gates above pass

## Do not

- **Do not put the session decision in `.plot/worker-prompt.sh`.** Round 3 moved it into the loop on purpose: the template must ship wording and no logic, so a project rewriting its prompt cannot reintroduce this.
- **Do not use `--fork-session`.** Considered and rejected: `transcript.ts:100` opens `${sessionId}.jsonl` literally, so a forked chain is a linked list the board cannot follow.
- **Do not branch on `wavesCount`.** It is right only while every earlier prompt actually ran.
- **Do not fix the per-desk transcript split.** `transcriptDir` keys on cwd, so a CREATED desk gets a fresh transcript while a RESET desk keeps its own. The plan records this as a defect for a later change in the board; it is out of scope here.
- **Do not ship the template in this slice.** That is `bug/a-worker-prompt-has-a-template`.
- **Do not run `pnpm run test:e2e`** locally. CI is its gate.
