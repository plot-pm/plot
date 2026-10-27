# Juror verdict: safety

Plan: `docs/plans/2026-10-27-the-controller-gate-reads-a-grep.md` (PR #2759, issue #2706). Code read at `pmain` (current `origin/main`).

Position: amend

## Method

I **ran** a probe. I copied `packages/domain/src/rules/ci-suite.ts` twice into a temp dir under the scratchpad. One copy stayed as on main ("today"). In the other copy I replaced `isReadSegment` with `isReader`, which is the plan's change as written ("`isReadSegment` agrees with `READERS`" plus `GIT_READERS`). I ran `controllerInvocation` from both copies over 60 command shapes with Node 24 type stripping. Then I removed the temp dir. Every "today / widened" pair below comes from that run. I **read** `controller-gate.ts` and `packages/board/src/server/entry/gate.ts` for the callers.

I also **ran** git in a throwaway repo, with a neutral probe script and not a gated name, to confirm that the git readers can run a program:

- `GIT_EXTERNAL_DIFF=./probe.sh git diff` ran the probe.
- `GIT_EXTERNAL_DIFF=./probe.sh git log --ext-diff -p -1` ran the probe.
- `git grep -O./probe.sh b` ran the probe.

## 1. The problem

The account is correct. I **read** `ci-suite.ts:302-308`: `isReadSegment` accepts only `ls`, `cat` and `git grep`. I **read** `READERS` at `ci-suite.ts:60-62` and `GIT_READERS` at `:65`. These two sets are used only by `withoutDataLists` (`:94-105`). I **ran** the issue's shapes: `grep -n x …/plot-dispatch.sh` gives `dispatch` today, and `head -5 …/plot-approve.sh` gives `approve` today. Both give `null` after the widening.

The cause is real. But `READERS` was designed for a different context, and the plan does not account for this. `withoutDataLists` widens only when the body holds **no command substitution**: `ci-suite.ts:101` refuses a body in which any word matches `/\$\(|`|[<>]\(/`. `isReader` itself does not carry that condition. The plan proposes to reuse `isReader` without the guard that made it safe in its first caller.

## 2. Bypasses the change opens (ran)

`controllerInvocation` splits on `&&`, `||`, `;`, `|` and new lines only (`ci-suite.ts:208`). It does not strip quotes (`gate.ts:652` passes the message-sink-stripped text, not `withoutQuotes`), and it has **no `readShell` fallback**. The merge check has one (`controller-gate.ts:280-283`). So when a segment reads as a read, the gate skips everything inside it, including a command substitution.

**New bypasses: refused today, passed after the widening.** Each one runs a gated script.

| command | today | widened |
| --- | --- | --- |
| `grep x $(…/plot-dispatch.sh slug)` | dispatch | null |
| ``wc -c `…/plot-dispatch.sh slug` `` | dispatch | null |
| `diff <(…/plot-dispatch.sh slug) /dev/null` | dispatch | null |
| `head -1 <(bash …/plot-approve.sh slug)` | approve | null |
| `tail -f /dev/null >(…/plot-dispatch.sh slug)` | dispatch | null |
| `test -n "$(…/plot-dispatch.sh slug)"` | dispatch | null |
| `[ -n "$(…/plot-deliver.sh slug)" ]` | deliver | null |
| `grep -v '^#' …/plot-dispatch.sh \| bash -s slug` | dispatch | null |
| `grep -l . …/plot-dispatch.sh \| xargs -I{} bash {} slug` | dispatch | null |
| `head -n 9999 …/plot-dispatch.sh > /tmp/d.sh; bash /tmp/d.sh slug` | dispatch | null |
| `tail -n +1 …/plot-dispatch.sh \| tee /tmp/d.sh \| sh -s slug` | dispatch | null |
| `wc -l …/plot-dispatch.sh > x.sh && source x.sh` (shape) | dispatch | null |
| `GIT_EXTERNAL_DIFF=…/plot-dispatch.sh git diff --ext-diff HEAD~1` | dispatch | null |
| `git log --ext-diff -p -1 -- …/plot-dispatch.sh` (with `GIT_EXTERNAL_DIFF` set by an assignment prefix) | dispatch | null |
| `PAGER=…/plot-dispatch.sh git log -1` | dispatch | null |
| `git show -1 --output=…/plot-dispatch.sh` (overwrites the gated script) | dispatch | null |
| `grep() { bash "$@"; }; grep …/plot-dispatch.sh slug` | dispatch | null |

The `GIT_EXTERNAL_DIFF` shape is the worst one, for three reasons:

- `programWords` (`ci-suite.ts:114-126`) strips a `NAME=value` assignment before the program, so the gated name sits only in the stripped prefix.
- `git diff` runs the external diff **with no flag at all**. I ran that.
- It opens a new class. Today no reader in the carve-out takes an environment program. `git diff`, `git log` and `git show` are new to the carve-out, and each one can run a program (`--ext-diff`, the `diff.external` env, a pager) or write a file (`--output`).

**Existing holes the widening multiplies.** These pass today through `cat`, `ls` or `git grep`. The widening extends them to ten more programs.

- `cat $(…/plot-dispatch.sh slug)` is `null` today. The plan names this as Open Question 2 but leaves it undecided.
- `cat …/plot-dispatch.sh | bash -s slug` is `null` today. The pipe's downstream segment `bash -s slug` names no script.
- `git grep --open-files-in-pager=…/plot-dispatch.sh slug` is `null` today, and `git grep -O` runs its program. I ran that.

**Shapes that stay refused, correctly** (ran): `bash …/plot-dispatch.sh x`, `xargs …/plot-dispatch.sh`, `bash <<< "$(cat …/plot-dispatch.sh)"`, `sh <(grep . …/plot-dispatch.sh) slug`, `bash -c "$(head -999 …)" x slug`, `find … -name plot-dispatch.sh -exec bash {} slug \;`, `git -c diff.external=… log -p --ext-diff`, and `stat …/plot-deliver.sh && …/plot-deliver.sh slug`. The plan's four named tests pass under the widening. That is the problem: the plan's tests cannot fail on any of the bypasses above.

## 3. Reads the gate still wrongly refuses (ran, widened copy)

These still give `dispatch`, `approve` or `deliver`: `sed -n 1,5p`, `awk 'NR<5'`, `rg -n`, `nl`, `less`, `md5`, `file`, `git blame`, `git -C . grep`, `git --no-pager log`, `time grep`, `command grep`, `bash -n`, `shellcheck`, `node --check …/plot-deliver.mjs`, `echo "see plot-dispatch.sh for it"`, and `gh pr comment 1 --body "plot-approve.sh reads x"`. The last two are refused because `controllerInvocation` reads quoted text: a trailing `"` is stripped by `wordBasename` (`ci-suite.ts:257`). `git -C . grep` regresses relative to the issue's intent. `isReader` takes `program[1]` as the subcommand, so any global git option turns a read into a run. Today `isReadSegment` has the same defect. None of these blocks the plan. The plan should name them as out of scope, so that a later issue does not rediscover them.

## 4. Merge-pin check

I **read** `unpinnedProgram` (`controller-gate.ts:241-255`). Today `grep pr-merge …/plot-host.sh` counts as an unpinned `plot-host` merge. The widening fixes that false refusal, as the plan says. The merge check stays safe against substitution: when the segment pass finds nothing, `unpinnedMerges` falls back to `readShell` (`:280-283`), which reads inner commands. `controllerInvocation` has no such fallback, so one shared reader set is safe for the merge check but **not** for the controller check. That answers Open Question 3: the two checks share the program set, but the controller check needs the substitution, pipe and assignment guards below.

## 5. Other checks

- Layer: correct. This is a domain rule in `packages/domain/src/rules/`. There is no shell change and no cost against `check-shell-lines.sh`, and bash 3.2 is not involved. It is the same on Bitbucket and GitHub, and project-agnostic.
- Docs: the TSDoc table and paragraph at `ci-suite.ts:184-186` ("unless its segment's program is `ls`, `cat` or `git grep`") and the doc at `controller-gate.ts:262` must change in the same slice.
- Tests: the place is `packages/domain/test/ci-suite.test.ts`, with `controller-gate.test.ts` for the merge arm. `test/reconcile/controller-gate.test.mjs` covers the bundle end to end.
- Slice: one slice is right. The acceptance must include refusals that fail on the naive widening, not only reads that fail on today's code.

## Amendments

1. **A reader segment with a substitution is a run.** A segment is a read only if no word matches the guard that `withoutDataLists` already uses (`/\$\(|`|[<>]\(/`, `ci-suite.ts:101`). Reuse that guard; do not write a second one. This closes Open Question 2 for every reader, including the existing `cat $(…)` hole. Tests: `grep x $(…/plot-dispatch.sh s)`, ``wc `…/plot-dispatch.sh s` ``, `diff <(…/plot-dispatch.sh s) f`, `[ -n "$(…/plot-deliver.sh s)" ]` → the action.
2. **A git reader with an assignment prefix or a run/write option is not a read.** Drop `diff`, `show` and `log` from the read carve-out unless the segment has no leading `NAME=` assignment or `env`, and no `--ext-diff`, `--output`/`--output=`, `-O`/`--open-files-in-pager`, or `--textconv`. Apply the same rule to the existing `git grep`. Simplest form: a segment with any leading assignment is never a read. Tests: `GIT_EXTERNAL_DIFF=…/plot-dispatch.sh git diff`, `git log --ext-diff … -- …/plot-dispatch.sh`, `git grep -O…/plot-dispatch.sh x`, `git show --output=…/plot-dispatch.sh` → refused.
3. **A reader piped into a shell or `xargs` is not a read.** When a later segment of the same `|` pipeline has `bash`, `sh`, `zsh`, `source`, `.`, `eval` or `xargs` as its program, the reader segments in that pipeline are runs. Tests: `grep . …/plot-dispatch.sh | bash -s s` and `grep -l . …/plot-dispatch.sh | xargs -I{} bash {} s` → `'dispatch'`. Also `cat …/plot-dispatch.sh | bash -s s` → `'dispatch'`, which fixes today's hole.
4. **A reader that redirects stdout to a file is not a read**, except `>/dev/null`. `head … > /tmp/d.sh` is a copy, and `cp` of a gated script is refused today. Alternatively, record this as a known hole in the TSDoc with the shape named.
5. **State the residual holes in the TSDoc**: a shell function that shadows a reader name (`grep() { bash "$@"; }`), and a two-call copy-then-run. The gate defends against habit, not against an adversary, so naming these is enough.
6. **Name the reads that stay refused** (section 3) as out of scope in the plan, and keep `sed` out. Open Question 1: `sed -n` needs a parser for `e` and `w`, and amendments 1–3 matter more.
7. **Acceptance must fail on the naive widening.** Add the refused shapes from amendments 1–3 to the slice's acceptance. As written, a change that only replaces `isReadSegment` with `isReader` passes every listed test and ships 17 new bypasses.
