# Sprint: Plot works in the repos that adopt it

> Five defects, all found by using Plot in a repository other than this one. Three stop a team outright: `/plot-fleet` cannot run where Plot is a plugin, a healthy Jenkins reports as unauthenticated, and a sprint of lightweight tasks cannot be committed. None is reproducible here, and that is what let them ship.

## Status

- **State:** Planning
- **Start:** 2026-09-24
- **End:** 2026-10-08
- **Release:** 2.21.0

## Sprint Goal

**A team adopting Plot in their own repository can run the fleet, read their build status, and commit a sprint — without building Plot, without knowing a config key's parsing rules, and without a refusal that points at the wrong thing.**

Every item here was reported from outside this checkout. That is the sprint's organising fact rather than a coincidence: this repository builds its own board, authenticates its own host, and writes every sprint item as a plan reference, so it exercises none of the paths below. **The defects are not obscure; they are invisible from here.**

Three conditions, and all must hold.

**Runnable.** `/plot-fleet` and `/plot-board-setup` work in a repository that consumes Plot as a plugin. Today the first resolves its artifact against the consumer's checkout and tells them to run a script that does not exist there.

**Legible.** A refusal names the thing that is actually wrong. Two items are refusals that blame the wrong party — a sprint's headings when the problem is its item form, and a juror's verdict when the problem is the caller's argument.

**Separable.** WAITING ON YOU answers one question at a time. Measured on an adopting repository: **18 rows, of which 2 were actionable.**

### Must Have

- [ ] [#969](https://github.com/plot-pm/plot/issues/969) — `plot-fleetctl.sh:89` resolves `plot-registryd.mjs` against the consumer's repo root, so `/plot-fleet` cannot run in any repository that consumes Plot without also building it. Both lines of the error mislead: the artifact is not missing, and the `pnpm build:board` it suggests does not exist there. `plot-boardctl.sh` resolves the same class of artifact correctly, through `plot-board-probe.sh` — so the fix has a working sibling to follow.
- [ ] [#968](https://github.com/plot-pm/plot/issues/968) — `plot-board-probe.sh` hands the whole `Jenkins instance` value to `jen -I` instead of splitting at the first `/`, reporting a correctly authenticating instance as `auth: failed`. The probe's own `job` field is parsed correctly from the same value, so one value is split two ways in one script.
- [ ] [#967](https://github.com/plot-pm/plot/issues/967) — WAITING ON YOU collects plans, branches, PRs and build states across a dozen verdicts and presents them as one list, while a reader arrives with one of three questions: what should I pick up, what finished, what is broken. Measured on a Bitbucket repository with a clean estate (`drift=0 attention=0`): **18 rows, 2 actionable.**
- [ ] [#966](https://github.com/plot-pm/plot/issues/966) — a sprint whose Must Haves are all lightweight tasks (`- [ ] description`, no `[slug]`) cannot be committed: `commitment-empty` fires with *"names no Must"* while `plot-sprint-release.sh` parsed all eight and scored them `open`. `skills/plot-sprint/SKILL.md:240` documents both item forms, so the refusal contradicts the skill.
- [ ] [#965](https://github.com/plot-pm/plot/issues/965) — `plot-panel.mjs check` given a `|`-separated positions list reports every juror as uncommitted (exit 3) instead of an unusable argument (exit 2), blaming the juror for the caller's mistake. Exit 3 triggers step 4's re-ask, so a broken caller looks like a hedging panel and the re-ask cannot help.

### Should Have

- [ ] [a-stop-that-reports-failure-does-not-exit-zero](../plans/2026-09-24-a-stop-that-reports-failure-does-not-exit-zero.md) — `/plot-fleet --stop` printed *"supervisor did NOT unload"* and exited 0. Panelled 2026-09-24, unanimous `amend`, amended: the mechanism is recorded as undetermined and the fix is correct under all three candidates.
- [ ] [a-supervisor-that-stopped-ticking-is-not-running](../plans/2026-09-24-a-supervisor-that-stopped-ticking-is-not-running.md) — `--status` reported `running` over a daemon silent for 25 hours. Panelled the same day; its harm claim was refuted from its own numbers and the plan now records the refutation. Two slices, the second carrying the reading to the board.

### Could Have

- [ ] [the-board-shows-me-only-my-work](../plans/2026-09-24-the-board-shows-me-only-my-work.md) — a My-work filter. **Could rather than Should, because its own measurements say it cannot be tested here**: no current-user concept exists, `Assignee:` is abandoned (71 of 321 plans, none since 08-30), and a PR row carries no author. On a one-contributor estate a filter that hides nothing looks identical to one that works.

### Deferred

<!-- Items moved here during sprint when they won't make the timebox -->

## Retrospective

<!-- Filled during /plot-sprint close: What went well / What could improve / Action items -->

## Notes

**This sprint will be refused at commit by one of its own Must Haves.** Its five Must items are tracker references, not `[slug]` plan links, which is the lightweight form #966 reports as unable to commit — `transitions/sprint.ts:263` raises `commitment-empty` with *"names no Must"*. Expect that refusal, and read it as the bug rather than as a malformed sprint. Committing it becomes possible either once #966 lands, or once each issue has a plan whose slug the item can name.

**Why #935 is not here.** It is open on the tracker and its work shipped: `2026-09-17-a-gate-matches-an-invocation.md` is `Released` via PR #942. A stale ticket, not backlog — including it would arm the release gate against work that is already done. It wants closing, not planning.

**None of the five has a plan yet.** Each Must is an issue reference, so `/plot-idea` runs before `/plot-implement` for all of them. #969, #968 and #965 are each diagnosed to a line in their issue body and should be quick; #967 is a design change to a whole section and is the one that could consume the timebox.

### Scope Changes

<!-- Format: - YYYY-MM-DD: Added/Moved/Removed [slug] reason -->
