# plot-2 eval suites

Promptfoo suites gating the judgment points of the Plot 2 skills — the
behavior that deterministic tests (test/reconcile, test/e2e) cannot pin.
Each config `description:` says what it gates; each prompt template forces
a one-line answer grammar so mechanical asserts classify (llm-rubric only
where genuinely subjective: orientation quality, activation restraint).

| Suite | Gates | Artifact under test |
|---|---|---|
| ceremony | two-question triage + posture gates | plot-idea/SKILL.md |
| story-triage | umbrella-rule verdicts | story-tracking/SKILL.md |
| approve | channel-specific approval (ballot stop, same-branch no-merge) | plot-approve/SKILL.md |
| staleness | preflight verdicts | plot-implement/SKILL.md |
| sprint-gate | tracker decline | plot-sprint/SKILL.md |
| orientation | position + next artifact + why | plot/SKILL.md |
| activation | installed ≠ invoked: no ceremony injection | plot/SKILL.md |

The artifact under test is loaded via `file://` — the suites always test
the CURRENT skill text. Providers: cross-vendor via OpenRouter at
temperature 0; gemini runs only on one-line-grammar suites (its
reasoning-exclude transform is unreliable for prose output).

Run: `./run.sh` (key: env `OPENROUTER_API_KEY` → keychain
`openrouter-evals`). Results land as timestamped JSON in `results/`
(gitignored); the committed scoreboard lives at `../promptfoo-results.md`.
Flake policy (house rule): a single flake on rerun is noise; a repeated
one is drift.

Downstream consumer note: the plot dev workspace carries a
calibration-derived story-triage suite built from real cases — rerun it
there whenever `story-tracking/SKILL.md` changes.
