# Panel — a-rule-reaches-the-install-that-runs-it

**One juror: `amend` (premise). Not unanimous — one lens, one position.**

The juror disproved the plan's diagnosis by running it, and the correction took
two attempts.

## The TypeScript was never the problem

```
$ node -e "await import('…/rules/fleet-size.ts')"
imported, exports: DEFAULT_FLEET_SIZE,ceilingFor,fleetSize
```

Node 24 strips types. The plan said *"none of them can be imported, because they
are TypeScript"* and that is false.

**The author's second diagnosis was also wrong** — blaming the rule's own import
chain. `fleet-size.ts` imports exactly one thing, `import type { Headroom }`,
erased entirely by stripping.

**The cause is the SECOND import.** `plot-dispatch.sh:1931` imports two modules,
and `entities/machine.ts` opens with `import { z } from 'zod'`:

```
machine.ts FAILED: Cannot find package 'zod'
fleet-size.ts: imported
```

**So the bundle must carry `headroomFor` as well as `fleetSize`.** A bundle of
the rule alone would fix nothing — which the plan would not have known without
running the import.

## Four more corrections

- **43 rule sources, not 40**, and **4** import `zod` rather than all of them.
- **Three scripts import a source**, not one: `plot-dispatch.sh`,
  `plot-reap.sh`, `plot-release-refs.sh`. The other two reach no `zod`, which is
  why they work.
- **`packages/board/.gitignore:2` ignores its own `dist`** while domain's is
  merely uncommitted — a difference the plan generalised over.
- **A plugin install's contents are not constant.** The reporter's 2.17.0 carries
  `packages/domain/src/`; this machine's 2.8.0 carries none of it. **Two failures
  wear one message**, which is why the refusal has to say which.

## What one lens cannot see

**A single juror is a reading, not a panel**, and this one was a premise lens —
it checked whether the facts hold and not what the fix costs. Nobody asked
whether a fourteenth bundle is the right answer or whether three source-importing
scripts want one shared route. **That is stated rather than papered over.**

## The moderator's reading

**Amend, and the plan's diagnosis was rewritten twice before it was right.** The
fix — a tracked bundle beside the 24 that already ship — survives; what it must
contain changed.

**Nothing here moves the plan's phase.**
