## Implementation brief — jira-inbox-is-instance-wide-the (slice 2: Proposed)

- **Plan (canonical):** `docs/plans/2026-09-09-jira-inbox-is-instance-wide-the.md` on `main`
- **Approved:** 2026-09-09, Jan Wloka, plan-PR #854 merged
- **Branch:** `feature/adoption-proposes-the-ticket-prefixes` (base: `main`)
- **Ends as:** one PR to `main`
- **Answers:** GitHub issue #850 (in part)

**Slice 1 has LANDED** — `tracker_projects()` is at `plot-host.sh:1519` and the JQL reads `Ticket prefixes` at `:3079`. Nothing blocks you.

### What to build

`/plot-init` and `/plot-board-setup` propose the `Ticket prefixes` key, seeded from the prefix the probe measured and confirmed by a person.

Today the key works only if somebody knows it exists. `plot-detect-repo.sh:97` already measures a prefix and `TicketProposal.prefix` already carries it — nothing turns that into a proposal.

### The decisions the plan settles — do not re-derive them

**Model it on `trackerKey` (`packages/domain/src/rules/adoption.ts:225`).** It returns `{ key, gap }`, builds `evidence` as `"<prefix> in <matched> of <outOf> subjects"`, and names the gap in prose when the answer is incomplete. Its docstring already carries the argument this rule needs: *"a confirmed `jira` with no URL is written WITH its gap named rather than withheld."*

**A measured prefix proposes a ONE-ELEMENT list with its gap named** — never a silent complete answer. `plot-detect-repo.sh:97` takes `head -1` of the counted prefixes, so the probe knows of one where a repository may map to several Jira projects. On the reported repository the probe answers `PROJ-B`, and filtering on that alone shows 3 of 12 issues while hiding the PROJ-A and PROJ-C work that genuinely belongs — **under a heading claiming nobody has planned these tickets**, which is the same lie the original defect tells with the projects reversed. The person adds the rest; the proposal says so.

**No measured prefix proposes NOTHING** — the key is omitted, never written empty. An empty `Ticket prefixes:` would read as *this repository has no projects* and trigger the absent-key path with a claim attached; an absent key means *nobody has said*, which is true.

**Declining writes no key, and that is a legitimate outcome.** The inbox stays instance-wide, which is today's behaviour. A proposal that cannot be declined is a question with one answer.

**The domain names no vendor.** `adoption.ts:246` records that `ciKey` branched on `'jenkins'` and `'github-actions'` when first written and the *domain names no vendor* gate refused it, correctly. Your rule decides what a **key list** looks like — the vendor's word arrives as a reading.

**Rules carried over:** the propose/collect seam. The probe reports prefixes and their counts; whether they constitute a key list is the rule's decision, exactly as `proposeTicket`'s threshold moved out of an `awk '$1 >= 2'` in the collector.

### Done when

The plan's slice assertions are the specification:

- A measured prefix proposes a one-element list **with its gap named**.
- No measured prefix proposes nothing — the key is omitted, not empty.
- The proposal is a proposal: declining writes no key.

Each exists because a naive implementation passes without it: the gap assertion catches a rule that proposes `PROJ-B` as though it were the complete answer, and the omit assertion catches `Ticket prefixes:` written blank.

**Both skills must offer it, not just one.** `/plot-init` and `/plot-board-setup` are where `Git host` and `Tracker` are already proposed; a key offered by one and not the other is the inconsistency this slice exists to remove.

Plus the repo gates: `nvm use` (Node 24 — `pnpm` crashes on 26), then `corepack pnpm install`, `corepack pnpm test`, `corepack pnpm run test:reconcile`, `corepack pnpm run test:board`, `corepack pnpm run typecheck`, and `corepack pnpm run build:board` with the artifact committed. Add a changeset (`'plot': minor`, description FIRST, `bumps:` block LAST, with a `plan:` line). **Do not run `pnpm run test:e2e`** — CI's gate.

**Run tests in the FOREGROUND, and expect the suite to be slow under load** — three agents ran `test:reconcile` concurrently today and produced 23 processes. If a run sits at 0% CPU past its timeout, say so in your report rather than waiting indefinitely.

### Bookkeeping

When the PR is created, append `→ #<number>` to this branch's line in the plan's `## Slices` section on `main` — check `git branch --show-current` is `main` before that edit. Push the first real commit as soon as it exists.

### Scope guard

This branch owns the proposal rule in `packages/domain/src/rules/adoption.ts` (and `stack.ts` if the reading needs widening), plus the two skills' proposal steps.

**Do not touch:** `tracker_projects()` or the JQL (slice 1, landed), `plot-host.sh`'s `issue-list` arm, or anything in `every-issue-renders-as-open-issue`'s slices — `an-issue-carries-its-status` and `an-issue-key-is-a-string` are in flight on the same file.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
