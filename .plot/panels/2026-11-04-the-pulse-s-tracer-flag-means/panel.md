# Panel — the-pulse-s-tracer-flag-means

Four jurors (layering, safety, testability, seams) read the Draft at `80e96dbe7` against `origin/main` at `e54e53815`. All four took the position **amend**. All four recommended Option A.

## Disagreements

- **Which live plan Option A changes.** Safety (finding 4) says `2026-11-03-registry-never-hands-out-an-approved` (Approved) carries a spike marker and stops being held. Testability (finding 6) lists it among six marker plans. Seams (finding 5) says every plan with a real branch-line marker is Released. The moderator ran `plot-plan-meta.sh` from `origin/main` over all 647 plan files: four plans carry a branch-line `spike` reading, all Released. The registry plan names `<!-- spike -->` only in prose, and the parser reads no spike branch in it. Seams is right; safety and testability counted a `git grep` hit, not a parser reading. The plan records the measured set and the person's accepted consequence.
- **How many marker plans exist.** Testability says six, safety says five, seams does not count. The parser says four. `2026-10-12-the-fleet-writes-the-design` matches `spike -->` in prose only.
- **Where the end-to-end test lives.** Safety asks for a test through the shell adapter or a corpus fixture over real parser output. Testability asks for `PlanRecord` fixtures through `assemblePlanWalk` → `planRow` → `planAutoDeliver`. Both hold: the plan names an adapter test over real parser output (`plan-store-shell.test.ts`) for the mapping, and `PlanRecord` fixtures for the walk, auto-deliver and fleet-row tests. The corpus cannot hold the `true` mapping because no plan on `main` says `Tracer: yes`; testability and seams did not note this.
- **The column a spike-only plan shows.** Layering and safety say the fleet row reads `proven`. `proven` is a `planStatus` value (`phase.ts:80`), and `planStatus` reads only the board's parser meta (`board.ts:1457`). The pulse `tracer` reaches `phaseOfPlan` (`workflow-phases.ts:149`), which puts the rows in `Design` under `DEFAULT_PHASE_MAP`. Seams and testability describe the column split correctly. The plan states the `Design` versus state-phase split and asserts the phase name.
- **A refusal for an undecided plan.** Safety asks for a `PLOT-BLOCKED` line if the plan still lists both options. The person decided Option A and the plan lists one option, so the plan carries no such line.

## Shared blind spots

- No juror noticed that no plan on `main` gives the corpus a `Tracer: yes` subject, so moving `tracer` to `FIELDS` compares absent with absent only.
- No juror named `mock-fleet.ts` `mockPlans` as a `PlanRecord` builder that an optional field leaves untouched (layering named the file but not the consequence).
- No juror noticed that the corpus `KNOWN_UNCARRIED` list also holds `spike_approved_raw`, which `planOf` maps. Filed as #3121.

## Ran versus read

- Layering: ran `git show`/`git grep`/`git log` on `origin/main`; read the adapter excerpts and `fleet.ts:6605-6618`. Ran no test.
- Safety: ran `git show`/`git grep`/`git log` and `gh issue view 3102`; counted markers with `git grep`, not with the parser. Ran no test.
- Testability: ran `git show`/`git grep` and a marker count with `grep`; read the auto-deliver test, the corpus, `auto-verify.ts`, `phase.ts`. Ran no test.
- Seams: ran `git fetch`, `git grep`, `gh pr list`, `gh pr diff` for #3105 and five other PRs, `gh issue view 3102`. Ran no test.
- Moderator: ran `plot-plan-meta.sh` from `origin/main` over all plan files, `gh pr view 3105` (OPEN), `gh pr diff 3105`, and `git show` over every cited line. Ran no test suite.

## Decisions

- **Option A (`Tracer: yes`).** jwloka. Option B and both open questions removed.
- **Accepted consequence:** a spike-only plan is no longer held at auto-delivery; the tracer hold holds no current plan. jwloka. The moderator added the measurement that the registry plan's marker is prose only, so its delivery does not change.
- **`PlanRecord.tracer?: boolean`, absent when the parser omits the key.** Moderator. Reason: mirrors `PlanRecordBranch.spike`, and leaves fixtures and `mockPlans` valid with no change.
- **The slice waits on #3105 and removes the `planSpikes` sum.** Caller, from the seams finding. #3105 is OPEN at the time of writing.
- **The fleet-row test asserts phase names under `DEFAULT_PHASE_MAP`.** Moderator. Reason: `proven` is not a value the pulse path can produce, so a `proven` assertion would test the card path only.
- **The corpus two-list check is out of scope.** Moderator. Reason: it concerns every key, not `tracer`; filed as #3121.
