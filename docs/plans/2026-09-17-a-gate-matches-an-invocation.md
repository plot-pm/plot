# A gate matches an invocation

> A commit message explaining which script performed a write is refused as though it were that script — so the gate taught a caller to write a vaguer message, which is the one thing it cost.

## Status

- **State:** Approved
- **Type:** bug
- **Issue:** #935
- **Sprint:** a-declared-agent-costs-what-it-costs
- **Story:** plot-gates
- **Review:** in-session
- **Impl:** own branches
- **Rounds:** 1
- **Approved:** 2026-09-17, jwloka, in-session

## Changelog

- `plot-controller-gate.sh` reads a heredoc body as data rather than as a command. A commit message naming the script that performed a write was refused, and renaming the script to "the approval" in the prose let the identical commit through.

<!-- Board impact: none. A PreToolUse hook's matching rule. No plan format,
     no template, no layout. -->

## Design

**The loop takes any token:**

```sh
for tok in $CMD; do
  base="${tok##*/}"
  [ -n "$(gated_action "$base")" ] || continue
  named_script="$base"
  break
done
```

**Position is never consulted.** A name in a heredoc line, a quoted string or a
`grep` argument is a token like any other.

**The comment states the intent the code does not reach**: *"a command
MENTIONING the script inside a longer word does not fire."* That holds for
`foo-plot-approve.sh-bar` — the basename must stand alone — and it does not hold
for a standalone token that is not in command position.

### The measured cost is a commit message, and it is the one that matters

Four refusals in one session, reported:

| what the report named | re-measured here |
|---|---|
| a heredoc commit message naming the script that wrote a field | **refuses** — confirmed |
| a `for` loop running `grep -c` over three lifecycle scripts | **refuses** — confirmed |
| a `grep` for a symbol inside the dispatcher | **refuses** — confirmed |
| the `gh issue create` filing this report | **ALLOWS today** |

**Three of four, not four.** `gh issue create --body "plot-dispatch.sh …"`
passes, because the name sits adjacent to a quote and the gate already requires
the basename to stand alone as a token. The report's fourth case is corrected
rather than carried.

**Renaming the script to "the approval" in the prose let the identical commit
through.** That is the real loss: **the gate taught a caller to write a vaguer
commit message**, trading traceability for nothing. The reporter names it, and
this estate's own commit messages are where a measurement survives.

**Cases 2–4 push a caller toward obfuscating its own commands** — splitting the
name, building it from a variable — which produces commands nobody can grep for
later, the gate's authors included.

### The gate is right and only the match moves

**Its rationale is measured and stands**: *"five dispatches in one session went
to this script directly, by the agent that had read the rule."* It fired
correctly on every real invocation in the reported session, and each refusal was
accepted.

**So nothing about which actions are gated changes.** `gated_action`, the
read/write split, the desk exemption and every refusal message stay as they are.

### Command position was this plan's first answer, and it is refused

**A panel measured it blind to the shape the gate was built for.** The incident
in the gate's own header is *"five dispatches in one session"*, and the natural
spelling of several dispatches is a loop:

```
refuses :: for s in a b; do skills/plot/scripts/plot-dispatch.sh $s; done
```

**That refuses today and command position would not see it**, because a loop
body is not command position. The fix would have been blind to the original
defect while removing two `grep` calls.

**And it contradicts this plan's own rule.** `if`, `for`, `while`, `$( )`,
`{ }` and `-c` are not wrappers — they are shell grammar, and a token loop sees
through all of them for free. A gate that declines to parse shell cannot
reliably find command position in shell.

**The trust asymmetry settles it.** The gate's header says *"a master agent's
own assertions cannot be trusted… a working directory is a measurement."*
Command position is something the caller **writes**. Today an evasion needs
obfuscation, which is visible in a transcript; after that change it would need
only ordinary-looking shell.

### The heredoc body is data, and its extent is readable

**So the fix is the report's third suggestion**, which an earlier draft of this
plan dismissed as insufficient:

> strip heredoc bodies before tokenising — from `<<'WORD'` to a line equal to
> `WORD`

**The quoted form's extent IS readable without parsing shell.** `<<'EOF'` names
its terminator literally, and the body ends at a line equal to it. That is a
scan, not a grammar.

**It fixes the one case that cost something and adds zero false negatives.** The
commit message is the case this plan is named for: renaming the script to *"the
approval"* let the identical commit through, trading traceability for nothing.

**Cases 2 and 3 are left refusing, deliberately.** They are `grep`/`cat`/`sed`
reads, and this estate already spells a read another way — the reporter did
exactly that to file the issue. **Trading fifteen missed invocations for two
`grep` calls is not a trade this gate's risk asymmetry permits.**

**Only the single-quoted form is stripped.** `<<EOF` unquoted interpolates, so
its body can contain a substitution that is a command; `<<'EOF'` cannot. The
narrow form is the one whose body is provably data.

### What this does not do

**It does not narrow what is gated.** Every action that fires today on a real
invocation fires after, which is the property to pin hardest — a matching fix
that quietly stops catching a dispatch would be worse than the false positives.

**It does not touch `plot-state-gate.sh` or `plot-phase-gate.sh`.** They match on
different things and neither was reported.

**It does not make the gate parse shell.** A single-quoted heredoc's extent is a
scan for its own terminator; command position is not.

**It does not fix cases 2 and 3**, and the plan says so rather than implying a
completeness it refused on purpose.

## Slices

### A gate matches an invocation (Branch: bug/a-gate-matches-an-invocation, PR: #942)

- `bug/a-gate-matches-an-invocation` — strip single-quoted heredoc bodies before tokenising, leave the token match otherwise untouched, and add a corpus of invocation shapes that must keep refusing

**Done when** a `git commit` whose single-quoted heredoc body names a gated
script **passes**, pinned by a fixture holding the reporter's own message; an
**unquoted** `<<EOF` body is **still** tokenised, since its contents can be
substituted; and **no command refused today is allowed after** — pinned by a
corpus **inside the contract test**, not in prose, holding at minimum a plain
call, `./relative`, an absolute path, `bash <script>`, `sh -c '<script>'`,
`env FOO=1 <script>`, a `for` loop body, a `while` body, an `if` body, `{ }`,
`( )`, `$( )`, `source`, `.`, `xargs` and `find -exec`.

**That ratchet is the gate this slice turns on**, because a matching change to a
refusal is a place where one false negative costs more than every false positive
removed; every other clause here can be satisfied by changing nothing.

The reporting modes (`--status`, `--dry-run`, and the rest) still pass; the desk
exemption is unchanged; `test/reconcile/controller-gate.test.mjs` and
`plot-install-hooks.sh:246` both drive the gate with `bash <script>` and both
still behave as today; and `pnpm run test:contracts` passes.

## Notes

**Amended 2026-09-17 after a gate-safety panel**
(`.plot/panels/2026-09-17-a-gate-matches-an-invocation/`), which **reversed this
plan's answer.** The first draft proposed command-position matching; the juror
drove the gate with fifteen invocation shapes and found a loop body is not
command position — so the fix would have been blind to *"five dispatches in one
session"*, the measurement the gate exists for. Re-measured here:

```
refuses :: for s in a b; do skills/plot/scripts/plot-dispatch.sh $s; done
```

**The plan now takes the alternative it had dismissed**, and the dismissal was
argued from a sentence rather than a measurement: *"it fixes case 1 and leaves
2–4"* — where case 4 does not fire at all and cases 2–3 are reads that can be
spelled another way.

**Reported 2026-09-17, and the report could not be filed until its own text was
written to a file by another route** — the `gh issue create` carrying it was
refused for quoting the script names it is about.

**The reporter argues for the gate while reporting it**, which is why this plan
changes only the match. A gate people route around by obfuscating their commands
has stopped being a gate; a gate that blocks a commit message has started
costing something it was never meant to.

**This estate has one measurement of what such a message is worth.**
`CLAUDE.md` records that a reasoning belongs *"in the commit that introduced the
guard, so `git log -S` finds it"*. A gate that refuses the script's name in that
commit refuses the thing the rule asks for.
