---
'@plot-pm/board': patch
---

Every set of states in the domain now says whether it is a lifecycle, and `scripts/check-state-declarations.sh` refuses one that says nothing. This is the ratchet behind the three rules that landed before it — story (#707), agent (#710), worktree (#716) — and what stops the next lifecycle arriving undeclared, which is the failure `WorktreeState` was: it read `created -> occupied -> finished -> reapable -> gone` while nothing refused `gone -> occupied`.

**A state enum is not always a lifecycle, so the gate reads a declaration rather than guessing.** `MoscowTier` is `must | should | could | deferred` — a priority, where a Could becoming a Must is a re-prioritisation. `Mergeability` is a reading of a moment that nothing moves between. A gate that guessed would refuse a priority for lacking a transition it cannot have, and the fix would be a rule that lies. The plan's own argument for the declaration is the evidence: it cited `SprintState` and `PrState` as enums that do not transition, and both are lifecycles.

Each occurrence carries `// plot-state: lifecycle <entity>`, `reading` or `classification` within five lines above it — 10, 10 and 17 across 37 occurrences. Where the marker says `lifecycle`, the gate also requires `transitions/<entity>.ts`; six are still owed one and sit at a literal `LIFECYCLE_DEBT=6`, which fails when it grows and never when it falls. An undeclared enum is refused outright, because adding one line needs no slice.

**The unit is the enum, never the file.** `entities/sprint.ts` holds one lifecycle and two things that must never have one, so a `transitions/sprint.ts` would satisfy a file-level gate for all three. The contract test found the same defect arriving through the window: two enums three lines apart put the first one's marker inside the second one's, so the window now stops at the previous enum.

**It reads `grep -a`, and that found two enums nobody had counted.** `entities/finding.ts` composes a key with a real NUL byte, so grep calls the whole file binary and prints `Binary file … matches` instead of its lines. `MonitorName` and `FindingName` were invisible to every count taken for this work — the plan's 37, the re-measured 35, and the hand count that wrote the declarations. The gate's first run named both.

Twelve tests, including the one the slice exists for: an enum added with no declaration fails the build. A ratchet nobody can trip is a comment.
