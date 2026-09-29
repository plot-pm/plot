Position: amend
Evidence: executed

# Consequence — the board port is configured, not typed

## 1. The premise is true, and every cited line verifies

`grep -rn 'Board port' skills/ CLAUDE.md` exits 1 with no output. Outside the plan itself and its sprint line, the string does not occur anywhere in the repository.

All three citations are correct, which is worth stating given the brief's warning:

- `skills/plot/scripts/plot-boardctl.sh:78` — `DEFAULT_PORT=7777`
- `packages/board/src/server/index.ts:49` — `const REQUESTED_PORT = Number(process.env.PORT ?? 7777);`
- `skills/plot/scripts/plot-boardctl.sh:400` / `:402` — `PORT="$port" exec "$artifact"` and `PORT="$port" exec node "$artifact"`

**No alternative configuration route exists.** `grep -rn 'PLOT_BOARD_PORT\|PLOT_PORT'` returns nothing across the repository. `.plot/` holds no port file. There is no `.env`. The only routes are `--port N`, the `PORT` env var read at `index.ts:49`, and the two hardcoded defaults. The plan's *"the 7778 exists only in the shell history"* is accurate.

The motivating measurement reproduces live. Read-only `GET /api/board` on both:

```json
:7777  { "restartCommand": "pnpm board", "port": 7777, "repo": "/Users/jwloka/Quatico/Agentic-Tools/plot",  "ci": "GitHub Actions" }
:7778  { "restartCommand": "",           "port": 7778, "repo": "/Users/jwloka/Quatico/ewz/ewz-kus-portal", "ci": "Jenkins" }
```

## 2. The desk question — the config is shared, but the blast radius is small

**The shared-file mechanism is real and I proved it.** `plot-config.sh:167` resolves its root from `PLOT_REPO_ROOT` or `git rev-parse --show-toplevel`. In a worktree that returns the *worktree's own* root, and the worktree carries its own checked-out copy of the tracked `CLAUDE.md`. Measured against the live estate:

```
$ cd .worktrees/free-4e6564dc
toplevel:        /Users/jwloka/Quatico/Agentic-Tools/plot/.worktrees/free-4e6564dc
git-common-dir:  /Users/jwloka/Quatico/Agentic-Tools/plot/.git
CLAUDE.md present: yes
plot-config.sh get "Board command" → pnpm board
```

And in a purpose-built sandbox with `Board port: 7778` declared in the main checkout's `CLAUDE.md`:

```
main checkout reads: 7778
desk toplevel:       …/portlab/desk
desk reads:          7778
```

**Nine checkouts of this repository would all resolve the same `Board port`.** Eight are desks (`git worktree list` → 9 entries).

**But the pidfile does not follow it.** `plot-boardctl.sh:86` puts it at `$repo_root/.plot/state/board.pid`, and `.gitignore:30,35` keeps it per-worktree. Measured across all nine:

```
/Users/jwloka/…/plot                       pidfile:46011
.worktrees/free-4e6564dc                   pidfile:none
…all seven others                          pidfile:none
```

So the configured port is **global** and the pidfile is **local** — the exact asymmetry `--stop`'s two-fact rule is built on.

**Answering the three sub-questions:**

- **Which port does a worker get?** It gets the configured one. But `grep -n -i 'boardctl|pnpm board|api/board|localhost:'` over `plot-worker-loop.sh` and `templates/worker-prompt.sh` returns **nothing** — desks never start or ask about a board. So the exposure is an *agent that decides to run `/plot-board` in its desk*, not the loop.
- **Does `--status` from a desk report the main checkout's board?** Yes, and it does so **correctly and more loudly than today**. With the key, a desk's `--status` asks the configured port, finds the main board, and `board_repo` (`:290-301`) compares realpaths: `here` is the desk, `there` is the main checkout, so it prints `answers: yes — serving ANOTHER checkout`. That is truthful. Today, without the key, the same command on the default port prints exactly the same thing. **No regression.**
- **Do two checkouts of the same repo collide more?** `--start` from a desk: the port is held, so `:366-386` refuses and reports whose it is — `here != there`, so it prints the other-checkout branch. `--stop` from a desk: `rec` is empty, `lp` is the main board, so `:465-471` refuses with *"pid N holds port N, but this repository recorded no board"* and exits 1. **Every desk path refuses safely.** The key makes desks reach the *right* board to be refused by, where today they reach the default one. The refusals get more accurate, not less.

**So question 2 is a real mechanism with a small consequence.** I looked for the defect the brief predicted and the two-fact rule absorbs it. This is not where the plan is wrong.

## 3. Where the plan IS wrong: it does not reach the way this repo actually starts its board

**`pnpm board` never touches `plot-boardctl.sh`.** `package.json:14`:

```json
"board": "node --watch skills/plot/scripts/board/board-server.mjs"
```

No `PORT`, no config read. The plan's design says *"The shell owns it: `plot-boardctl.sh` already resolves the artifact and passes `PORT=`, so it resolves the port too"*. That sentence is true of `plot-boardctl.sh` and false of the command this repository declares as its own.

**And the board tells the operator to run exactly that command, next to the port.** `packages/board/src/server/server-info.ts:30` defines `BOARD_COMMAND_KEY = 'Board command'`; the file's own header says its job is *"what the page needs in order to name a way out when this server stops answering: the command that starts it, and the port it bound."* The live payload above carries `restartCommand: "pnpm board"` and `port: 7777` **in the same object**.

Ship the plan as written and this repository reaches a state where:

- `CLAUDE.md` declares `Board port: 7778`
- `/plot-board --start` binds 7778 — correct
- the board's dead-server overlay says *run `pnpm board`* — which binds **7777**

The one screen an operator reads when the board has died would hand them a command that starts it on the wrong port. `server-info.ts:33-39` argues at length that a *guessed* command is worse than none, *"in exactly the case the overlay is for: a reader staring at a frozen board, ready to believe the one instruction on screen."* A command that is declared and wrong is the same failure the file already refuses.

**The plan's `Done when` does not cover this.** Its five items name `--start`, `--port` precedence, the empty-config default, `--status`/`--stop`, and documentation in `CLAUDE.md` + `/plot-board-setup`. None reaches `package.json:14`, `server-info.ts`, or `SKILL.md:261` (`pnpm board   # serves http://localhost:7777 (override: PORT=8080 pnpm board)`) — which documents the env-var override as the answer, and would then be the *second* documented way to set a port, disagreeing with the first.

**Count of places that would need to change** for the key to mean what it says, excluding changelogs, past plans, panel files and briefs:

| Place | What it assumes |
|---|---|
| `skills/plot/scripts/plot-boardctl.sh:78` | the default — **the plan's scope** |
| `packages/board/src/server/index.ts:49` | the server fallback — plan says leave it, fine |
| `package.json:14` (`pnpm board`) | **no port at all** — not in scope, and it is `Board command` |
| `packages/board/src/server/server-info.ts` | renders that command beside the bound port |
| `skills/plot/SKILL.md:261` | documents `PORT=8080 pnpm board` as the override |
| `skills/plot/README.md:86`, `skills/plot/scripts/board/README.md:10` | document 7777 as the address |
| `skills/plot-board/SKILL.md:47,95,97` | documents `--port N (default 7777)` |

`packages/board/test/port.test.mjs:158` (*"starting without PORT still binds 7777"*) is **safe** — it spawns the server directly with no `PORT`, so it tests `index.ts:49`, which the plan explicitly leaves alone. Likewise the ~12 `port: 7777` literals in `packages/board/test/unit/*.ts`, which construct option objects and bind nothing. **No browser test hardcodes a URL on 7777.** The brief's question 3 worry does not materialise; the real gap is the start command, not the tests.

`test/reconcile/boardctl.test.mjs` is already shaped for the key: `sandbox()` copies `plot-config.sh` alongside the two scripts (`:55`) and writes a `## Plot Config` block (`:61`). The three asserted precedence cases are cheap to add.

## 4. `--status`'s exit contract survives

`:306-307` is `[ -n "$lp" ]; exit $?` — exit 0 when something listens on the asked port, 1 otherwise. Reading the port from config does not change the predicate, only which port is asked. And because both `--status` and `--start` resolve the port identically from the same key in the same checkout, **there is no case where `--status` answers about a different board than `--start` would create**. The one risk would be a mid-flight config edit between the two commands, which is indistinguishable from the operator editing anything else.

The plan is right that `--stop`'s two-fact rule is untouched: it reads the pidfile and `lsof` on whichever port it was given, and is indifferent to the number's provenance.

## 5. Is the problem worth the key? Mostly — but the plan understates what already works and overstates what is left

The plan's Motivation says it plainly: **"Every part of that diagnosis already works."** I verified each part:

- the server reports `already running` and exits 0, so `plot-boardctl.sh` fetches `/api/board` instead (`:192-203`)
- `--start` on a held port refuses and names the checkout (`:366-386`)
- `--status` prints `answers: yes — serving ANOTHER checkout` with both paths (`:290-301`)

**What the operator actually loses today is one flag they must remember**, and a `--stop` they must also remember it on. That is a genuine cost — the plan's `Done when` item *"an operator never types it twice"* is the honest statement of the benefit — but it is a convenience, not a correctness gap. Nothing is silently wrong today; the diagnosis is loud and correct.

**Does that justify a config key?** Yes, narrowly, for one reason the plan does not make: the estate already demonstrates the alternative and it is worse. The motivating repository's `AGENTS.md:71-77` carries a hand-written `Fleet label` key with a section headed **"Noch nicht von Plot gelesen — heute beim Aufruf mitzugeben"** and a shell snippet the operator must paste. That is the shape a port lives in today, and it is precisely what `#1051` is closing for the label. A declared-but-unread key is the estate's measured failure mode; a declared-and-read one is the fix.

But note what that same file shows: **the motivating repository configures Plot in `AGENTS.md`, not `CLAUDE.md`.** `plot-config.sh:173-180` handles this — it tries `CLAUDE.md` then `AGENTS.md` — so the key works there. The plan's `Done when` says *"documented in the `## Plot Config` block of this repo's own `CLAUDE.md`"*, which is right for this repo and would leave the documentation naming only one of the two files Plot reads.

## Against my own position

**The strongest case for `proceed`:** `pnpm board` is the `Board command` key's value, and that key is a *different* configured thing. One could argue the plan is correctly scoped to `plot-boardctl.sh` and that reconciling `Board command` with `Board port` is a second plan — precisely the argument the plan's own Notes make for splitting the port, the artifact and the label into three. That is a coherent reading, and if the amendment were "add a sixth `Done when` item naming the overlay", I would be asking for one line.

I do not think it survives the overlay. The two values are rendered **in the same payload object, by the same module, for the same reader, at the moment they are least able to check**. `server-info.ts` exists to prevent a reader believing a wrong instruction on a frozen board. Shipping a port key without reconciling it creates exactly that. This is not a second plan's problem; it is this plan's `Done when` being incomplete about its own blast radius.

**The strongest case for `reject`:** the plan's Motivation concedes the whole diagnosis already works, and what remains is one flag. A config key adds a permanent entry to a `## Plot Config` block this repository already documents across ~40 keys, for a saving of one `--port 7778`. One could argue the honest fix is a line in the second checkout's `AGENTS.md` saying *"this board runs on 7778"* — a note, not a key.

I do not think that survives either, and the reason is on this machine: that is **exactly** what the ewz repository did for `Fleet label`, and `#1051` is the plan that exists because it was not enough. A note is a thing a person reads; a key is a thing a script reads. The estate has measured which one holds.

**Where I could be wrong about the desks:** I proved the mechanism and then argued the two-fact rule absorbs it. If a future change ever makes a desk start a board — a board-per-desk feature, a supervisor that serves its own tree — the shared key becomes a real collision with a per-worktree pidfile, and the refusals I verified would become the *normal* path rather than the exceptional one. Nothing in the plan's `What this does NOT do` says the key is repository-wide and deliberately so. That is worth one sentence.

## The amendment

1. **Add a `Done when` item covering the start command.** Either `pnpm board` reads the key, or `Board command`'s rendered value and `Board port` are reconciled so the overlay cannot name a command that binds a different port from the one beside it. Naming the conflict and deferring it in `What this does NOT do` is acceptable; leaving it unsaid is not.
2. **Say the key is read from `CLAUDE.md` *or* `AGENTS.md`** — `plot-config.sh:173-180` already does, and the motivating repository uses the second.
3. **State in `What this does NOT do` that the key is repository-wide**, so every worktree resolves it, and that the per-worktree pidfile is what keeps `--start`/`--stop` refusing correctly from a desk. I verified this holds; it should be recorded as a property rather than rediscovered.
4. **Correct the documentation sweep.** `skills/plot/SKILL.md:261` documents `PORT=8080 pnpm board` as the override and would become a second, disagreeing answer.
