# A probe reports and the domain judges

> `plot-board-probe.sh`'s header says *"It DECIDES NOTHING"*, and seven lines below it decides that Node 20 is the floor. Six more thresholds sit in the adoption probe. Each is a decision no test can reach.

## Status

- **State:** Draft
- **Type:** infra
- **Sprint:** the-jenkins-team-sees-its-builds
- **Story:** setup-asks-what-the-repo-already-knows
- **Review:** pr
- **Impl:** own branches
- **Rounds:** 6

## Changelog

- Setup's decisions are domain rules a test can assert, so what adoption proposes is checkable rather than inferred from skill prose.

<!-- Board impact: none. The board reads config, not the probes that propose it. -->

## Motivation

**Measured 2026-09-08 across the two collectors — seven thresholds, none of them a measurement:**

| decision | where | what it decides |
|---|---|---|
| `node_ok` = major `>= 20` | `plot-board-probe.sh:61` | what Plot supports |
| `>= 2` conventional | `plot-detect-repo.sh:92` | the commit style is conventional |
| `>= 2` colon | `:93` | the style is arlo-colon |
| `>= 2` dash | `:94` | the style is arlo-dash |
| `>= 2` occurrences | `:82` | a ticket prefix is real, not a coincidence |
| `>= 3` German words | `:127` | the repository's language |

**AND THE NODE FLOOR HAS THREE ANSWERS ON THIS ESTATE.** Measured 2026-09-08:

| who asks | what it says |
|---|---|
| `plot-board-probe.sh:61` | `>= 20`, hardcoded |
| `plot-fleetctl.sh:87` | the major `.nvmrc` pins — today 24 |
| `plot-boardctl.sh` | **nothing** — `--start` runs whatever `node` resolves to |

**`node_ok` HAS NO READER AT ALL.** Searched the whole tree: outside the probe that writes it, the only mention is `boardprobe.test.mjs:66` asserting the field exists. No skill reads the value, no code branches on it. So a decision is hardcoded, never consulted, and disagrees with the one place that does check — while the command it would protect checks nothing.

**AND THE FILE SAYS IT DOES NOT DO THIS.** `plot-board-probe.sh:13`:

> *"It DECIDES NOTHING. Every field is a fact; which artifact to recommend, whether Jenkins keys are warranted, and what an empty board means are all judgments left to the skill (Manifesto Principle 3)."*

`node_ok` is not a fact about the machine. `node --version` is; whether 20 is enough is a decision about Plot.

**THE SETUP RULE HAS THE SAME PROBLEM IN THE OTHER DIRECTION.** `/plot-board-setup` step 2 states it plainly — *"One signal proposes, two signals ask. Where two signals point different ways, setup does not tie-break — it asks, naming what it found."* That is a good rule living as prose an agent is asked to follow. CLAUDE.md's own test: *can you answer "did I complete this?" without doing the work?* Yes — which makes it a rule, and rules are eventually violated.

**THE PRECEDENT IS ALREADY STATED FOR RENDERING**, and it transfers without change:

> *"a view state that cannot be asserted without a browser is a domain property that has not been extracted yet."*

A setup decision that can only be checked by reading skill prose is the same thing.

**THIS SPRINT IS WHERE THE NEXT ONE WOULD LAND, AND THAT SETTLED THE ORDER.** `the-probe-reads-the-ci-system` adds `ci_system` to the same collector, and *which signals justify `CI: jenkins`* is exactly such a judgement. Its first draft carried the derived word beside the booleans; **it now waits on this plan instead**, so the seventh threshold is never written rather than written and removed. The price is that Jenkins adoption waits on a refactor, and it is paid because `plot-detect-repo.sh` is read by two skills and two test files — the file where doing it twice costs most.

## What this is not

**NOT A MOVE OF THE PROBES INTO THE DOMAIN.** They reach the machine — `node --version`, `git rev-parse`, whether `jen` is authenticated, whether a `Jenkinsfile` exists. The domain takes readings as values and performs no I/O, and the layering rule points outward: a script sits at the outer edge and is reached only from an adapter. **The collectors keep collecting.**

**Not a change to what adoption proposes.** The same words for the same signals. What changes is where the choice lives and whether a test can see it.

**Not a gate on the thresholds.** No CI check counts them. The gate is the test that asserts the rule.

## Slices

### `proposeStack` decides what the readings propose (Branch: feature/a-probe-reports-and-the-domain-judges)

A domain rule takes a probe's readings and returns proposals; the collectors report raw values.

**THE READINGS GO IN AS VALUES.** `proposeStack({ nodeVersion, ciSignals, ticketPrefixCount, commitStyleCounts, … })` — the shape the domain already uses everywhere, so it needs no port and no mock.

**THE SKILLS REACH IT THROUGH ITS OWN BUNDLE**, `board/plot-propose-stack.mjs`, the way `a-shell-script-asks-the-domain` settled this seam earlier in the sprint: one bundle per question, and adoption runs once per operator command. A verb on `plot-ask.mjs` would put an adoption question inside the master agent's entry point, which is a different job.

**A MISSING BUNDLE REFUSES AND NAMES ITS REPAIR**, the way `plot-deliver.sh:36` already does — *"cannot find … run 'pnpm build:board'"*. That reads like the wrong answer for `/plot-init`, which runs in a foreign repository where `pnpm build:board` builds nothing; measuring settles it. **All 15 bundles are tracked in git** under `skills/plot/scripts/board/`, so they arrive with every clone and every plugin install: an adopting repository that has the skills has the bundle. The refusal therefore fires only on a broken installation, where naming the build command is exactly right — and never on the normal first run, which is the case that made the question worth asking.

**A BUNDLE IS NOT SMALL, AND THE PLAN SHOULD NOT PRETEND OTHERWISE.** Measured 2026-09-08: `plot-sprint-score.mjs`, the precedent, is **321 KB**; `plot-ask.mjs` is 491 KB. Bundling the domain costs a third of a megabyte whatever the question, so the argument for a separate artifact is not size — it is that a caller asking about adoption should not load the fleet controller to get an answer. The cost rule `docs/shell-and-domain.md` states is the one that licenses it: `node` starts in 34 ms and a shipped bundle answers in 39 ms, which a once-per-adoption call can pay.

**ONE PR MEANS ONE REVERT, AND THAT IS THE STRONGEST ARGUMENT FOR THE HARD CUT.** This slice touches `plot-detect-repo.sh`, `plot-board-probe.sh`, two skills and 43 tests across three files — the widest diff in the sprint, and the one most worth being able to undo. Moving everything together makes the way back a single `git revert`. **A transitional period with both field shapes would be worse in exactly this respect**: spread over two PRs, half-reverted it leaves the collector reporting a field nothing reads and a rule nothing calls, which is a state neither shape describes.

**THE OLD FIELDS GO IN THE SAME PR.** `commit_style`, `language_hint` and `node_ok` are replaced by the counts they were computed from, not kept beside them — a field left behind is exactly the second answer this plan exists to remove. **Two skills read the probe**, `/plot-init` and `/plot-board-setup`, plus two test files; all four move together, and the blast radius is the four of them.

**`node_ok` LEAVES THE PROBE AND `node` STAYS.** The version is the reading; the floor is the rule. A collector that stops deciding must also stop reporting the decision, or the old field becomes a second answer.

**AND THE RULE IS WIRED UP RATHER THAN LEFT UNREAD**, which is the difference between an extraction and a repair. Deleting a field nobody reads would be honest and would leave `plot-boardctl.sh --start` running under any `node` at all — the failure `/plot-fleet` refuses precisely because *"the unit bakes `$NODE` in permanently"*. So the rule takes its floor from `.nvmrc`, the one place that states it, and board setup reads it: **one answer where there were three, and it is consulted.**

**Done when** the seven thresholds are domain rules with tests; the collectors report raw readings (`node`, not `node_ok`; counts, not styles); the Node floor comes from `.nvmrc` rather than a literal, so `plot-board-probe.sh`, `plot-fleetctl.sh` and the rule give one answer; `/plot-board-setup` acts on it where it acted on nothing; `/plot-init` reads the proposals rather than recomputing them; and the domain package's branch coverage still holds at 100%.

### Two signals ask rather than tie-break (Branch: feature/two-signals-ask-rather-than-tie-break) <!-- waits: feature/a-probe-reports-and-the-domain-judges -->

The *one signal proposes, two signals ask* rule becomes a property of the proposal rather than a paragraph.

**IT WAITS FOR THE RULE ABOVE**, which is where a proposal gains a shape that can carry *"ask, and here is what I found"* as a value.

**A PROPOSAL AND A QUESTION ARE TWO ANSWERS, NOT ONE ANSWER WITH A FLAG.** A repository with both a `Jenkinsfile` and `.github/workflows/` has no proposed CI — it has a question naming two signals. A field holding `jenkins` plus `uncertain: true` invites a caller to read the first half.

**Done when** two conflicting signals produce a question naming both, one signal produces a proposal with its evidence, no signal produces neither, and a test asserts each without rendering a skill.

## Notes

### Where the question came from — 2026-09-08

Asked directly: *should `plot-board-probe.sh` move into the domain, given it is a setup workflow?*

**The answer was no, and it was worth asking.** The probe measures the machine and cannot move inward. But the setup *workflow* is five steps in the skill — probe, propose, write, verify, summarise — and only the first is the script. The judgement in the middle is what has no home: partly prose in step 2, partly a threshold in the collector.

**So the split is: the probe measures, the domain judges, the skill asks and writes.**
