# Brief: bug/the-gate-reads-what-was-shared

Implement `docs/plans/2026-08-18-the-gate-reads-what-was-shared.md`.

Read it first. Both directions of the bug were **reproduced in a sandbox**, and
the scope was settled during interrogation: **do not re-derive it, do not widen
it.**

## The bug, in both directions

The phase gate parses the plan file in the **working tree** — the least
trustworthy surface in a repo with several agents in it.

**It refuses approved work.** Plan `Approved` on `origin/main`, checkout parked
on another branch carrying an older copy:

```
origin/main phase:  Approved
what plot reads:    draft
plot-dispatch: plan '...' is still Draft — nothing may be dispatched.
```

**It permits unapproved work.** Plan `Draft` on `origin/main`, an approval
committed only to a local branch and never pushed:

```
origin/main phase: Draft   <- NOT approved
would dispatch feature/x → ...
summary: dispatched=1
```

The second is the serious one. Manifesto Principle 2 is *plans are approved
before implementation*; a gate that accepts an approval nobody else can see
enforces "someone typed Approved in this filesystem" instead.

## Two call sites, one fix

| File | Line | What it does today |
|---|---|---|
| `plot-dispatch.sh` | 232 | `gate_meta=$(plot-plan-meta.sh "$plan_file")` on a path resolved at line 223 |
| `plot-phase-gate.sh` | 136, 145 | globs `$PLAN_DIR`, then parses what it finds |

Both read the plan blob from `origin/$MAIN` instead — `git show
origin/$MAIN:<path>`. The gate then asks the question it means: *has this been
approved where everyone can see it?*

## The one place they diverge, deliberately

When `origin/$MAIN` cannot be resolved (no remote, fresh clone, offline):

- **`plot-dispatch.sh` refuses**, and names the ref it could not read.
  `--allow-local` is the explicit, documented escape — named in the refusal
  message so the operator learns it exists at the moment they need it.
- **`plot-phase-gate.sh` allows the commit and says so.** It is a PreToolUse
  hook; refusing every commit when offline would make the repo unusable, and
  `CLAUDE.md` records the fail-open as a deliberate property. It must emit:

  ```
  plot-phase-gate: cannot read origin/main — phase unverified,
                   allowing the commit. Run `git fetch` to restore the gate.
  ```

The reason for the divergence is blast radius: dispatch refusing costs one
fan-out you can retry; the hook refusing costs every commit in the repository.
An operator who sees that line knows the gate did not run — the whole difference
between failing open and failing silently.

**Never fall back to the working tree.** That reintroduces the bug exactly where
nothing can catch it.

## Definition of Done

- Both sandbox reproductions as tests: a shared approval hidden by a parked
  checkout must dispatch; a local-only approval must be refused
- The hook's offline behaviour tested both ways: it still allows the commit
  **and** it emits the unverified line
- `pnpm test`, `pnpm run test:reconcile`, `pnpm run test:e2e` pass
- A changeset with a `bumps:` block

## Out of scope

- `/plot-approve`, `/plot-deliver`, `/plot-release` — the plan's remaining Open
  Point asks whether they share this defect. **Do not fix them here**; if you
  can answer cheaply while you are in the code, report the answer.
- `plot-fleet-scan.sh` — a sibling branch owns it. Do not touch it.

## Platform note

CI runs Linux; you are probably on macOS. Two faults were caught this way today:
`stat -f` does not fail cleanly on GNU (it prints a filesystem report to stdout
and *then* exits 1), and `/usr/bin:/bin` is not an isolated PATH because CI
ships a real `gh` there. If a test shells out, consider the other platform
before pushing.

If you find something the plan did not anticipate, implement what you can and
**report the discovery** rather than improvising.
