# Panel — a-gate-matches-an-invocation

**One juror: `amend` (gate-safety). Not unanimous — and it reversed the plan.**

## Command position is blind to the shape the gate exists for

The juror drove the gate with fifteen invocation shapes. The decisive one:

```
refuses :: for s in a b; do skills/plot/scripts/plot-dispatch.sh $s; done
```

**A loop body is not command position.** The gate's own header records *"five
dispatches in one session went to this script directly"*, and several dispatches
are most naturally written as a loop. **The proposed fix would have been blind
to the original defect** while removing two `grep` calls.

## Two arguments the plan could not answer

**It contradicts its own rule.** The plan says the gate does not parse shell.
`if`, `for`, `while`, `$( )`, `{ }` and `-c` are shell grammar, and a token loop
sees through all of them for free. A design that declines to parse shell cannot
reliably find command position in shell.

**The trust asymmetry inverts.** The gate's header: *"a master agent's own
assertions cannot be trusted… a working directory is a measurement."* Command
position is something the caller writes. Today an evasion needs obfuscation,
which a transcript shows; after the change it needs only ordinary shell.

## The dismissal was argued from a sentence, not a measurement

The plan refused the heredoc alternative as *"insufficient — it fixes case 1 and
leaves 2–4."* Re-measured:

| case | today |
|---|---|
| heredoc commit message | refuses |
| `for` loop with `grep -c` | refuses |
| `grep` inside the dispatcher | refuses |
| **`gh issue create --body`** | **ALLOWS** |

**Case 4 does not fire.** Cases 2–3 are reads, spellable another way — the
reporter did exactly that to file the issue. So the alternative fixes the one
case that cost something, at **zero** false-negative cost.

## What one lens cannot see

**This juror was asked to find false negatives and found them.** Nobody asked
whether the heredoc fix is worth shipping at all against simply accepting the
false positives, or whether the gate should log its refusals so the cost is
countable. A panel of one answers the question it was given.

## The moderator's reading

**Amend, and the plan's answer is reversed rather than adjusted.** It now takes
the option it dismissed, and its slice gate is a ratchet: no command refused
today may be allowed after, over a corpus **inside the contract test**.

**That ratchet is the finding's real product.** A matching change to a refusal is
where one false negative costs more than every false positive removed, and the
plan had no such gate before this panel.

**Nothing here moves the plan's phase.**
