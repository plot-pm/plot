# Tiny Garden 🥕🍓

A tiny backyard garden, planned with Plot — fruits and vegetables across the
seasons. This repo exists **only** as a board integration-test fixture: a
reduced, realistic stand-in for a plot adopter. Its config is written the way
people actually write markdown (backtick-quoted values with trailing prose),
which exercises `plot-config.sh`'s tolerant parsing.

Note there is deliberately **no `Sprint directory`** key: this garden tracks
sprints inline on the plans (a `Sprint:` line / `sprint:` front-matter field)
and never grew a `docs/sprints/` tree. The board must still offer a sprint
filter from those inline values.

## Plot Config

- **Plan directory:** `docs/plans/` (raised beds, date-prefixed `YYYY-MM-DD-<slug>.md`, never moved once sown)
- **Active index:** `docs/plans/active/`
- **Delivered index:** `docs/plans/delivered/`
- **Branch prefixes:** `idea/` (seeds), `feature/`, `bug/`, `docs/`, `infra/` (harvest)
