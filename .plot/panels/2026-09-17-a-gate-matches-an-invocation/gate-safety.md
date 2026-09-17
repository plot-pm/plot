# Gate-safety lens — a-gate-matches-an-invocation

Position: amend

Subject: `docs/plans/2026-09-17-a-gate-matches-an-invocation.md`
Method: `plot-controller-gate.sh` and `plot-state-receipt.sh` copied to a scratch dir (original untouched), driven from the repo root — not a linked worktree (`--absolute-git-dir` equals `--git-common-dir`), with `.plot/state/` present, so every run reaches the receipt check rather than a fail-open branch. Two candidate fixes were implemented and driven against the same corpus: a literal first-token reading (`gate-naive.sh`) and a segment-splitting reading that follows `env`/`bash`/`sh`/`exec`/`command`/`nohup`/`time`/`timeout`/`eval` (`gate-cmdpos.sh`) — the generous end of what the plan describes.

---

## 1. Is the problem real, and stated correctly?

**Real, and understated in one place and overstated in two.**

The token loop is as the plan quotes it (`plot-controller-gate.sh:96-103`). Position is never consulted. Re-derived, the four reported false positives do **not** all fire today:

| plan's case | as tested | verdict |
|---|---|---|
| 1 — heredoc commit message | `git commit -F- <<'EOF' … plot-approve.sh … EOF` | **refuses** — confirmed |
| 2 — `for` loop with `grep -c` | `for s in plot-approve.sh …; do grep -c x $s; done` | **refuses** — confirmed |
| 3 — `grep` inside the dispatcher | `grep -n dispatch …/plot-dispatch.sh` | **refuses** — confirmed |
| 4 — `gh issue create` body | `gh issue create --body "plot-dispatch.sh fires wrongly"` | **ALLOWS** |

```
allow(0) | git commit -m "plot-approve.sh wrote the field"
allow(0) | gh issue create --body "plot-dispatch.sh fires wrongly"
REFUSE   | git commit -F- <<'EOF'
The gate refused because plot-approve.sh was named.
EOF
```

The reason is mechanical and the plan never states it: the loop reads `${tok##*/}` and `${base%%;*}`, so a **quote character fused to the name** makes the token `"plot-approve.sh` or `plot-approve.sh"`, which `gated_action` does not match. The name only fires when it is whitespace-delimited:

```
rc=0 :: git commit -m "plot-approve.sh wrote it"        ← quote adjacent, passes
rc=2 :: git commit -m "wrote by plot-approve.sh today"  ← mid-string, refuses
rc=0 :: git commit -m "see plot-approve.sh"             ← quote adjacent, passes
```

So today's behaviour is not "fires on any mention" — it is **fires on any mention not adjacent to a quote**, which is worse than the plan says because it is unpredictable to a caller. That strengthens the case for fixing it. But the plan's table asserts four refusals where I can reproduce three, and case 4 as written passes. The `--body-file` variant the issue actually describes also passes. **The plan should re-derive its own table**; the fixture it proposes to pin (`the reporter's own message`) may not be a refusing case at all.

## 2. Right fix, or symptom fix?

**Right direction, wrong stopping point, and the plan's own reasoning contains the refutation it does not follow.**

The plan rejects the read-only allow-list because "it is a list that must grow forever and is wrong the first time somebody uses a reader this plan did not think of." That argument is sound. It applies with **exactly equal force, and far worse consequences, to the wrapper list** — and the plan does not notice, because a missing entry on the allow-list costs a false positive while a missing entry on the wrapper list costs a **false negative**. The plan itself states the asymmetry ("a matching fix that quietly stops catching a dispatch would be worse than the false positives") and then adopts the design that realises it.

## 3. Does `Done when` contain a gate that cannot be satisfied by plumbing?

**Partly — and its invocation list is the specific weakness.**

The strong half is real: four invocation forms "each pinned separately" cannot be satisfied by plumbing a value through. Good.

The weak half is that the list is **closed and short** — `plot-approve.sh <slug>`, `./…`, an absolute path, `bash …`. An implementer who passes exactly those four and ships has satisfied the `Done when` while opening the holes in §5. The clause `a form that is not followed is named in the script rather than left implied` is satisfiable by **writing a comment** — that is documentation, not a gate. There is no requirement that the set of unfollowed forms be *enumerated by measurement*, and no requirement that the refusal count not fall.

**The missing gate, and it is one line:** *no command string refused by the gate today is allowed after, over the corpus in the contract test plus the forms this slice adds.* That is a ratchet, it cannot be plumbed, and it would have caught everything in §5.

## 4. Claims I could not verify, or found false

**False — "`env FOO=1 plot-approve.sh`, `bash plot-approve.sh` … each put the script somewhere a first-token test would miss."** True of a first-token test, but the plan presents this as the *bound being accepted*, then the `Done when` requires `bash …` to refuse and says "`env` and `bash`/`sh` wrappers are followed." The Design section and the `Done when` disagree about whether these are followed or conceded. An implementer reading the Design ships the naive version; one reading `Done when` ships the wrapper-following version. They produce different gates.

**False — the case-4 row of the measured table** (§1). `gh issue create --body "…"` passes today.

**Unverifiable — "It fired correctly on every real invocation in the reported session."** No artifact records it. `.plot/state/unowned-action-writes.tsv` is the only counter and it records escapes, not refusals.

**Unstated and load-bearing — the gate's own test suite and installer probe use `bash <script>`.** `test/reconcile/controller-gate.test.mjs` spells every command that way (7 occurrences, `const DISPATCH = 'bash skills/plot/scripts/plot-dispatch.sh some-slug'`), and `plot-install-hooks.sh:246` probes gate liveness with the same string. Under the naive reading that probe **allows**:

```
allow(0) | bash skills/plot/scripts/plot-dispatch.sh a-slug
```

so `plot-install-hooks.sh` would report the gate as not firing and `/plot-init` would tell adopting repositories their gate is broken. The plan claims "no plan format, no template, no layout" board impact and lists no consumers at all. **The installer is a consumer and it is not mentioned.**

## 5. What this lens notices that the plan missed

**The measurement.** Twenty-six command strings, every one a genuine invocation of `plot-approve.sh`. Today's gate refuses 24. The wrapper-following command-position gate refuses **9**.

```
real invocations: 26   OLD refuses: 24   CMDPOS refuses: 9   NEW FALSE NEGATIVES: 15
```

The fifteen that stop being caught:

```
allow(0) | out=$(skills/plot/scripts/plot-approve.sh my-slug)
allow(0) | echo hi | xargs -I{} skills/plot/scripts/plot-approve.sh my-slug
allow(0) | if true; then skills/plot/scripts/plot-approve.sh my-slug; fi
allow(0) | { skills/plot/scripts/plot-approve.sh my-slug; }
allow(0) | ( skills/plot/scripts/plot-approve.sh my-slug )
allow(0) | for s in my-slug; do skills/plot/scripts/plot-approve.sh $s; done
allow(0) | while read s; do skills/plot/scripts/plot-approve.sh $s; done < list
allow(0) | bash -c "skills/plot/scripts/plot-approve.sh my-slug"
allow(0) | bash -lc 'skills/plot/scripts/plot-approve.sh my-slug'
allow(0) | sh -c 'skills/plot/scripts/plot-approve.sh my-slug'
allow(0) | env -i skills/plot/scripts/plot-approve.sh my-slug
allow(0) | /usr/bin/env bash skills/plot/scripts/plot-approve.sh my-slug
allow(0) | source skills/plot/scripts/plot-approve.sh
allow(0) | . skills/plot/scripts/plot-approve.sh
allow(0) | find . -name plot-approve.sh -exec {} my-slug \;
```

The naive first-token version is worse still — it allows `bash …`, `sh …`, `env …`, `exec …`, `timeout 60 …`, `time …`, `command …`, `nohup …`, and the `xargs` form, i.e. the four the `Done when` explicitly demands.

**Rank these by what the gate exists to stop.** The measured incident was *"five dispatches in one session went to this script directly, by the agent that had read the rule."* The agent is an LLM emitting a Bash command string. Four of the fifteen are shapes such an agent writes constantly and with no intent to evade:

- `bash -c "…"` and `sh -c '…'` — the standard way to run a compound command
- `for s in …; do … done` — five dispatches across four plans is *precisely* a loop
- `$( … )` — capturing output to report it
- `{ …; }` / `( … )` — grouping with a redirect

**The `for` loop is the killer.** The incident this gate was built for was a multi-dispatch session. The most natural spelling of a multi-dispatch is a loop, and command-position matching does not see a loop body as command position. The fix would be blind to the exact shape of the original defect.

**Compound-command coverage is the structural gap, not a list of wrappers.** The plan frames the bound as "which wrappers we follow." That framing is wrong. `if`, `for`, `while`, `{`, `(`, `-c` and `$( )` are not wrappers — they are **shell grammar**, and a token loop sees through all of them for free. Command-position matching must re-derive each one, and the plan's own rule says the gate "does not parse shell." A design that refuses to parse shell cannot reliably find command position in shell. That is the contradiction at the centre of this plan.

**Trust asymmetry is inverted.** The gate's header states its own principle: *"an env var is something an agent SETS, and this gate exists because a master agent's own assertions cannot be trusted… A working directory is a measurement."* Command position is **exactly the kind of thing the subject controls** — the agent writes the string. Today's over-broad match is annoying but not steerable around except by obfuscation, and obfuscation is visible in the transcript. A command-position match is steered around by writing ordinary, innocent-looking shell. The plan argues "a gate people route around by obfuscating their commands has stopped being a gate" — but it replaces obfuscation-to-evade with **no obfuscation required at all**.

**What would get my `proceed`.** The narrowest fix that resolves every reproduced false positive without a single new false negative is not command position — it is **excluding the shapes that are provably data**, keeping the token loop otherwise:

1. strip heredoc bodies before tokenising (the extent *is* readable: from `<<'?WORD'?` to a line equal to `WORD` — the plan asserts this is unreadable, and for the quoted form it is not), and
2. keep the existing requirement that the basename be a bare token — which already, by accident, passes quoted `-m "…"` and `--body "…"` strings.

That is the issue's third suggestion, which the plan dismisses as "insufficient — it fixes case 1 and leaves 2–4." But case 4 does not fire today; cases 2 and 3 are `grep`/`cat`/`sed` reads, and every one of them can be re-spelled the way this estate already spells reads — which is what the reporter did to file the issue. Case 1 is the one the plan itself calls "the one that matters," and a heredoc exemption fixes it at **zero** false-negative cost. Trading 15 missed invocations to also fix two `grep` calls is not a trade this gate's own risk asymmetry permits.

**Concretely, to amend:**

- Re-derive the four-refusal table; case 4 passes today and the quote-adjacency rule explains why.
- Resolve the Design/`Done when` contradiction on whether `env`/`bash`/`sh` are followed or conceded.
- Add the ratchet: no command refused today may be allowed after, measured over a corpus that includes `bash -c`, `for`, `while`, `if`, `{ }`, `( )`, `$( )`, `source`, `.`, `xargs` and `find -exec` — and require the corpus to be *in* the contract test, not in prose.
- Name `test/reconcile/controller-gate.test.mjs` and `plot-install-hooks.sh:246` as consumers; both drive the gate with `bash <script>`.
- Weigh the heredoc-stripping alternative against the measurement above rather than against the sentence "it leaves 2–4."
