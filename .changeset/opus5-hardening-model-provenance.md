---
"plot": minor
---

New `docs/model-provenance.md` records which model class Plot's skills were authored and tuned against, with a pointer from `intro-to-using-plot.md`.

Skills are prompts, and prompts are model-dependent: a provider shipping a model update can change Plot's behaviour with no commit to this repo. Recording provenance turns "Plot broke" into the answerable question "did the skill change, or did the model?".

This is distinct from each skill's `## Model Guidance` table, which records the *minimum* tier a step needs. That is a floor; provenance is what the wording was actually tuned against. Only the latter changes on a model update.

The historical row (2026-02 → 2026-07) is marked **unconfirmed** — the dates come from git history, but the model class is inferred and needs confirmation from whoever ran those sessions.

<!--
bumps:
  skills:
    plot: patch
-->
